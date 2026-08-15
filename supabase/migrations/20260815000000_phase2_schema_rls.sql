create extension if not exists pgcrypto;

do $$ begin create type app_role as enum ('Citizen','Officer','Department Admin','Super Admin'); exception when duplicate_object then null; end $$;
do $$ begin create type complaint_status as enum ('SUBMITTED','VERIFIED','ASSIGNED','IN_PROGRESS','RESOLVED','CITIZEN_VERIFICATION','CLOSED','REJECTED','ON_HOLD','ESCALATED','REOPENED'); exception when duplicate_object then null; end $$;

create table if not exists departments (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now());
create table if not exists categories (id uuid primary key default gen_random_uuid(), name text not null unique, is_active boolean not null default true, created_at timestamptz not null default now());
create table if not exists profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, role app_role not null default 'Citizen', department_id uuid references departments(id), created_at timestamptz not null default now());
create table if not exists projects (id uuid primary key default gen_random_uuid(), name text not null, description text, category_id uuid references categories(id), department_id uuid references departments(id), panchayat text, status text not null default 'PLANNED', latitude double precision, longitude double precision, created_at timestamptz not null default now());
create table if not exists complaints (id uuid primary key default gen_random_uuid(), category_id uuid not null references categories(id), description text not null, latitude double precision not null, longitude double precision not null, address text, severity text not null, status complaint_status not null default 'SUBMITTED', created_by uuid not null references profiles(id), assigned_to uuid references profiles(id), department_id uuid references departments(id), project_id uuid references projects(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists complaint_supporters (complaint_id uuid references complaints(id) on delete cascade, user_id uuid references profiles(id) on delete cascade, created_at timestamptz not null default now(), primary key (complaint_id, user_id));
create table if not exists project_complaints (project_id uuid references projects(id) on delete cascade, complaint_id uuid references complaints(id) on delete cascade, relationship_status text not null default 'PENDING' check (relationship_status in ('PENDING','CONFIRMED','REJECTED')), reviewed_by uuid references profiles(id), created_at timestamptz not null default now(), primary key(project_id, complaint_id));
create table if not exists complaint_status_history (id uuid primary key default gen_random_uuid(), complaint_id uuid not null references complaints(id) on delete cascade, from_status complaint_status, to_status complaint_status not null, changed_by uuid references profiles(id), reason text, created_at timestamptz not null default now());
create table if not exists evidence (id uuid primary key default gen_random_uuid(), complaint_id uuid references complaints(id) on delete cascade, project_id uuid references projects(id) on delete cascade, uploader_id uuid not null references profiles(id), file_path text not null, file_url text, evidence_type text not null, latitude double precision, longitude double precision, metadata jsonb not null default '{}', created_at timestamptz not null default now(), check (complaint_id is not null or project_id is not null));
create table if not exists notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());
create table if not exists audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references profiles(id), action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());

create or replace function public.current_profile_role() returns app_role language sql stable security definer set search_path = public as $$ select coalesce((select role from public.profiles where id = auth.uid()), 'Citizen'::app_role) $$;
create or replace function public.current_profile_department() returns uuid language sql stable security definer set search_path = public as $$ select department_id from public.profiles where id = auth.uid() $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select public.current_profile_role() in ('Department Admin','Super Admin') $$;
create or replace function public.is_officer() returns boolean language sql stable security definer set search_path = public as $$ select public.current_profile_role() in ('Officer','Department Admin','Super Admin') $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'Citizen')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table profiles enable row level security; alter table projects enable row level security; alter table complaints enable row level security; alter table complaint_supporters enable row level security; alter table project_complaints enable row level security; alter table complaint_status_history enable row level security; alter table evidence enable row level security; alter table notifications enable row level security; alter table audit_logs enable row level security; alter table departments enable row level security; alter table categories enable row level security;

