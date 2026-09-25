-- QuantiDawn first-party traffic analytics
-- Run once in the Supabase SQL editor (after setup-all.sql, which creates public.is_admin()).
--
-- What is stored: one row per page view / click / leave / conversion. No IP address, no cookie,
-- no user id. Country and region come from Vercel's edge headers. The session id is a random
-- value that lives in the browser tab's sessionStorage and disappears when the tab closes.

-- 1. Events table ---------------------------------------------------------------------------
create table if not exists public.page_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text     not null check (char_length(session_id) between 16 and 40),
  type        text     not null check (type in ('pageview', 'click', 'leave', 'conversion')),
  path        text     not null check (path like '/%' and char_length(path) <= 200),
  referrer    text     check (char_length(referrer) <= 120),   -- host only, e.g. google.com
  utm_source  text     check (char_length(utm_source) <= 60),
  country     text     check (country ~ '^[A-Z]{2}$'),
  region      text     check (char_length(region) <= 6),
  device      text     check (device in ('mobile', 'tablet', 'desktop')),
  label       text     check (char_length(label) <= 100),      -- click target or conversion name
  duration_ms integer  check (duration_ms between 0 and 1800000),  -- visible time since the last leave
  scroll_pct  smallint check (scroll_pct between 0 and 100)
);

create index if not exists page_events_created_idx on public.page_events (created_at desc);
create index if not exists page_events_session_idx on public.page_events (session_id);

-- 2. Access rules ------------------------------------------------------------------------------
-- The website may only ADD events (through /api/collect). Only admins can read or delete them.
alter table public.page_events enable row level security;

revoke all on public.page_events from anon, authenticated;
grant insert on public.page_events to anon;
grant select, delete on public.page_events to authenticated;

drop policy if exists "website can record events" on public.page_events;
create policy "website can record events"
  on public.page_events for insert to anon
  with check (true);          -- shape is enforced by the column checks above

drop policy if exists "admins can read events" on public.page_events;
create policy "admins can read events"
  on public.page_events for select to authenticated
  using (public.is_admin());

drop policy if exists "admins can delete events" on public.page_events;
create policy "admins can delete events"
  on public.page_events for delete to authenticated
  using (public.is_admin());

-- 3. Dashboard summary ----------------------------------------------------------------------------
-- One call returns everything the Traffic tab needs. Definitions:
--   visit    = one browser-tab session that viewed at least one page in the period
--   bounce   = a visit that viewed exactly one page and clicked nothing
--   avg time = visible (tab in the foreground) time per visit, visits with no measured time excluded
create or replace function public.traffic_summary(p_days int default 7, p_tz text default 'UTC')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 7), 1), 365);
  v_tz   text := coalesce((select name from pg_catalog.pg_timezone_names where name = p_tz limit 1), 'UTC');
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 365));
  v_prev timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 365) * 2);
  v_unit text := case when least(greatest(coalesce(p_days, 7), 1), 365) = 1 then 'hour' else 'day' end;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with ev as (
    select * from public.page_events where created_at >= v_prev
  ),
  cur as (select * from ev where created_at >= v_from),
  prv as (select * from ev where created_at < v_from),
  sess as (
    select session_id,
           count(*) filter (where type = 'pageview')  as views,
           count(*) filter (where type = 'click')     as clicks,
           coalesce(sum(duration_ms) filter (where type = 'leave'), 0) as ms,
           bool_or(type = 'conversion')               as converted
    from cur group by session_id
    having count(*) filter (where type = 'pageview') > 0
  ),
  psess as (
    select session_id,
           count(*) filter (where type = 'pageview') as views,
           count(*) filter (where type = 'click')    as clicks
    from prv group by session_id
    having count(*) filter (where type = 'pageview') > 0
  ),
  entry as (   -- the first page view of each visit carries the referrer, country and device
    select distinct on (session_id) *
    from cur where type = 'pageview'
    order by session_id, created_at
  )
  select jsonb_build_object(
    'days', v_days,
    'unit', v_unit,
    'totals', jsonb_build_object(
      'views',            (select count(*) from cur where type = 'pageview'),
      'visits',           (select count(*) from sess),
      'bounces',          (select count(*) from sess where views = 1 and clicks = 0),
      'avg_ms',           (select coalesce(round(avg(ms) filter (where ms > 0)), 0) from sess),
      'clicks',           (select count(*) from cur where type = 'click'),
      'conversions',      (select count(*) from cur where type = 'conversion'),
      'converted_visits', (select count(*) from sess where converted)
    ),
    'prev', jsonb_build_object(
      'views',   (select count(*) from prv where type = 'pageview'),
      'visits',  (select count(*) from psess),
      'bounces', (select count(*) from psess where views = 1 and clicks = 0)
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('t', b, 'views', v, 'visits', s) order by b)
      from (
        select date_trunc(v_unit, created_at at time zone v_tz) as b,
               count(*) filter (where type = 'pageview') as v,
               count(distinct session_id) filter (where type = 'pageview') as s
        from cur group by 1
      ) x), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.views desc)
      from (
        select path,
               count(*) filter (where type = 'pageview') as views,
               count(distinct session_id) filter (where type = 'pageview') as visits,
               round(sum(duration_ms) filter (where type = 'leave')
                     / nullif(count(*) filter (where type = 'pageview'), 0)) as avg_ms,
               round(avg(scroll_pct) filter (where type = 'leave' and scroll_pct is not null)) as scroll
        from cur group by path
        having count(*) filter (where type = 'pageview') > 0
        order by 2 desc limit 10
      ) x), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.visits desc)
      from (select country, count(*) as visits from entry where country is not null
            group by country order by 2 desc limit 12) x), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.visits desc)
      from (select country, region, count(*) as visits from entry
            where country is not null and region is not null
            group by country, region order by 3 desc limit 12) x), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.visits desc)
      from (select coalesce(nullif(utm_source, ''), nullif(referrer, ''), 'Direct') as source, count(*) as visits
            from entry group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.visits desc)
      from (select coalesce(device, 'desktop') as device, count(*) as visits
            from entry group by 1 order by 2 desc) x), '[]'::jsonb),
    'clicks', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.clicks desc)
      from (select label, count(*) as clicks from cur
            where type = 'click' and label is not null
            group by label order by 2 desc limit 10) x), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.traffic_summary(int, text) from public, anon;
grant execute on function public.traffic_summary(int, text) to authenticated;

-- 4. Optional housekeeping ------------------------------------------------------------------------
-- Keep 13 months of raw events. Run occasionally (or schedule with pg_cron):
--   delete from public.page_events where created_at < now() - interval '13 months';
