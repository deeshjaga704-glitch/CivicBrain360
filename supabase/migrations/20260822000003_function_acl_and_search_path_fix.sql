-- Corrective security migration discovered by Supabase advisors.
-- Keep only the execution grants needed by the application and RLS.

create or replace function public.set_complaint_updated_at() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger-only functions must not be callable through the REST RPC surface.
revoke all on function public.set_complaint_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.record_new_complaint() from public, anon, authenticated;
revoke all on function public.record_related_audit() from public, anon, authenticated;
revoke all on function public.record_evidence_audit() from public, anon, authenticated;
revoke all on function public.record_duplicate_audit() from public, anon, authenticated;
revoke all on function public.record_project_link_audit() from public, anon, authenticated;
revoke all on function public.record_supporter_audit() from public, anon, authenticated;
revoke all on function public.record_ai_audit() from public, anon, authenticated;
revoke all on function public.protect_profile_security_fields() from public, anon, authenticated;

-- These security-definer helpers/RPCs need authenticated execution for RLS and
-- the application, but must not be callable by anonymous clients.
revoke all on function public.create_complaint(text, uuid, text, double precision, double precision, text, text, uuid) from public, anon;
revoke all on function public.transition_complaint(uuid, complaint_status, text, uuid, boolean) from public, anon;
revoke all on function public.citizen_verify_complaint(uuid, boolean, text) from public, anon;
revoke all on function public.current_profile_role() from public, anon;
revoke all on function public.current_profile_department() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_officer() from public, anon;
revoke all on function public.can_access_complaint(uuid) from public, anon;
revoke all on function public.can_manage_complaint(uuid) from public, anon;
revoke all on function public.can_access_project(uuid) from public, anon;
revoke all on function public.can_manage_project(uuid) from public, anon;

grant execute on function public.create_complaint(text, uuid, text, double precision, double precision, text, text, uuid) to authenticated;
grant execute on function public.transition_complaint(uuid, complaint_status, text, uuid, boolean) to authenticated;
grant execute on function public.citizen_verify_complaint(uuid, boolean, text) to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_department() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_officer() to authenticated;
grant execute on function public.can_access_complaint(uuid) to authenticated;
grant execute on function public.can_manage_complaint(uuid) to authenticated;
grant execute on function public.can_access_project(uuid) to authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;
