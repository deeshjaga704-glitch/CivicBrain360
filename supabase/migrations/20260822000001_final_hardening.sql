-- CivicBrain360 final audit hardening.
-- Apply after 20260822000000_phase3_ai_map_duplicates.sql.
-- This migration is additive and does not delete application data.

create or replace function public.create_complaint(
  p_title text,
  p_category_id uuid,
  p_description text,
  p_latitude double precision,
  p_longitude double precision,
  p_address text default null,
  p_severity text default 'MEDIUM',
  p_project_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if p_title is null or length(btrim(p_title)) = 0 or length(btrim(p_title)) > 160 then raise exception 'A complaint title between 1 and 160 characters is required.'; end if;
  if p_description is null or length(btrim(p_description)) = 0 then raise exception 'A complaint description is required.'; end if;
  if p_latitude is null or p_longitude is null or p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180 then raise exception 'Valid latitude and longitude are required.'; end if;
  if p_severity not in ('LOW','MEDIUM','HIGH','CRITICAL') then raise exception 'Invalid complaint severity.'; end if;
  if not exists (select 1 from categories where id = p_category_id and is_active) then raise exception 'The selected category is not available.'; end if;
  if p_project_id is not null and not exists (select 1 from projects where id = p_project_id) then raise exception 'The selected project does not exist.'; end if;

  insert into complaints (title, category_id, description, latitude, longitude, address, severity, status, created_by, project_id)
  values (btrim(p_title), p_category_id, btrim(p_description), p_latitude, p_longitude, nullif(btrim(coalesce(p_address, '')), ''), p_severity, 'SUBMITTED', auth.uid(), p_project_id)
  returning id into v_id;

  if p_project_id is not null then
    insert into project_complaints (complaint_id, project_id, relationship_status)
    values (v_id, p_project_id, 'PENDING')
    on conflict (project_id, complaint_id) do nothing;
  end if;
  return v_id;
end;
$$;

create or replace function public.can_access_complaint(p_complaint_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from complaints c where c.id = p_complaint_id and (
    c.created_by = auth.uid()
    or public.current_profile_role() = 'Super Admin'
    or (public.is_officer() and (c.department_id is null or c.department_id = public.current_profile_department() or c.assigned_to = auth.uid()))
  ));
$$;

create or replace function public.can_manage_complaint(p_complaint_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_officer() and exists (select 1 from complaints c where c.id = p_complaint_id and (
    public.current_profile_role() = 'Super Admin'
    or c.department_id is null
    or c.department_id = public.current_profile_department()
    or c.assigned_to = auth.uid()
  ));
$$;

create or replace function public.transition_complaint(
  p_complaint_id uuid,
  p_to_status complaint_status,
  p_reason text default null,
  p_assigned_to uuid default null,
  p_update_assignment boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_current complaints%rowtype;
  v_role app_role;
  v_assignee uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  v_role := public.current_profile_role();
  if v_role not in ('Officer','Department Admin','Super Admin') then raise exception 'Officer or admin authorization is required.'; end if;
  select * into v_current from complaints where id = p_complaint_id for update;
  if not found then raise exception 'Complaint was not found.'; end if;

  if v_role <> 'Super Admin' and v_current.department_id is not null and v_current.department_id <> public.current_profile_department() then raise exception 'This complaint is outside your department scope.'; end if;
  if v_role = 'Officer' and v_current.assigned_to is not null and v_current.assigned_to <> auth.uid() then raise exception 'This complaint is assigned to another officer.'; end if;
  if p_update_assignment and p_assigned_to is not null then
    if not exists (select 1 from profiles where id = p_assigned_to and role in ('Officer','Department Admin','Super Admin')) then raise exception 'The selected assignee is not an authorized officer.'; end if;
    if v_role = 'Officer' and p_assigned_to <> auth.uid() then raise exception 'Officers may assign complaints only to themselves.'; end if;
  end if;

  if v_role = 'Officer' then
    if not ((v_current.status = 'SUBMITTED' and p_to_status in ('VERIFIED','REJECTED','ASSIGNED')) or (v_current.status = 'VERIFIED' and p_to_status in ('ASSIGNED','IN_PROGRESS')) or (v_current.status = 'ASSIGNED' and p_to_status = 'IN_PROGRESS') or (v_current.status = 'REOPENED' and p_to_status = 'IN_PROGRESS') or (v_current.status = 'IN_PROGRESS' and p_to_status in ('CITIZEN_VERIFICATION','RESOLVED'))) then
      raise exception 'This status transition is not permitted for an officer.';
    end if;
  end if;

  v_assignee := case when p_update_assignment then p_assigned_to else v_current.assigned_to end;
  update complaints set status = p_to_status, assigned_to = v_assignee where id = p_complaint_id;
  insert into complaint_status_history (complaint_id, from_status, to_status, changed_by, reason) values (p_complaint_id, v_current.status, p_to_status, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''));
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'complaint.status_changed', 'complaint', p_complaint_id, jsonb_build_object('from', v_current.status, 'to', p_to_status, 'reason', p_reason, 'assigned_to', v_assignee));
  begin
    insert into notifications (user_id, title, body) values (v_current.created_by, 'Complaint status changed', format('Complaint %s is now %s.', p_complaint_id, p_to_status));
  exception when others then
    null;
  end;
  return;
end;
$$;

create or replace function public.citizen_verify_complaint(p_complaint_id uuid, p_resolved boolean, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare
  v_current complaints%rowtype;
  v_next complaint_status;
  v_reason text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into v_current from complaints where id = p_complaint_id and created_by = auth.uid() for update;
  if not found then raise exception 'Complaint was not found or is not owned by the current user.'; end if;
  if v_current.status <> 'CITIZEN_VERIFICATION' then raise exception 'This complaint is not awaiting citizen verification.'; end if;
  v_next := case when p_resolved then 'CLOSED' else 'REOPENED' end;
  v_reason := case when p_resolved then 'Citizen confirmed resolution' else coalesce(nullif(btrim(p_reason), ''), 'Citizen rejected resolution') end;
  update complaints set status = v_next where id = p_complaint_id;
  insert into complaint_status_history (complaint_id, from_status, to_status, changed_by, reason) values (p_complaint_id, v_current.status, v_next, auth.uid(), v_reason);
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (auth.uid(), case when p_resolved then 'complaint.citizen_closed' else 'complaint.reopened' end, 'complaint', p_complaint_id, jsonb_build_object('reason', v_reason));
  begin
    insert into notifications (user_id, title, body) values (auth.uid(), case when p_resolved then 'Complaint closed' else 'Complaint reopened' end, case when p_resolved then format('Complaint %s was closed.', p_complaint_id) else format('Complaint %s was reopened for review.', p_complaint_id) end);
  exception when others then
    null;
  end;
  return;
end;
$$;

create or replace function public.record_new_complaint() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into complaint_status_history (complaint_id, from_status, to_status, changed_by, reason) values (new.id, null, 'SUBMITTED', new.created_by, 'Complaint submitted');
  begin
    insert into notifications (user_id, title, body) values (new.created_by, 'Complaint submitted', format('Complaint %s was submitted.', new.id));
  exception when others then
    null;
  end;
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (new.created_by, 'complaint.submitted', 'complaint', new.id, jsonb_build_object('title', new.title, 'category_id', new.category_id, 'severity', new.severity, 'latitude', new.latitude, 'longitude', new.longitude, 'project_id', new.project_id));
  return new;
end;
$$;
drop trigger if exists complaints_record_new on complaints;
create trigger complaints_record_new after insert on complaints for each row execute function public.record_new_complaint();

create or replace function public.record_related_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'evidence' then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (new.uploader_id, 'evidence.uploaded', case when new.complaint_id is not null then 'complaint' else 'project' end, coalesce(new.complaint_id, new.project_id), jsonb_build_object('path', new.file_path, 'evidence_type', new.evidence_type));
  elsif tg_table_name = 'complaint_duplicate_links' then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (coalesce(new.reviewed_by, new.created_by), 'complaint_duplicate.relationship_changed', 'complaint', new.primary_complaint_id, jsonb_build_object('duplicate_complaint_id', new.duplicate_complaint_id, 'relationship_status', new.relationship_status));
  elsif tg_table_name = 'project_complaints' then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (coalesce(new.reviewed_by, auth.uid()), 'project_complaint.relationship_changed', 'complaint', new.complaint_id, jsonb_build_object('project_id', new.project_id, 'relationship_status', new.relationship_status));
  elsif tg_table_name = 'complaint_supporters' then
    insert into audit_logs (actor_id, action, entity_type, entity_id) values (new.user_id, 'complaint.supported', 'complaint', new.complaint_id);
  elsif tg_table_name = 'complaint_ai_analysis' then
    insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (coalesce(new.accepted_by, auth.uid()), 'complaint.ai_analysis_saved', 'complaint', new.complaint_id, jsonb_build_object('provider', new.provider, 'is_available', new.is_available));
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_record_audit on evidence;
create trigger evidence_record_audit after insert on evidence for each row execute function public.record_related_audit();
drop trigger if exists complaint_duplicate_record_audit on complaint_duplicate_links;
create trigger complaint_duplicate_record_audit after insert or update on complaint_duplicate_links for each row execute function public.record_related_audit();
drop trigger if exists project_complaint_record_audit on project_complaints;
create trigger project_complaint_record_audit after insert or update on project_complaints for each row execute function public.record_related_audit();
drop trigger if exists complaint_supporter_record_audit on complaint_supporters;
create trigger complaint_supporter_record_audit after insert on complaint_supporters for each row execute function public.record_related_audit();
drop trigger if exists complaint_ai_record_audit on complaint_ai_analysis;
create trigger complaint_ai_record_audit after insert on complaint_ai_analysis for each row execute function public.record_related_audit();

-- Direct client writes that could forge ownership, status history, notifications, or audit entries are removed.
drop policy if exists "citizens create own complaints" on complaints;
drop policy if exists "citizens update own verification" on complaints;
drop policy if exists "officers update complaints" on complaints;
drop policy if exists "history write scoped" on complaint_status_history;
drop policy if exists "notifications insert authenticated" on notifications;
drop policy if exists "audit write authenticated" on audit_logs;
drop policy if exists "profiles self update or admins" on profiles;
create policy "admins update profiles" on profiles for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "evidence upload own" on evidence;
create policy "evidence upload owned complaint or officer" on evidence for insert with check (
  uploader_id = auth.uid() and (
    (complaint_id is not null and (public.is_officer() or exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid())))
    or (project_id is not null and public.is_officer())
  )
);

drop policy if exists "project links read" on project_complaints;
create policy "project links read related" on project_complaints for select using (
  public.is_officer() or exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid())
);

