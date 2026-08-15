# CivicBrain 360 Phase 2 Architecture Report

## Frontend architecture decision

This repository now uses **Next.js App Router** as the single canonical production frontend. There is no `src/main.tsx` or `vite.config.ts`; the only application entry point is `app/page.tsx`.

## Phase 2 integration status

- Supabase browser client: implemented with the same project URL/key pair everywhere via `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Authentication: registration, login, logout, persisted sessions, and profile lookup use Supabase Auth. Public self-registration always creates `Citizen` profiles; Officer/Admin roles must be assigned by an authorized admin, not by client-side role switching.
- Complaints: citizen issue submission persists to `complaints` and creates status history, notification, and audit records.
- Duplicate detection: searches unresolved complaints by category and local haversine distance. Users can support an existing report or continue with a new report.
- Project linking: nearby project lookup and `project_complaints` persistence are implemented. Officer confirmation/rejection is enforced through role checks and RLS.
- Evidence storage: uploads validated files to the `evidence` Supabase Storage bucket and persists evidence metadata.
- Status lifecycle: status transitions update complaints and write `complaint_status_history`, `audit_logs`, and notifications.
- Citizen verification: yes closes the complaint; no reopens with the rejection reason via the status transition path.
- Officer/admin operations: the starter dashboard calls real complaint/project queries and status mutation helpers; database RLS restricts authority.
- Notifications and audit logs: persisted for key complaint actions.
- Project explorer/map data source: project and complaint coordinates now come from database queries, not hard-coded production positions.
- Demo seed data: only reference categories/departments are inserted idempotently by migration. No user data is overwritten.
- RLS/security: baseline role-aware policies are included for profiles, projects, complaints, supporters, project links, status history, evidence, notifications, audit logs, departments, categories, and storage objects. These policies must still be validated against the deployed Supabase project before claiming production-ready security.

## Manual Supabase setup still required

1. Apply `supabase/migrations/20260815000000_phase2_schema_rls.sql` to the target Supabase project.
2. Ensure the `evidence` bucket exists if you do not apply the migration through Supabase SQL.
3. Assign Officer, Department Admin, and Super Admin roles by updating `profiles.role` as an existing admin/service-side operation; do not expose service-role keys to the browser.

## Explicit non-goals

Phase 3 features were not implemented: no AI image classification, risk scoring, predictive maintenance, financial-vs-physical intelligence, or automatic escalation.
