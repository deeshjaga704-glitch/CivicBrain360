# CivicBrain 360 Architecture Report

## Frontend architecture decision

This repository uses **Next.js App Router** as the canonical production frontend. There is no `src/main.tsx` or `vite.config.ts`; the application entry point is `app/page.tsx`, with the Phase 3 workflow at `/phase3`, intelligence center at `/phase3/intelligence`, and AI evidence vision at `/phase3/image-analysis`.

## Phase 2 foundation

- Supabase browser client uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Authentication, profiles, complaints, evidence, project links, status history, notifications and audit logs are persisted through Supabase.
- Role-aware RLS protects citizen, officer and admin operations.
- Duplicate detection, project linking, evidence storage and citizen verification are implemented.

## Phase 3 integration status

Phase 3 is now implemented as an intelligence layer on top of the Phase 2 foundation:

- **AI complaint classification:** `/api/ai/classify` supports an OpenAI provider when configured and a clearly labelled deterministic demo fallback otherwise. Suggestions include category, severity, department, summary, priority and confidence.
- **AI image classification:** `/phase3/image-analysis` sends authenticated civic infrastructure images to the configured OpenAI vision model and returns category, issue, severity, evidence summary and confidence. The feature does not perform person identification.
- **Duplicate intelligence:** existing Phase 3 duplicate detection and review tables identify possible related complaints without automatically merging them.
- **Risk scoring:** `complaint_risk_scores` stores a 0–100 score and risk level using severity, complaint age, nearby same-category complaint density and project pressure.
- **Predictive maintenance:** `phase3_project_intelligence` aggregates repeated/open/high-priority complaints by project to expose infrastructure pressure and maintenance signals.
- **Financial-vs-physical intelligence:** `project_financials` stores budget, spend, maintenance cost, replacement cost and planning horizon. The project intelligence view recommends maintenance or replacement when sufficient cost data exists.
- **Automatic escalation:** `run_phase3_automation()` provides an officer-authorized manual scan, while the protected system runner is invoked hourly by Supabase Cron. Escalation rules cover unresolved age, criticality and local complaint density and create notification/status history.
- **Phase 3 Intelligence Center:** `/phase3/intelligence` provides risk scoring, infrastructure pressure, lifecycle-cost modelling and escalation monitoring for authorized users.

## Safety and scope notes

Phase 3 recommendations are decision-support signals. They do not silently overwrite citizen-entered complaint data, automatically merge complaints, or replace officer judgement. Financial recommendations require project cost data to be meaningful, and model-generated AI features require a configured server-side provider key.

## Supabase deployment

The target CivicBrain360 Supabase project has the Phase 2 and Phase 3 database migrations applied. The Phase 3 migration is also committed at `supabase/migrations/20260826000000_phase3_intelligence.sql` so repository and deployed schema remain aligned.
