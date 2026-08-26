# CivicBrain360

AI-powered civic intelligence and government project accountability platform.

## Architecture

CivicBrain 360 uses a single Next.js App Router frontend. The prior reported Next.js/Vite duplication is reconciled by keeping only the Next.js production entry point in `app/page.tsx`; there is no Vite entry point in this repository.

## Setup

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Apply the migrations in this order to your Supabase project: `20260815000000_phase2_schema_rls.sql`, `20260822000000_phase3_ai_map_duplicates.sql`, `20260822000001_final_hardening.sql`, `20260822000002_storage_path_scope_fix.sql`, and `20260822000003_function_acl_and_search_path_fix.sql`.
3. Keep the `evidence` Storage bucket private. The final hardening migration creates authenticated complaint/project-scoped Storage policies; complaint details request short-lived signed URLs rather than exposing public file URLs.
4. Run `npm install`, then `npm run dev`.

The report form stores a required complaint title, description, category, severity, coordinates, address/landmark, optional project link, and optional image/document/video evidence. Evidence uploaded during submission is stored in Supabase Storage and associated with the created complaint in the `evidence` table. Evidence can also be added later from the complaint detail view. The Phase 3 dashboard includes the `/map` route with protected complaint markers and filters, duplicate-review relationships, and optional AI classification. AI defaults to a deterministic demo fallback; set `AI_PROVIDER=openai`, an optional `OPENAI_API_BASE`, and a server-only `OPENAI_API_KEY` to enable provider-backed suggestions. AI classification requires an authenticated Supabase session.

See `docs/architecture-report.md` for the Phase 2 backend integration report.
