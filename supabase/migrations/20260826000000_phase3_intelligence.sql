-- CivicBrain360 Phase 3 intelligence layer: risk, prediction, finance and escalation.

create table if not exists public.complaint_risk_scores (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade unique,
  risk_score integer not null check (risk_score between 0 and 100), risk_level text not null check (risk_level in ('LOW','MEDIUM','HIGH','CRITICAL')),
  factors jsonb not null default '{}'::jsonb, calculated_at timestamptz not null default now()
);
create table if not exists public.project_financials (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade unique,
  budget_allocated numeric(14,2) not null default 0 check (budget_allocated >= 0), spent_to_date numeric(14,2) not null default 0 check (spent_to_date >= 0),
  routine_maintenance_cost numeric(14,2) not null default 0 check (routine_maintenance_cost >= 0), full_replacement_cost numeric(14,2) not null default 0 check (full_replacement_cost >= 0),
  planning_horizon_years integer not null default 3 check (planning_horizon_years between 1 and 20), updated_at timestamptz not null default now()
);
create table if not exists public.escalation_events (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id) on delete cascade,
  rule_key text not null, rule_reason text not null, created_at timestamptz not null default now(), unique (complaint_id, rule_key)
);
create index if not exists complaint_risk_scores_level_idx on public.complaint_risk_scores(risk_level, calculated_at desc);
create index if not exists escalation_events_created_idx on public.escalation_events(created_at desc);
alter table public.complaint_risk_scores enable row level security;
alter table public.project_financials enable row level security;
alter table public.escalation_events enable row level security;
drop policy if exists "risk scores read related" on public.complaint_risk_scores;
create policy "risk scores read related" on public.complaint_risk_scores for select using (public.is_officer() or exists (select 1 from public.complaints c where c.id = complaint_id and c.created_by = auth.uid()));
drop policy if exists "risk scores write officers" on public.complaint_risk_scores;
create policy "risk scores write officers" on public.complaint_risk_scores for all using (public.is_officer()) with check (public.is_officer());
drop policy if exists "financials read officers" on public.project_financials;
create policy "financials read officers" on public.project_financials for select using (public.is_officer());
drop policy if exists "financials write admins" on public.project_financials;
create policy "financials write admins" on public.project_financials for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "escalations read officers" on public.escalation_events;
create policy "escalations read officers" on public.escalation_events for select using (public.is_officer());
create or replace function public.calculate_complaint_risk(p_complaint_id uuid) returns public.complaint_risk_scores language plpgsql security definer set search_path = public as $$
declare c public.complaints%rowtype; nearby_count integer := 0; project_open_count integer := 0; age_days numeric := 0; base_score integer := 20; score integer; level text; result public.complaint_risk_scores%rowtype;
begin
 select * into c from public.complaints where id=p_complaint_id; if not found then raise exception 'Complaint not found'; end if;
 age_days := greatest(0, extract(epoch from (now()-c.created_at))/86400.0);
 base_score := case upper(c.severity) when 'CRITICAL' then 75 when 'HIGH' then 55 when 'MEDIUM' then 35 else 20 end;
 select count(*) into nearby_count from public.complaints x where x.id<>c.id and x.status not in ('CLOSED','REJECTED') and x.category_id=c.category_id and x.created_at>=now()-interval '90 days' and abs(x.latitude-c.latitude)<=0.01 and abs(x.longitude-c.longitude)<=0.01;
 if c.project_id is not null then select count(*) into project_open_count from public.complaints x where x.project_id=c.project_id and x.status not in ('CLOSED','REJECTED'); end if;
 score := least(100, base_score + least(15,floor(age_days*1.5))::integer + least(20,nearby_count*4) + case when project_open_count>=5 then 10 when project_open_count>=3 then 5 else 0 end);
 level := case when score>=80 then 'CRITICAL' when score>=60 then 'HIGH' when score>=35 then 'MEDIUM' else 'LOW' end;
 insert into public.complaint_risk_scores(complaint_id,risk_score,risk_level,factors,calculated_at) values(c.id,score,level,jsonb_build_object('severity',c.severity,'age_days',round(age_days,1),'nearby_open_same_category',nearby_count,'project_open_complaints',project_open_count),now()) on conflict(complaint_id) do update set risk_score=excluded.risk_score,risk_level=excluded.risk_level,factors=excluded.factors,calculated_at=now() returning * into result;
 return result;
