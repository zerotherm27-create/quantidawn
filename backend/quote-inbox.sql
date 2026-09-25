-- QuantiDawn quote inbox (Supabase / Postgres)
-- Run this ONCE in the new QuantiDawn project (SQL editor, or apply as a migration).
-- Design: the public website may only INSERT. Nobody using the public (anon) key can read,
-- change or delete anything; you read leads in the Supabase dashboard (Table Editor / Storage).

-- 1. Leads table -------------------------------------------------------------------------
create table if not exists public.quote_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 200),
  company      text not null check (char_length(company) between 1 and 200),
  email        text not null check (char_length(email) <= 254 and email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  phone        text check (phone is null or char_length(phone) <= 40),
  market       text not null check (market in ('AU', 'US', 'SG', 'Other')),
  project_type text not null check (project_type in ('residential', 'commercial', 'civil', 'subcontractor')),
  interest     text not null check (interest in ('single', 'retainer')),
  description  text not null check (char_length(description) between 10 and 5000),
  timing       text check (timing is null or timing in ('asap', 'week', 'flexible')),
  files        jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 20),
  -- internal fields, set by you in the dashboard (never by the website)
  status       text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  notes        text
);

alter table public.quote_requests enable row level security;

-- the website (anon) may insert new leads only, and may not set the internal fields
drop policy if exists "website can submit a quote request" on public.quote_requests;
create policy "website can submit a quote request"
  on public.quote_requests
  for insert
  to anon
  with check (status = 'new' and notes is null);

-- 2. Private bucket for uploaded plans ---------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-plans', 'quote-plans', false, 26214400)          -- 25 MB per file, private
on conflict (id) do nothing;

-- the website may upload PDF / DWG / DXF / JPG files into this bucket; no read, update or delete
drop policy if exists "website can upload plans" on storage.objects;
create policy "website can upload plans"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'quote-plans'
    and lower(storage.extension(name)) in ('pdf', 'dwg', 'dxf', 'jpg', 'jpeg')
  );
