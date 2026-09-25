-- QuantiDawn email notifications (Resend)
-- Run once in the Supabase SQL editor.
--
-- After the quote form saves an inquiry, the browser calls /api/notify with the inquiry's id. That function
-- asks the database to "claim" the notification through claim_inquiry_notification(). The claim succeeds only
-- ONCE per inquiry, only for real (non-spam) inquiries, and only in the first 10 minutes, so the endpoint
-- cannot be used to email arbitrary people or to re-send. Nothing secret is stored in the database.

alter table public.quote_requests add column if not exists notified_at timestamptz;

create or replace function public.claim_inquiry_notification(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.quote_requests;
begin
  update public.quote_requests
     set notified_at = now()
   where id = p_id
     and notified_at is null
     and status = 'new'
     and created_at > now() - interval '10 minutes'
  returning * into r;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'name', r.name, 'company', r.company, 'email', r.email, 'phone', r.phone,
    'market', r.market, 'project_type', r.project_type, 'interest', r.interest,
    'timing', r.timing, 'description', r.description,
    'file_count', jsonb_array_length(r.files)
  );
end;
$$;

revoke all on function public.claim_inquiry_notification(uuid) from public;
grant execute on function public.claim_inquiry_notification(uuid) to anon, authenticated;
