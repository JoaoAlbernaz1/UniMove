# UniCarona Admin backend integration plan

> **For agentic workers:** Use subagent-driven-development for the isolated security tasks and requesting-code-review for final review. Track execution in the plan ledger.

**Goal:** Integrate the administrative backend into the original UniMove repository, close the documented access/2FA risks, and open a reviewable PR before 06/11/2026.

**Architecture:** Apply the backend-only delta from `25f07f3` onto original `main` at `e07cfeb`, using the shared ancestor `fb25c8b`. Keep the existing NestJS/PostgreSQL service, tables and student routes. Administrative enrollment must require a trusted operator outside the password-only HTTP flow; the panel retains cookie sessions and MFA.

**Tech Stack:** Node 24, NestJS 11, Prisma 7, PostgreSQL 17, Jest, Supertest.

**Spec:** The user's ten integration requirements in this conversation; this document records implementation decisions and acceptance checks.

## Global constraints

- Work only on `feat/admin-backend-integration`, in a separate worktree.
- Do not merge, run production migrations, deploy, create cloud resources, read secret values or change credentials.
- Do not change the admin interface or weaken authentication to hide the 404.
- Preserve original `main` and the later student history correction at `e07cfeb`.
- No new production database or schema migration is required; use existing tables.
- Integration tests may destroy only the isolated localhost database `unimove_admin_integration_20261104_test` created for this task.
- Keep JWT secrets, DATABASE_URL and TWO_FACTOR_ENCRYPTION_KEY out of output, commits and artifacts.

## Task 1: Transfer and compare the existing backend

**Files:** the 45 backend/config paths in the delta `fb25c8b..25f07f3`; exclude `UniMove-front` and `UniMove-admin`.

- [x] Generate Prisma with a synthetic localhost DATABASE_URL, then record original unit/type/lint/build results.
- [x] Confirm `git diff fb25c8b..e07cfeb -- UniMove-back render.yaml` is empty.
- [x] Apply a three-way patch: `git apply --3way --index admin-backend-source.patch`.
- [x] Confirm `prisma/schema.prisma` and migrations match original main.
- [x] Run the imported backend unit tests and record any pre-existing formatting failures separately.

## Task 2: Close password-only admin enrollment and bound app access

**Owner files:** `src/modules/admin/admin-auth.service*`, new administrative enrollment service/CLI/tests, `src/common/guards/jwt-auth.guard*`, `src/common/guards/roles.guard*`, `src/modules/auth/auth.service*`, `src/modules/auth/two-factor-crypto*`, `src/modules/users/settings.controller*`. Coordinator updates package scripts/module wiring.

**Interfaces:** the shared `AuthAttemptLimiter` methods become asynchronous: `assertAllowed(key): Promise<void>`, `recordFailure(key): Promise<void>`, `reset(key): Promise<void>`, `claimCode(userId, code): Promise<boolean>`. Await every invocation. Keep HTTP responses for already-enrolled admins and ordinary students compatible.

- [x] Add failing tests that correct admin password without enabled 2FA returns `403 ADMIN_ENROLLMENT_REQUIRED`, without a QR, secret or session.
- [x] Remove HTTP self-enrollment for admins in both panel login and app settings setup/enable/disable. Ordinary student setup remains supported.
- [x] Implement operator-only `begin(email)` / `confirm(email, code)` enrollment using existing encrypted `two_factor_auth` and recovery codes; never overwrite an active factor. Require the configured encryption key. No public provisioning endpoint.
- [x] Add an explicit CLI that runs only by operator invocation, shows the enrollment QR privately and reads the verification code interactively. Do not execute it against production.
- [x] Restrict app Bearer credentials on administrative routes to academic verification, with current ADMIN role and MFA checked in the database. Cookie sessions remain valid for the panel's administrative routes only.
- [x] Test `GET /admin/users` with app Bearer -> 403, academic verification with ADMIN+MFA Bearer -> permitted, removed ADMIN role -> 403, student routes remain permitted.
- [x] Require a dedicated encryption key for new production 2FA writes; preserve the ability to read and migrate historical ciphertext without rotating JWT/database credentials.

## Task 3: Account deletion and last-admin invariants

**Owner files:** `src/modules/users/account-deletion.service*`, `src/modules/admin/admin-invariants.ts`; add a separate focused integration test file if needed, not the shared `test/admin.integration.cjs`.

**Interfaces:** both deletion and restriction acquire `lockAdminInvariant(tx)` before reading current status/roles or valid-admin counts. Keep `assertNotLastAdmin(tx, userId)` compatible with administrative user status changes.

- [x] Add failing tests for deletion clearing phone, two-factor records and push-device tokens in the same transaction.
- [x] Acquire the shared advisory lock before the deletion's current-account read; prevent concurrent suspension/deletion from removing every valid administrator.
- [x] Preserve administrative decisions on third parties while anonymizing the deleted account's own sensitive metadata.
- [x] Test rollback and concurrency on a real disposable PostgreSQL database.

## Task 4: Persistent brute-force and TOTP replay protection

**Owner files:** `src/modules/auth/auth-attempt-limiter.ts`, its unit tests and a separate focused integration test file. Do not edit the callers owned by Task 2.

**Interfaces:** keep method names and thresholds (8 consecutive failures, 15-minute lock; a TOTP cannot be reused during its acceptance window). Methods return promises as specified above. Use `PrismaService`/existing indexed `audit_logs` and transaction-scoped advisory locks; store fingerprints, never raw passwords, emails, OTPs or secrets.

- [x] Write failing tests that two limiter instances sharing PostgreSQL see each other's failures and TOTP consumption.
- [x] Implement persisted failures/reset/block and atomically claim a code with `pg_advisory_xact_lock`, binding its fingerprint to the user and a server-side secret.
- [x] Test that process recreation does not reset a lock, parallel TOTP claims allow exactly one success, and expiry eventually permits a new claim.
- [x] Explain retention/performance implications; keep all code changes schema-compatible.

## Task 5: Integration, compatibility and publication procedure

**Owner files:** `test/admin.integration.cjs`, `test/ride-queries.integration.cjs`, `src/main.ts`, `src/config/configuration.ts`, package/module wiring, `render.yaml`, `.env.example`, CI and `docs/ADMIN_BACKEND_INTEGRATION.md`.

- [ ] Adapt the initial enrollment integration case to trusted provisioning and assert HTTP bootstrap is denied.
- [ ] Fix the student ride fixture to include approved academic verification, matching the real search rule.
- [ ] Run student register/login/refresh/profile/ride search/reservation/chat compatibility checks; preserve array responses and paths.
- [ ] Run `npm test`, `npm run test:integration`, `npm run test:admin-integration`, focused security integration tests, `npm run typecheck`, `npm run lint`, `npm run build`.
- [ ] Fix formatting-only lint failures, without changing student behavior or visual design.
- [ ] Document bounded reverse-proxy trust and verify its parsing; do not trust arbitrary forwarded headers.
- [ ] Keep Render tied to `JoaoAlbernaz1/UniMove`, existing `unimove-api`, existing database and main branch. Prepare config only.
- [ ] Document ADMIN_PANEL_ORIGINS (explicit exact origins, no wildcard) and TWO_FACTOR_ENCRYPTION_KEY (preserve existing value, never print it), operator enrollment and rollback.
- [ ] Record the exact approval-gated publication order, including automatic deploy and existing start-command migrations.
- [ ] Obtain an independent security/compatibility review, resolve important findings, commit/push and open a PR into original main. Stop before merge/deploy/production migrations.
