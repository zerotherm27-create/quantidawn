-- QuantiDawn quote-form spam guard (server side)
-- Run once in the Supabase SQL editor. The browser checks (honeypot, time trap) only stop simple bots;
-- anyone can call the database API directly, so these rules live in the database and cannot be bypassed.
--
--   1. Rate limits   : too many requests from one email, or a flood overall, are rejected.
--   2. Auto-flagging : suspicious requests are still saved, but marked status = 'spam' with the reason in
--                      Notes, so they leave your inbox and nothing real is ever lost. Open the Inquiries
--                      tab and choose the Spam filter to review them; set the status back to restore one.
--   3. Upload paths  : plan files may only be uploaded to <uuid>/<n>-<filename>, never to arbitrary paths.

-- 1. Rate limits (run BEFORE the row is stored) ---------------------------------------------
create or replace function public.quote_requests_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.quote_requests
      where lower(email) = lower(new.email) and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'rate_limited_email' using errcode = 'P0001',
      hint = 'Too many requests from this email address in the last hour.';
  end if;
  if (select count(*) from public.quote_requests where created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'rate_limited_busy' using errcode = 'P0001',
      hint = 'Too many requests right now.';
  end if;
  return new;
end;
$$;

drop trigger if exists quote_requests_rate_limit on public.quote_requests;
create trigger quote_requests_rate_limit
  before insert on public.quote_requests
  for each row execute function public.quote_requests_rate_limit();

-- 2. Auto-flagging (run AFTER the row is stored, so the insert policy is unaffected) ------------
create or replace function public.quote_requests_classify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reasons text[] := '{}';
  links   int;
  dom     text := lower(split_part(new.email, '@', 2));
  txt     text := lower(coalesce(new.name, '') || ' ' || coalesce(new.company, '') || ' ' || coalesce(new.description, ''));
begin
  select count(*) into links from regexp_matches(new.description, '(https?://|www\.)', 'gi');
  if links >= 3 then reasons := array_append(reasons, format('%s links in the description', links)); end if;

  if new.name ~* '(https?://|www\.)' or new.company ~* '(https?://|www\.)' then
    reasons := array_append(reasons, 'link in name or company'::text);
  end if;

  if txt ~* '(backlink|guest post|seo (service|package|expert|audit)|search engine optimi[sz]ation|casino|bitcoin|crypto (invest|trading)|forex|viagra|cialis|payday loan|escort|dating site|essay writing|increase your (traffic|sales|ranking)|rank(ing)? #?1 on google)' then
    reasons := array_append(reasons, 'spam wording'::text);
  end if;

  if dom in ('mailinator.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com', 'tempmail.com', 'temp-mail.org',
             'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com') then
    reasons := array_append(reasons, 'disposable email address'::text);
  end if;

  -- the same text sent from a different email in the last week (copy-paste blasts)
  if exists (select 1 from public.quote_requests q
             where q.id <> new.id and lower(q.email) <> lower(new.email)
               and q.description = new.description and q.created_at > now() - interval '7 days') then
    reasons := array_append(reasons, 'same text sent from another email'::text);
  end if;

  if array_length(reasons, 1) > 0 then
    update public.quote_requests
       set status = 'spam', notes = 'Auto-flagged as spam: ' || array_to_string(reasons, '; ')
     where id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists quote_requests_classify on public.quote_requests;
create trigger quote_requests_classify
  after insert on public.quote_requests
  for each row execute function public.quote_requests_classify();

-- the trigger functions run only as triggers; nobody can call them through the API
revoke all on function public.quote_requests_rate_limit() from public, anon, authenticated;
revoke all on function public.quote_requests_classify()   from public, anon, authenticated;

-- 3. Upload paths ------------------------------------------------------------------------------------
-- the site uploads to <request uuid>/<n>-<sanitised filename>; refuse anything else
drop policy if exists "website can upload plans" on storage.objects;
create policy "website can upload plans"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'quote-plans'
    and lower(storage.extension(name)) in ('pdf', 'dwg', 'dxf', 'jpg', 'jpeg')
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,2}-[A-Za-z0-9_.-]{1,120}$'
  );