drop policy if exists "duplicate links write officers" on complaint_duplicate_links;
create policy "duplicate links write officers" on complaint_duplicate_links for all using (public.can_manage_complaint(primary_complaint_id)) with check (
  public.can_manage_complaint(primary_complaint_id) and (created_by is null or created_by = auth.uid()) and (reviewed_by is null or reviewed_by = auth.uid())
);

-- Keep the bucket private and issue signed URLs from the authenticated UI.
update storage.buckets set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf','video/mp4'] where id = 'evidence';
drop policy if exists "evidence objects read authenticated" on storage.objects;
create policy "evidence objects read owned complaint or officer" on storage.objects for select using (
  bucket_id = 'evidence' and auth.uid() is not null and (
    public.is_officer() or (
      exists (select 1 from complaints c where c.id::text = split_part(name, '/', 1) and c.created_by = auth.uid())
    )
  )
);
drop policy if exists "evidence objects upload authenticated" on storage.objects;
create policy "evidence objects upload owned complaint or officer" on storage.objects for insert with check (
  bucket_id = 'evidence' and auth.uid() is not null and (
    public.is_officer() or (
      exists (select 1 from complaints c where c.id::text = split_part(name, '/', 1) and c.created_by = auth.uid())
    )
  )
);

revoke all on function public.create_complaint(text, uuid, text, double precision, double precision, text, text, uuid) from public;
revoke all on function public.transition_complaint(uuid, complaint_status, text, uuid, boolean) from public;
revoke all on function public.citizen_verify_complaint(uuid, boolean, text) from public;
grant execute on function public.create_complaint(text, uuid, text, double precision, double precision, text, text, uuid) to authenticated;
grant execute on function public.transition_complaint(uuid, complaint_status, text, uuid, boolean) to authenticated;
grant execute on function public.citizen_verify_complaint(uuid, boolean, text) to authenticated;

