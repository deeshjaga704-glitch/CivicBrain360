-- CivicBrain360 Phase 3: AI analysis, duplicate review, and map query performance.
-- Apply after 20260815000000_phase2_schema_rls.sql.

create table if not exists complaint_ai_analysis (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints(id) on delete cascade,
  provider text not null check (provider in ('openai','demo')),
  is_available boolean not null default false,
  category_suggestion text,
  severity_suggestion text,
  department_suggestion text,
  short_summary text,
  priority_suggestion text check (priority_suggestion in ('LOW','NORMAL','HIGH','URGENT')),
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  raw_response jsonb not null default '{}'::jsonb,
  accepted_category_id uuid references categories(id),
  accepted_severity text,
  accepted_department_id uuid references departments(id),
  accepted_priority text check (accepted_priority is null or accepted_priority in ('LOW','NORMAL','HIGH','URGENT')),
  accepted_summary text,
  accepted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists complaint_duplicate_links (
  id uuid primary key default gen_random_uuid(),
  primary_complaint_id uuid not null references complaints(id) on delete cascade,
  duplicate_complaint_id uuid not null references complaints(id) on delete cascade,
  relationship_status text not null default 'PENDING' check (relationship_status in ('PENDING','CONFIRMED','REJECTED')),
  created_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (primary_complaint_id, duplicate_complaint_id),
  check (primary_complaint_id <> duplicate_complaint_id)
);

create index if not exists complaints_status_idx on complaints(status);
create index if not exists complaints_category_idx on complaints(category_id);
create index if not exists complaints_severity_idx on complaints(severity);
create index if not exists complaints_created_at_idx on complaints(created_at desc);
create index if not exists complaints_location_idx on complaints(latitude, longitude);
create index if not exists complaints_department_idx on complaints(department_id);
create index if not exists complaint_ai_analysis_complaint_idx on complaint_ai_analysis(complaint_id, created_at desc);
create index if not exists complaint_duplicate_links_primary_idx on complaint_duplicate_links(primary_complaint_id, relationship_status);
create index if not exists complaint_duplicate_links_duplicate_idx on complaint_duplicate_links(duplicate_complaint_id, relationship_status);

insert into categories(name) values ('Garbage/Waste'),('Electricity'),('Street Lights'),('Drainage'),('Public Safety'),('Pollution'),('Public Infrastructure'),('Other') on conflict do nothing;

alter table complaint_ai_analysis enable row level security;
alter table complaint_duplicate_links enable row level security;

drop policy if exists "ai analysis read related" on complaint_ai_analysis;
create policy "ai analysis read related" on complaint_ai_analysis for select using (
  public.is_officer() or exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid())
);
drop policy if exists "ai analysis insert related" on complaint_ai_analysis;
create policy "ai analysis insert related" on complaint_ai_analysis for insert with check (
  public.is_officer() or exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid())
);
drop policy if exists "ai analysis update related" on complaint_ai_analysis;
create policy "ai analysis update related" on complaint_ai_analysis for update using (
  public.is_officer() or exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid())
) with check (
  public.is_officer() or exists (select 1 from complaints c where c.id = complaint_id and c.created_by = auth.uid())
);

drop policy if exists "duplicate links read related" on complaint_duplicate_links;
create policy "duplicate links read related" on complaint_duplicate_links for select using (
  public.is_officer() or exists (select 1 from complaints c where c.id = primary_complaint_id and c.created_by = auth.uid()) or exists (select 1 from complaints c where c.id = duplicate_complaint_id and c.created_by = auth.uid())
);
drop policy if exists "duplicate links write officers" on complaint_duplicate_links;
create policy "duplicate links write officers" on complaint_duplicate_links for all using (public.is_officer()) with check (public.is_officer());

create or replace function public.set_complaint_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists complaints_set_updated_at on complaints;
create trigger complaints_set_updated_at before update on complaints for each row execute function public.set_complaint_updated_at();

drop trigger if exists complaint_ai_analysis_set_updated_at on complaint_ai_analysis;
create trigger complaint_ai_analysis_set_updated_at before update on complaint_ai_analysis for each row execute function public.set_complaint_updated_at();