end; $$;
grant execute on function public.calculate_complaint_risk(uuid) to authenticated;
create or replace view public.phase3_project_intelligence as
select p.id,p.name,p.panchayat,p.status,coalesce(count(c.id),0)::integer complaint_count,count(c.id) filter(where c.status not in ('CLOSED','REJECTED'))::integer open_complaints,count(c.id) filter(where c.severity in ('HIGH','CRITICAL') and c.status not in ('CLOSED','REJECTED'))::integer high_priority_complaints,
coalesce(f.budget_allocated,0)::numeric budget_allocated,coalesce(f.spent_to_date,0)::numeric spent_to_date,greatest(coalesce(f.budget_allocated,0)-coalesce(f.spent_to_date,0),0)::numeric remaining_budget,coalesce(f.routine_maintenance_cost,0)::numeric routine_maintenance_cost,coalesce(f.full_replacement_cost,0)::numeric full_replacement_cost,coalesce(f.planning_horizon_years,3)::integer planning_horizon_years,
case when coalesce(f.full_replacement_cost,0)>0 and coalesce(f.routine_maintenance_cost,0)>0 and count(c.id) filter(where c.status not in ('CLOSED','REJECTED'))*f.routine_maintenance_cost*coalesce(f.planning_horizon_years,3)>=f.full_replacement_cost then 'REPLACEMENT' when coalesce(f.routine_maintenance_cost,0)>0 and count(c.id) filter(where c.status not in ('CLOSED','REJECTED'))>0 then 'MAINTENANCE' else 'DATA_NEEDED' end recommended_intervention
from public.projects p left join public.complaints c on c.project_id=p.id left join public.project_financials f on f.project_id=p.id group by p.id,p.name,p.panchayat,p.status,f.budget_allocated,f.spent_to_date,f.routine_maintenance_cost,f.full_replacement_cost,f.planning_horizon_years;
grant select on public.phase3_project_intelligence to authenticated;

create or replace function public.run_phase3_automation_system() returns integer language plpgsql security definer set search_path=public as $$
declare c public.complaints%rowtype; nearby_count integer; rule_key text; reason text; escalated integer:=0; target uuid;
begin
 for c in select * from public.complaints where status not in ('CLOSED','REJECTED','ESCALATED') loop
  perform public.calculate_complaint_risk(c.id);
  select count(*) into nearby_count from public.complaints x where x.id<>c.id and x.status not in ('CLOSED','REJECTED') and x.category_id=c.category_id and x.created_at>=now()-interval '14 days' and abs(x.latitude-c.latitude)<=0.005 and abs(x.longitude-c.longitude)<=0.005;
  rule_key:=null; reason:=null;
  if c.created_at<=now()-interval '30 days' then rule_key:='AGE_30_DAYS'; reason:='Complaint remained unresolved for more than 30 days.';
  elsif nearby_count>=5 then rule_key:='DENSITY_5_IN_14_DAYS'; reason:='Five or more similar open complaints were reported nearby within 14 days.';
  elsif c.severity='CRITICAL' and c.created_at<=now()-interval '7 days' then rule_key:='CRITICAL_7_DAYS'; reason:='Critical complaint remained unresolved for more than 7 days.'; end if;
  if rule_key is not null then
   insert into public.escalation_events(complaint_id,rule_key,rule_reason) values(c.id,rule_key,reason) on conflict(complaint_id,rule_key) do nothing;
   if found then
    update public.complaints set status='ESCALATED',updated_at=now() where id=c.id;
    insert into public.complaint_status_history(complaint_id,from_status,to_status,changed_by,reason) values(c.id,c.status,'ESCALATED',null,reason);
    target:=c.assigned_to;
    if target is not null then insert into public.notifications(user_id,title,body) values(target,'Complaint escalated automatically',format('#%s was escalated: %s',left(c.id::text,8),reason));
    else insert into public.notifications(user_id,title,body) select p.id,'Complaint escalated automatically',format('#%s was escalated: %s',left(c.id::text,8),reason) from public.profiles p where p.role in ('Department Admin','Super Admin') and (c.department_id is null or p.department_id=c.department_id); end if;
    escalated:=escalated+1;
   end if;
  end if;
 end loop;
 return escalated;
end; $$;
revoke execute on function public.run_phase3_automation_system() from public, anon, authenticated;

create or replace function public.run_phase3_automation() returns integer language plpgsql security definer set search_path=public as $$
begin
 if not public.is_officer() then raise exception 'Officer access required'; end if;
 return public.run_phase3_automation_system();
end; $$;
grant execute on function public.run_phase3_automation() to authenticated;

do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron not enabled; use the Phase 3 Intelligence Center for a manual scan.'; end $$;
select cron.unschedule('civicbrain360-phase3-escalation-hourly');
select cron.schedule('civicbrain360-phase3-escalation-hourly','0 * * * *','select public.run_phase3_automation_system();');
