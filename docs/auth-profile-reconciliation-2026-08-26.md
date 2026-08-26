# Auth-to-Profile Reconciliation Record

**Date:** 26 August 2026
**Scope:** Production operational record; no application source, migration, RLS policy, trigger, or function permission change was made.

## Purpose

This record documents the approved reconciliation of legacy Supabase Auth users that predated CivicBrain360's `auth.users` → `public.profiles` trigger. It deliberately omits display names, Auth UIDs, email addresses, credentials, tokens, and other sensitive authentication metadata.

## Root cause and live diagnosis

The deployed `on_auth_user_created` trigger and `public.handle_new_user()` function were present and enabled. The function runs as a definer-owned trigger with a fixed search path and creates a default Citizen profile from the new Auth user’s identifier and display-name metadata. A later-created user received a profile in the same transaction, while two earlier Auth users had no corresponding profile. The evidence supports a legacy pre-trigger inventory gap rather than a current RLS, trigger, or permissions failure.

Supabase documents this pattern: application profile tables should reference `auth.users(id)`, enable RLS, and use an `AFTER INSERT` trigger to create a profile for newly created Auth users. A trigger failure can block signup and should be tested carefully.[1] The documentation also explains that an Auth trigger writing outside the `auth` schema requires a function owned by a sufficiently privileged role and marked `SECURITY DEFINER`.[2]

## Approved reconciliation performed

With explicit owner approval, the production database performed a targeted, idempotent backfill for the two missing legacy rows. The operation selected only the existing Auth user identifier and name metadata, inserted a default **Citizen** profile, left the department unset, and used `ON CONFLICT (id) DO NOTHING`.

The operation did **not** alter an existing profile or Auth user. It did **not** create an account, modify a password, delete data, change RLS, alter the Auth trigger, adjust any `SECURITY DEFINER` permission, or modify complaints, evidence, notifications, or audit records.

## Resulting inventory

| Measure | Live result after reconciliation |
|---|---:|
| Citizen profiles | 3 |
| Officer profiles | 0 |
| Department Admin profiles | 0 |
| Total profiles | 3 |
| Total Auth users | 3 |
| Profile rows linked to distinct Auth users | 3 |

All existing Auth users now have a corresponding Citizen profile. The pre-existing Live Citizen profile retained its prior identity, role, department, and creation timestamp.

## Security impact

The reconciliation preserved the existing one-to-one Auth UID/profile relationship and created only the minimum default-privilege profile state required by the application. The profile primary key remains the Auth user identifier, with the existing foreign key to `auth.users(id)` and the existing RLS model intact.

## Verification readiness

The independent authenticated security matrix remains blocked. It requires four genuinely independent test identities with two designated Citizens, one Officer, and one Department Admin. The project currently has only three identities, all Citizens.

The safe next step is to provision two **new dedicated, non-personal** Auth users through an approved administrator workflow, allow the active trigger to create their default Citizen profiles, and assign durable Officer and Department Admin roles through an authorized server-side management path. Existing Citizen profiles should not be deleted or temporarily promoted merely to satisfy a test matrix. After provisioning, rerun the bounded inventory check and begin the authenticated matrix only when four distinct suitable sessions actually exist.

> **SECURITY VERIFICATION BLOCKED**

## Validation

The reconciliation was verified by a bounded Auth/profile comparison and a role-count query. Repository validation also completed with `npm ci`, lint, and type-check passing. The production build passed when run with the standard `NODE_ENV=production`; an inherited non-standard environment value was separately observed to break an initial local build invocation and was not written into source or configuration.

## References

[1]: https://supabase.com/docs/guides/auth/managing-user-data "Supabase — User Management"

[2]: https://supabase.com/docs/guides/troubleshooting/dashboard-errors-when-managing-users-N1ls4A "Supabase — Errors when creating, updating, or deleting users"