drop policy if exists "profiles self basic update or admins" on profiles;
drop policy if exists "reference read" on categories;
drop policy if exists "citizens update own nonstatus fields" on complaints;
drop policy if exists "project links write officers" on project_complaints;
drop policy if exists "history write authenticated" on complaint_status_history;
drop policy if exists "notifications own" on notifications;
drop policy if exists "notifications system insert" on notifications;
drop policy if exists "profiles self or admins read" on profiles; create policy "profiles self or admins read" on profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles self insert" on profiles; create policy "profiles self insert" on profiles for insert with check (id = auth.uid() and role = 'Citizen');
drop policy if exists "profiles self update or admins" on profiles; create policy "profiles self update or admins" on profiles for update using (id = auth.uid() or public.is_admin()) with check ((id = auth.uid() and role = 'Citizen') or public.is_admin());
drop policy if exists "categories read" on categories; create policy "categories read" on categories for select using (true);
drop policy if exists "departments read" on departments; create policy "departments read" on departments for select using (auth.uid() is not null);
drop policy if exists "admins manage categories" on categories; create policy "admins manage categories" on categories for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage departments" on departments; create policy "admins manage departments" on departments for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "projects read" on projects; create policy "projects read" on projects for select using (true);
drop policy if exists "officers manage projects" on projects; create policy "officers manage projects" on projects for all using (public.is_officer() and (public.current_profile_role()='Super Admin' or department_id is null or department_id = public.current_profile_department())) with check (public.is_officer() and (public.current_profile_role()='Super Admin' or department_id is null or department_id = public.current_profile_department()));
drop policy if exists "complaints read scoped" on complaints; create policy "complaints read scoped" on complaints for select using (created_by = auth.uid() or public.is_officer());
drop policy if exists "citizens create own complaints" on complaints; create policy "citizens create own complaints" on complaints for insert with check (created_by = auth.uid() and status='SUBMITTED');
drop policy if exists "citizens update own verification" on complaints; create policy "citizens update own verification" on complaints for update using (created_by = auth.uid()) with check (created_by = auth.uid() and status in ('CLOSED','REOPENED'));
drop policy if exists "officers update complaints" on complaints; create policy "officers update complaints" on complaints for update using (public.is_officer() and (public.current_profile_role()='Super Admin' or department_id is null or department_id = public.current_profile_department())) with check (public.is_officer());
drop policy if exists "supporters own insert" on complaint_supporters; create policy "supporters own insert" on complaint_supporters for insert with check (user_id = auth.uid());
drop policy if exists "supporters read related" on complaint_supporters; create policy "supporters read related" on complaint_supporters for select using (user_id = auth.uid() or public.is_officer());
drop policy if exists "project links read" on project_complaints; create policy "project links read" on project_complaints for select using (true);
drop policy if exists "project links citizen pending or officers" on project_complaints; create policy "project links citizen pending or officers" on project_complaints for insert with check ((relationship_status='PENDING' and exists(select 1 from complaints c where c.id=complaint_id and c.created_by=auth.uid())) or public.is_officer());
drop policy if exists "project links write officers" on project_complaints; create policy "project links write officers" on project_complaints for update using (public.is_officer()) with check (public.is_officer());
drop policy if exists "history read related" on complaint_status_history; create policy "history read related" on complaint_status_history for select using (public.is_officer() or exists (select 1 from complaints c where c.id=complaint_id and c.created_by=auth.uid()));
drop policy if exists "history write scoped" on complaint_status_history; create policy "history write scoped" on complaint_status_history for insert with check ((changed_by = auth.uid() and exists(select 1 from complaints c where c.id=complaint_id and c.created_by=auth.uid())) or public.is_officer());
drop policy if exists "evidence read related" on evidence; create policy "evidence read related" on evidence for select using (public.is_officer() or uploader_id=auth.uid() or exists(select 1 from complaints c where c.id=complaint_id and c.created_by=auth.uid()));
drop policy if exists "evidence upload own" on evidence; create policy "evidence upload own" on evidence for insert with check (uploader_id=auth.uid());
drop policy if exists "notifications own read" on notifications; create policy "notifications own read" on notifications for select using (user_id=auth.uid());
drop policy if exists "notifications own update" on notifications; create policy "notifications own update" on notifications for update using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "notifications insert authenticated" on notifications; create policy "notifications insert authenticated" on notifications for insert with check (auth.uid() is not null);
drop policy if exists "audit read admins" on audit_logs; create policy "audit read admins" on audit_logs for select using (public.is_admin());
drop policy if exists "audit write authenticated" on audit_logs; create policy "audit write authenticated" on audit_logs for insert with check (auth.uid() is not null);


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', true, 10485760, array['image/jpeg','image/png','image/webp','application/pdf','video/mp4'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "evidence objects read authenticated" on storage.objects;
create policy "evidence objects read authenticated" on storage.objects for select using (bucket_id = 'evidence' and auth.uid() is not null);
drop policy if exists "evidence objects upload authenticated" on storage.objects;
create policy "evidence objects upload authenticated" on storage.objects for insert with check (bucket_id = 'evidence' and auth.uid() is not null);

insert into categories(name) values ('Roads'),('Water'),('Sanitation'),('Streetlights') on conflict do nothing;
insert into departments(name) values ('Public Works'),('Water Supply'),('Sanitation') on conflict do nothing;
