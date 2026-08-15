# CivicBrain360

AI-powered civic intelligence and government project accountability platform.

## Architecture

CivicBrain 360 uses a single Next.js App Router frontend. The prior reported Next.js/Vite duplication is reconciled by keeping only the Next.js production entry point in `app/page.tsx`; there is no Vite entry point in this repository.

## Setup

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Apply the SQL migration in `supabase/migrations/20260815000000_phase2_schema_rls.sql` to your Supabase project.
3. Create a Supabase Storage bucket named `evidence` or set `NEXT_PUBLIC_EVIDENCE_BUCKET`.
4. Run `npm install` and `npm run dev`.

See `docs/architecture-report.md` for the Phase 2 backend integration report.
