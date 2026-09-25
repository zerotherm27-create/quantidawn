-- QuantiDawn dashboard Inbox (email in/out through Resend)
-- Run once in the Supabase SQL editor (after setup-all.sql, which creates public.is_admin()).
--
-- One row per email. Outbound mail is logged by /api/inbox-send with the signed-in admin's own token;
-- inbound mail and delivery events are written by /api/webhooks/resend with the service-role key
-- (a webhook has no user session). Only admins can read or change anything here.

create table if not exists public.email_messages (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  direction    text not null check (direction in ('INBOUND', 'OUTBOUND')),
  status       text not null check (status in ('SENT', 'DELIVERED', 'BOUNCED', 'RECEIVED', 'FAILED')),
  resend_id    text unique,                       -- Resend's id; unique so webhook retries update instead of duplicating
  message_id   text,                              -- RFC Message-ID, used for threading replies
  in_reply_to  text,
  from_email   text not null,
  to_email     text not null,
  subject      text not null default '',
  body_text    text,
  body_html    text,
  inquiry_id   uuid references public.quote_requests (id) on delete set null,
  is_read      boolean not null default false,
  is_starred   boolean not null default false,
  is_archived  boolean not null default false,
  deleted_at   timestamptz                        -- set = in Trash (restorable)
);

create index if not exists email_messages_created_idx on public.email_messages (created_at desc);
create index if not exists email_messages_message_id_idx on public.email_messages (message_id);
create index if not exists email_messages_inquiry_idx on public.email_messages (inquiry_id);

alter table public.email_messages enable row level security;
revoke all on public.email_messages from anon, authenticated;
grant select, insert, update, delete on public.email_messages to authenticated;

drop policy if exists "admins manage email" on public.email_messages;
create policy "admins manage email"
  on public.email_messages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Small key/value store for dashboard settings shared by the team (the email signature)
create table if not exists public.dashboard_settings (
  key        text primary key check (char_length(key) <= 60),
  value      text not null default '' check (char_length(value) <= 5000),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_settings enable row level security;
revoke all on public.dashboard_settings from anon, authenticated;
grant select, insert, update on public.dashboard_settings to authenticated;

drop policy if exists "admins manage settings" on public.dashboard_settings;
create policy "admins manage settings"
  on public.dashboard_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
