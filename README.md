# empireNigeria API

NestJS API using hosted PostgreSQL, Prisma, and Resend.

## Setup

1. Copy `.env.example` to `.env` and supply the hosted database URL, separate JWT secrets, Resend credentials, and frontend URLs.
2. Run `npm install`, `npm run prisma:generate`, and `npx prisma migrate deploy`.
3. Start with `npm run start:dev`, or build with `npm run build` and start with `npm run start:prod`.
4. Set the frontend's `VITE_API_URL` to this API's `/api/v1` URL. Configure `CORS_ORIGINS` with the exact frontend origins.

Docker is optional; the normal configuration uses hosted PostgreSQL. Do not use a database reset command against the hosted database.

`NODE_ENV=development` identifies a local/development environment; use `NODE_ENV=production` on the deployed backend. The value does not start watch mode by itself: `npm run start:dev` does that. With valid Resend settings, emails are sent in either environment. Development can start without an email API key, but no email is delivered in that case; production startup requires both `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

Administrator accounts are created internally. The optional existing seed script creates only the administrator and must be given a private `SEED_PASSWORD`; it is not required to run migrations and is not a way to onboard staff. Owners and guests register publicly. Property managers, inspectors, and contractors receive administrator-created invitations.

New properties start as drafts and require completed, categorized ownership evidence before `POST /properties/:id/submit` sends them for review. Documents accept PDF, JPEG, or PNG up to 5,000,000 bytes each. Existing property statuses are preserved by the migration. See [property ownership and submission](docs/property-ownership.md) for the API sequence, storage access, and rollout.

## Account endpoints

All paths below are under `/api/v1`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /auth/register | Owner/Guest registration; returns a pending user and verification challenge |
| POST | /auth/login | Password authentication; returns tokens or a pending-verification response |
| POST | /auth/verification/resend | Request another email-verification code |
| POST | /auth/verify | Verify `challengeId` and six-digit `code` |
| POST | /auth/password-reset/request | Request recovery by email; response does not disclose account existence |
| POST | /auth/password-reset/verify | Exchange a valid code for a short-lived reset token |
| POST | /auth/password-reset/complete | Consume `challengeId`, `resetToken`, and the new password |
| POST | /auth/invitations/accept | Set the invited account's password and establish its session |
| POST | /auth/refresh | Rotate a refresh token |
| POST | /auth/logout | Revoke the account's sessions |
| GET/PATCH | /auth/me | Read/update the authenticated profile |
| GET/DELETE | /auth/me/avatar | Read a short-lived profile image URL or remove the image |
| POST | /auth/me/avatar/uploads | Begin a signed profile image upload |
| POST | /auth/me/avatar/uploads/:id/complete | Verify and publish a profile image |
| GET | /admin/users | Administrator-only user listing |
| GET | /admin/overview | Real account/property counts and recent records |
| GET | /admin/analytics | Six-month property, inspection, and maintenance totals plus current maintenance statuses |
| GET | /admin/audit | Paginated audit events; optional `cursor`, `action`, and `entityType` filters |
| GET | /stay | Public published listings; optional location, dates, and guest filters |
| GET | /stay/:id | Public published listing |
| GET | /stay/:id/availability | Public daily availability between `from` and `to` |
| GET/POST | /stay/manage/mine, /stay | Owner/admin listing management or owner draft creation |
| PATCH/POST | /stay/:id, /stay/:id/submit | Owner edits a draft or submits it for review |
| POST | /stay/:id/review | Administrator publishes or rejects a submitted listing |
| POST/DELETE | /stay/:id/blocks, /stay/:id/blocks/:blockId | Owner/admin date blocks |
| GET/POST | /bookings | Role-scoped booking list or guest reservation request |
| GET | /bookings/:id | Booking detail for the guest or authorized property team |
| POST | /bookings/:id/decision | Owner/admin confirms or declines a request |
| POST | /bookings/:id/cancel | Authorized cancellation before check-in |
| POST | /bookings/:id/complete | Owner/admin closes a stay after check-out |
| GET/POST/PATCH | /tasks, /tasks/:id | Managed-property tasks and status changes |
| GET/PATCH | /occupancy, /occupancy/:propertyId | Scoped occupancy records and change history |
| GET/POST | /financials, /financials/expenses | Scoped financial summary and actual expense entries |
| GET | /reports | Scoped current portfolio snapshot and monthly activity; optional inclusive `from`/`to` dates |
| GET/POST | /properties | List accessible properties or submit an owner property |
| GET/PATCH | /properties/:id | Read or update a property, subject to ownership and role checks |
| PATCH | /properties/:id/review | Administrator review status and note |
| PATCH | /properties/:id/manager | Assign an active property manager |
| POST | /properties/:id/files | Begin a signed Supabase Storage upload |
| POST | /properties/:id/files/:fileId/complete | Verify uploaded bytes and attach the file |
| GET | /properties/:id/files/:fileId/url | Short-lived photo or document URL; optional `download=true/false` |
| DELETE | /properties/:id/files/:fileId | Remove an authorized property file |
| GET/POST | /maintenance | Role-scoped request list or owner issue report |
| GET | /maintenance/:id | Read an authorized maintenance request and its progress history |
| POST | /maintenance/:id/assign | Administrator assigns an active contractor |
| POST | /maintenance/:id/quotes | Assigned contractor submits or revises a quote |
| POST | /maintenance/:id/quotes/:quoteId/decision | Owner approves or rejects the latest quote |
| POST | /maintenance/:id/start | Assigned contractor starts work after owner approval |
| POST | /maintenance/:id/progress | Assigned contractor posts progress |
| POST | /maintenance/:id/complete | Assigned contractor completes work after adding completion evidence |
| POST | /maintenance/:id/close | Administrator closes completed work |
| POST | /maintenance/:id/evidence | Begin a private issue, work, or completion evidence upload |
| POST | /maintenance/:id/evidence/:evidenceId/complete | Verify uploaded bytes and publish evidence |
| GET | /maintenance/:id/evidence/:evidenceId/url | Short-lived evidence URL for authorized request viewers |
| DELETE | /maintenance/:id/evidence/:evidenceId | Remove an authorized upload before closeout |
| GET/POST | /inspections | Role-scoped list or administrator scheduling |
| GET | /inspections/:id | Read an authorized inspection |
| PATCH | /inspections/:id/schedule | Administrator rescheduling or reassignment before the visit starts |
| POST | /inspections/:id/cancel | Administrator cancellation of an open inspection |
| POST | /inspections/:id/start | Assigned inspector starts the visit |
| POST | /inspections/:id/complete | Assigned inspector completes the visit |
| POST | /inspections/:id/report | Assigned inspector submits the final report and findings |
| POST | /inspections/:id/evidence | Begin an inspector evidence upload |
| POST | /inspections/:id/evidence/:evidenceId/complete | Verify and publish uploaded evidence |
| GET | /inspections/:id/evidence/:evidenceId/url | Short-lived evidence URL after authorization |
| DELETE | /inspections/:id/evidence/:evidenceId | Remove evidence before report submission |
| POST | /admin/invitations | Invite a property manager, inspector, or contractor |
| POST | /admin/invitations/:id/resend | Replace an invitation link |
| POST | /admin/invitations/:id/revoke | Revoke an unaccepted invitation |

Codes expire after 15 minutes, permit five attempts, and have a one-minute resend cooldown. Codes are cryptographically random, stored as hashes, and are never returned by the API. The old `DEV_VERIFICATION_CODE` setting is no longer used.

Invitation links expire after 24 hours. Consuming codes, reset authorization, and invitations checks the current database state. Password reset and logout increment the session version, invalidating access and refresh tokens. Protected requests check the current account status and role.

Profiles persist first name, last name, phone, country, and timezone. Email and account role cannot be changed through profile updates.

The frontend uses the API for all account roles, with no demo authentication fallback. Owner property pages, the owner dashboard, property documents, inspections, maintenance, Stay listings, bookings, manager tasks, occupancy, financial summaries, and role-scoped reports use live API data. Payment collection remains a later phase; confirmed booking values and approved quotes are not reported as received income.

## Validation

See [the technical acceptance report](docs/technical-acceptance.md) for actual results and pending external checks.

See [reporting semantics](docs/reporting.md) for date ranges, role scope, event dates, and the distinction between reservation value and received income. Monthly reporting and administrator creation-cohort comparisons use existing tables and require no new migration.

- `npm test -- --watch=false`: mocked unit/regression tests.
- `npx tsc --noEmit -p tsconfig.build.json`: TypeScript validation.
- `npm run build`: production build; entry point is `dist/main.js`.
- `node --env-file=.env scripts/auth-smoke.cjs --email=YOUR_APPROVED_TEST_MAILBOX`: live PostgreSQL/Resend API test.
- `node --env-file=.env scripts/property-smoke.cjs`: temporary property API fixtures on hosted PostgreSQL, removed on completion.
- `node --env-file=.env scripts/storage-smoke.cjs`: temporary PostgreSQL and Supabase Storage fixtures for live photo, document, and profile-image uploads; no email is sent.
- `node --env-file=.env scripts/inspection-smoke.cjs`: temporary inspection, property, user, and evidence fixtures; exercises scheduling through report visibility and removes fixtures; no email is sent.
- `node --env-file=.env scripts/maintenance-smoke.cjs`: temporary maintenance, property, user, and evidence fixtures; exercises quote rejection, revision, owner approval, contractor completion, admin closeout, audit, and analytics, then removes fixtures; no email is sent.
- `node --env-file=.env scripts/stay-operations-smoke.cjs`: temporary Stay, booking, occupancy, task, expense, and user fixtures; exercises publication, overlap prevention, cancellations, reports, audit, and cleanup without payment or email.
- `node --env-file=.env scripts/cleanup-smoke.cjs`: isolated expired-upload fixtures; verifies preview, bounded deletion, and preservation of recent, ready, and unrelated uploads.
- `node --env-file=.env scripts/reporting-smoke.cjs`: bounded read-only hosted reporting SQL and role-scope checks; creates no fixtures and sends no email.
- `node --env-file=.env scripts/acceptance-check.cjs`: runs live workflow checks sequentially. Use `--only=storage,cleanup` to select checks. Include authentication with an authorized `--email=YOUR_APPROVED_TEST_MAILBOX`, or use `--only=auth --email-fixture` for captured messages without Resend delivery.

The live test must only be run with permission to send email to that mailbox. It creates run-scoped fixture accounts, sends all test messages to the approved mailbox, exercises the HTTP endpoints, and deletes its fixtures in a finally block. It never prints passwords, codes, or tokens. A successful Resend API response confirms acceptance by the provider, not arrival in the inbox.

Browser account tests in the frontend use explicit API fixtures; they are separate from the live API test.

## Deployment notes

- Require Resend settings in production and use a verified sender. Set `APP_URL` to the real frontend origin so invitation links lead to the correct site.
- Keep the two JWT secrets different, long, and private. Use HTTPS in production.
- POST authentication endpoints currently have an in-process per-IP rate limit. For multiple API instances, add a shared limiter or an appropriately configured gateway; do not trust arbitrary forwarded IP headers.
- Sessions currently use browser storage with the existing bearer-token design. A deployment hardening pass should evaluate HttpOnly cookies, CSRF protections, and the application CSP together.
- Do not commit `.env`, database URLs, or provider credentials.

## File storage

Property files and profile images use Supabase Storage. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, and `SUPABASE_PROFILE_BUCKET` on the backend, then run `npm run storage:setup` to create or verify two private buckets with a 5 MB per-file limit. Existing projects may use the legacy `SUPABASE_SERVICE_ROLE_KEY` variable instead. Keep either privileged key off the frontend. The browser uploads directly to Storage; the backend verifies actual size and file signature before making files visible. The same checks apply in development and production. See [the file-storage design](docs/file-storage.md) for validation, cleanup, and signed access behavior.

Inspection evidence uses the existing private property-files bucket, with the same 5 MB limit and signature verification. Owners and assigned property managers can read evidence only after the inspector submits the report. The database migration `20261006020000_inspections` must be deployed before using inspection endpoints.

Maintenance evidence also uses the private property-files bucket and 5 MB signature-checked uploads. Owners can attach issue evidence; assigned contractors attach work and completion evidence. Administrators, owners, assigned managers, and assigned contractors can read the request's ready evidence. At least one completion item is required before the contractor can complete the job. Deploy migration `20261006030000_maintenance` before using maintenance endpoints.

Maintenance work begins only after the owner approves the assigned contractor's quote. A rejected quote can be revised, or an administrator can reassign the request. Quotes store an amount in whole NGN, scope, estimated days, decision, and revision history; no payment is collected. Migration `20261006040000_quotes_audit` adds quotes and persistent audit events for staff invitations, property review and manager assignment, inspection milestones, and maintenance activity. The administrator dashboard reads live six-month totals and maintenance status counts from PostgreSQL.

Stay listings reuse approved property records and their private, signed cover photos. An owner can draft and submit one listing per property; an administrator approves publication. The property must be marked available for short let. Date blocks and active bookings are checked server-side, with a listing lock while reserving dates to prevent simultaneous overlapping requests. Guests request bookings; owners or administrators confirm or decline them. No checkout or payment status is fabricated. Manager tasks, occupancy changes, expense entries, and role-scoped reports use the same PostgreSQL records. Deploy migration `20261007000000_stay_operations_financials` before using these endpoints.
