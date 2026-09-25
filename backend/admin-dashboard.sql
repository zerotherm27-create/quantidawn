-- QuantiDawn admin dashboard (Supabase / Postgres)
-- Run this AFTER backend/quote-inbox.sql, once, in the SQL editor of the QuantiDawn project.
-- It is safe to run again: every statement is idempotent.
--
-- Security model
--   * The public website (anon key) can still only INSERT new leads and upload plans.
--   * Only signed-in users listed in public.admins can read, update or delete leads
--     and open the uploaded plans. This is enforced by the database (Row Level Security),
--     not by hiding the admin page.

-- 1. Extra fields the dashboard uses ------------------------------------------------------
alter table public.quote_requests
  add column if not exists first_response_at timestamptz,
  add column if not exists follow_up_on      date,
  add column if not exists quote_value       numeric(12, 2) check (quote_value is null or quote_value >= 0),
  add column if not exists quote_currency    text check (quote_currency is null or quote_currency in ('AUD', 'USD', 'SGD', 'PHP')),
  add column if not exists updated_at        timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quote_requests_updated_at on public.quote_requests;
create trigger quote_requests_updated_at
  before update on public.quote_requests
  for each row execute function public.set_updated_at();

create index if not exists quote_requests_created_at_idx on public.quote_requests (created_at desc);
create index if not exists quote_requests_status_idx on public.quote_requests (status);

-- 2. Who is an admin ----------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

drop policy if exists "admins can read their own row" on public.admins;
create policy "admins can read their own row"
  on public.admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 3. Lead access rules ---------------------------------------------------------------------
-- the website may still only add brand-new leads, and may not set any of the internal fields
drop policy if exists "website can submit a quote request" on public.quote_requests;
create policy "website can submit a quote request"
  on public.quote_requests
  for insert
  to anon
  with check (
    status = 'new'
    and notes is null
    and first_response_at is null
    and follow_up_on is null
    and quote_value is null
    and quote_currency is null
  );

drop policy if exists "admins can read requests" on public.quote_requests;
create policy "admins can read requests"
  on public.quote_requests for select to authenticated
  using (public.is_admin());

drop policy if exists "admins can update requests" on public.quote_requests;
create policy "admins can update requests"
  on public.quote_requests for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins can delete requests" on public.quote_requests;
create policy "admins can delete requests"
  on public.quote_requests for delete to authenticated
  using (public.is_admin());

-- 4. Uploaded plans: admins can open and delete them ---------------------------------------
drop policy if exists "admins can read plans" on storage.objects;
create policy "admins can read plans"
  on storage.objects for select to authenticated
  using (bucket_id = 'quote-plans' and public.is_admin());

drop policy if exists "admins can delete plans" on storage.objects;
create policy "admins can delete plans"
  on storage.objects for delete to authenticated
  using (bucket_id = 'quote-plans' and public.is_admin());

-- 5. Make yourself the first admin ---------------------------------------------------------
-- a) In the Supabase dashboard go to Authentication > Users > Add user > Create new user.
--    Enter your email and a strong password and tick "Auto Confirm User".
-- b) Then run this line (replace the email), and repeat it for each teammate:
--
--    insert into public.admins (user_id, email)
--    select id, email from auth.users where email = 'you@example.com'
--    on conflict (user_id) do nothing;
--
-- c) Authentication > Sign In / Providers > turn OFF "Allow new users to sign up",
--    so that only people you add can have an account.