create or replace function public.can_manage_project(p_project_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_officer() and exists (select 1 from projects p where p.id = p_project_id and (
    public.current_profile_role() = 'Super Admin'
    or p.department_id is null
    or p.department_id = public.current_profile_department()
  ));
$$;

-- Final scope pass: officers may only read or write complaints and related records in
-- their department, assigned queue, or unassigned queue permitted by policy.
drop policy if exists "complaints read scoped" on complaints;
create policy "complaints read scoped" on complaints for select using (
  created_by = auth.uid()
  or public.current_profile_role() = 'Super Admin'
  or (public.is_officer() and (department_id is null or department_id = public.current_profile_department() or assigned_to = auth.uid()))
);

drop policy if exists "complaint supporters read related" on complaint_supporters;
drop policy if exists "supporters read related" on complaint_supporters;
create policy "supporters read related" on complaint_supporters for select using (
  user_id = auth.uid() or public.can_access_complaint(complaint_id)
);

drop policy if exists "history read related" on complaint_status_history;
create policy "history read related" on complaint_status_history for select using (
  public.can_access_complaint(complaint_id)
);

drop policy if exists "ai analysis read related" on complaint_ai_analysis;
create policy "ai analysis read related" on complaint_ai_analysis for select using (
  public.can_access_complaint(complaint_id)
);
drop policy if exists "ai analysis insert related" on complaint_ai_analysis;
create policy "ai analysis insert related" on complaint_ai_analysis for insert with check (
  public.can_access_complaint(complaint_id) and (accepted_by is null or accepted_by = auth.uid())
);
drop policy if exists "ai analysis update related" on complaint_ai_analysis;
create policy "ai analysis update related" on complaint_ai_analysis for update using (
  public.can_access_complaint(complaint_id)
) with check (
  public.can_access_complaint(complaint_id) and (accepted_by is null or accepted_by = auth.uid())
);

drop policy if exists "duplicate links read related" on complaint_duplicate_links;
create policy "duplicate links read related" on complaint_duplicate_links for select using (
  public.can_access_complaint(primary_complaint_id) or public.can_access_complaint(duplicate_complaint_id)
);

drop policy if exists "project links citizen pending or officers" on project_complaints;
drop policy if exists "project links write officers" on project_complaints;
create policy "project links insert scoped" on project_complaints for insert with check (
  (relationship_status = 'PENDING' and exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid()))
  or public.can_manage_complaint(complaint_id)
);
create policy "project links update scoped" on project_complaints for update using (
  public.can_manage_complaint(complaint_id)
) with check (
  public.can_manage_complaint(complaint_id) and (reviewed_by is null or reviewed_by = auth.uid())
);

