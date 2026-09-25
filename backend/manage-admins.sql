-- QuantiDawn: manage teammates from the dashboard (Tools > Team)
-- Run once in the Supabase SQL editor, after backend/admin-dashboard.sql (which creates
-- public.admins and public.is_admin()). Safe to run again.
--
-- What this adds: today public.admins only lets a signed-in admin read their OWN row, so the
-- dashboard can't list who has access, and there is no way to remove someone except by hand in
-- the SQL editor. This lets any admin see the full list, remove another admin, and add a new one
-- by email (only once that person has signed in at least once, so their auth.users row exists).

-- 1. Any admin can see the full admins list --------------------------------------------------
drop policy if exists "admins can read all admin rows" on public.admins;
create policy "admins can read all admin rows"
  on public.admins
  for select
  to authenticated
  using (public.is_admin());

-- 2. Any admin can remove another admin, but never themselves --------------------------------
-- (removing your own access stays a manual SQL editor action, so nobody can lock everyone out
-- by accident from inside the dashboard)
drop policy if exists "admins can remove other admins" on public.admins;
create policy "admins can remove other admins"
  on public.admins
  for delete
  to authenticated
  using (public.is_admin() and user_id <> (select auth.uid()));

-- 3. Add a teammate by email, from the dashboard -------------------------------------------
-- The dashboard's client key has no access to auth.users, so this runs with elevated
-- privileges (security definer) just to resolve the email to a user id, and still checks
-- is_admin() itself before doing anything.
create or replace function public.add_admin_by_email(target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an existing admin can add a teammate.';
  end if;

  select id into target_id from auth.users where email = target_email;
  if target_id is null then
    raise exception 'No account found for that email yet. Have them sign in once (Google, or a login you create in Authentication > Users), then try again.';
  end if;

  insert into public.admins (user_id, email)
  values (target_id, target_email)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.add_admin_by_email(text) from public, anon;
grant execute on function public.add_admin_by_email(text) to authenticated;