drop policy if exists "evidence read related" on evidence;
create policy "evidence read related" on evidence for select using (
  uploader_id = auth.uid()
  or (complaint_id is not null and public.can_access_complaint(complaint_id))
  or (project_id is not null and public.is_officer())
);

drop policy if exists "evidence upload owned complaint or officer" on evidence;
create policy "evidence upload owned complaint or officer" on evidence for insert with check (
  uploader_id = auth.uid() and (
    (complaint_id is not null and public.can_access_complaint(complaint_id))
    or (project_id is not null and public.is_officer())
  )
);

-- These helpers are used by policies and RPCs, not intended as anonymous public APIs.
revoke all on function public.current_profile_role() from public;
revoke all on function public.current_profile_department() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_officer() from public;
revoke all on function public.can_access_complaint(uuid) from public;
revoke all on function public.can_manage_complaint(uuid) from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_department() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_officer() to authenticated;
grant execute on function public.can_access_complaint(uuid) to authenticated;
grant execute on function public.can_manage_complaint(uuid) to authenticated;

-- Make the default evidence bucket private; no delete policy is intentionally exposed.
update storage.buckets set public = false where id = 'evidence';

create or replace function public.can_access_project(p_project_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects p where p.id = p_project_id and (
    public.current_profile_role() = 'Super Admin'
    or (public.is_officer() and (p.department_id is null or p.department_id = public.current_profile_department()))
  ));
$$;

-- Reassert project-link SELECT scope after replacing the legacy broad policy.
drop policy if exists "project links read related" on project_complaints;
create policy "project links read related" on project_complaints for select using (
  public.can_access_complaint(complaint_id) or public.can_access_project(project_id)
);

drop policy if exists "evidence read related" on evidence;
create policy "evidence read related" on evidence for select using (
  uploader_id = auth.uid()
  or (complaint_id is not null and public.can_access_complaint(complaint_id))
  or (project_id is not null and public.can_access_project(project_id))
);
drop policy if exists "evidence upload owned complaint or officer" on evidence;
create policy "evidence upload owned complaint or officer" on evidence for insert with check (
  uploader_id = auth.uid() and (
    (complaint_id is not null and public.can_access_complaint(complaint_id))
    or (project_id is not null and public.can_manage_project(project_id))
  )
);

drop policy if exists "evidence objects read owned complaint or officer" on storage.objects;
create policy "evidence objects read owned complaint or officer" on storage.objects for select using (
  bucket_id = 'evidence' and auth.uid() is not null and (
    exists (select 1 from complaints c where c.id::text = split_part(name, '/', 1) and public.can_access_complaint(c.id))
    or (split_part(name, '/', 1) = 'project' and exists (select 1 from projects p where p.id::text = split_part(name, '/', 2) and public.can_access_project(p.id)))
  )
);
drop policy if exists "evidence objects upload owned complaint or officer" on storage.objects;
create policy "evidence objects upload owned complaint or officer" on storage.objects for insert with check (
  bucket_id = 'evidence' and auth.uid() is not null and (
    exists (select 1 from complaints c where c.id::text = split_part(name, '/', 1) and public.can_access_complaint(c.id))
    or (split_part(name, '/', 1) = 'project' and exists (select 1 from projects p where p.id::text = split_part(name, '/', 2) and public.can_manage_project(p.id)))
  )
);
revoke all on function public.can_access_project(uuid) from public;
revoke all on function public.can_manage_project(uuid) from public;
grant execute on function public.can_access_project(uuid) to authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;

-- Preserve the intended self-service profile name update while keeping role and
-- department escalation unavailable to citizens through the row check.
drop policy if exists "admins update profiles" on profiles;
create policy "profiles self basic or admins" on profiles for update using (
  id = auth.uid() or public.is_admin()
) with check (
  (id = auth.uid() and role = 'Citizen') or public.is_admin()
);

-- A reviewer must be scoped to both complaints in a relationship.
drop policy if exists "duplicate links write officers" on complaint_duplicate_links;
create policy "duplicate links write officers" on complaint_duplicate_links for all using (
  public.can_manage_complaint(primary_complaint_id) and public.can_manage_complaint(duplicate_complaint_id)
) with check (
  public.can_manage_complaint(primary_complaint_id) and public.can_manage_complaint(duplicate_complaint_id)
  and (created_by is null or created_by = auth.uid())
  and (reviewed_by is null or reviewed_by = auth.uid())
);

-- Use table-specific trigger functions: PostgreSQL record fields are not
-- interchangeable across trigger tables.
create or replace function public.record_evidence_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (new.uploader_id, 'evidence.uploaded', case when new.complaint_id is not null then 'complaint' else 'project' end, coalesce(new.complaint_id, new.project_id), jsonb_build_object('path', new.file_path, 'evidence_type', new.evidence_type));
  return new;
end;
$$;
create or replace function public.record_duplicate_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (coalesce(new.reviewed_by, new.created_by, auth.uid()), 'complaint_duplicate.relationship_changed', 'complaint', new.primary_complaint_id, jsonb_build_object('duplicate_complaint_id', new.duplicate_complaint_id, 'relationship_status', new.relationship_status));
  return new;
end;
$$;
create or replace function public.record_project_link_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (coalesce(new.reviewed_by, auth.uid()), 'project_complaint.relationship_changed', 'complaint', new.complaint_id, jsonb_build_object('project_id', new.project_id, 'relationship_status', new.relationship_status));
  return new;
end;
$$;
create or replace function public.record_supporter_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, entity_type, entity_id) values (new.user_id, 'complaint.supported', 'complaint', new.complaint_id);
  return new;
end;
$$;
create or replace function public.record_ai_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, entity_type, entity_id, metadata) values (coalesce(new.accepted_by, auth.uid()), 'complaint.ai_analysis_saved', 'complaint', new.complaint_id, jsonb_build_object('provider', new.provider, 'is_available', new.is_available));
  return new;
end;
$$;

drop trigger if exists evidence_record_audit on evidence;
create trigger evidence_record_audit after insert on evidence for each row execute function public.record_evidence_audit();
drop trigger if exists complaint_duplicate_record_audit on complaint_duplicate_links;
create trigger complaint_duplicate_record_audit after insert or update on complaint_duplicate_links for each row execute function public.record_duplicate_audit();
drop trigger if exists project_complaint_record_audit on project_complaints;
create trigger project_complaint_record_audit after insert or update on project_complaints for each row execute function public.record_project_link_audit();
drop trigger if exists complaint_supporter_record_audit on complaint_supporters;
create trigger complaint_supporter_record_audit after insert on complaint_supporters for each row execute function public.record_supporter_audit();
drop trigger if exists complaint_ai_record_audit on complaint_ai_analysis;
create trigger complaint_ai_record_audit after insert on complaint_ai_analysis for each row execute function public.record_ai_audit();

create or replace function public.protect_profile_security_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.id = auth.uid() and not public.is_admin() then
    new.role := old.role;
    new.department_id := old.department_id;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_security_fields on profiles;
create trigger protect_profile_security_fields before update on profiles for each row execute function public.protect_profile_security_fields();
