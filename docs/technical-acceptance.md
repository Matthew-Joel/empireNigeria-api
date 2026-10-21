# Technical acceptance

## Current ownership verification - 21 October 2026

New owner-created properties now remain drafts until at least one categorized ownership document completes upload and the owner explicitly submits the property. PDF, JPEG, and PNG are supported up to 5,000,000 bytes per file. Existing property statuses and uncategorized attachments are preserved. See [ownership submission](property-ownership.md) for the API contract, folder responsibilities, privacy, retries, and rollout.

| Check | Actual result |
| --- | --- |
| Workspace access | Temporary create/read/delete probes passed in both roots; both Git statuses were clean before edits. |
| Prisma client | Generated successfully for the ownership schema. |
| Hosted migration | `20261021090000_required_ownership_proof` deployed successfully; a separate status check confirmed all 12 migrations applied and the schema up to date. No reset or user seed was run. |
| Frontend production build | Passed, exit 0, including the final loaded-draft resume fix; 2,666 modules. Main JS 757.73 kB / 209.72 kB gzip. The existing >500 kB warning remains nonfatal. |
| Frontend lint | Passed, exit 0. |
| Frontend regressions | Full suite: 9 files / 79 tests passed. After the last resume changes, the focused submission suite passed all 8 tests. |
| Backend full regressions | 20 suites / 150 tests passed, exit 0. A live hosted check subsequently identified the default 5-second metadata transaction timeout; the final affected-suite verification also passed below. |
| Cleanup, scheduler, upload-helper tests | All 18 passed: 15 cleanup tests plus 1 scheduler and 2 ownership fixture tests. |
| Final backend timeout verification | Final build passed, exit 0, and both affected property suites passed all 33 tests after the fix. Metadata transactions now have a bounded 20-second timeout and 5-second wait; Storage completion retains its separate 90-second timeout. |
| Hosted ownership flow | Final rerun passed, exit 0, using the locally built API with hosted Neon and Supabase: required private PDF upload, category persistence, draft submission, review-safe retries, last-proof protection, owner/manager scope, admin overview/review, assignment, and approved-property edit permissions. Signed reads succeeded and anonymous public reads were rejected. The first failed connection attempt and the review-timeout failure are not counted as passes; bounded connection and transaction timeouts resolved the final run. |
| Hosted fixture cleanup | Passed in the final run: tracked pending/final Storage removals succeeded; database counts confirmed its temporary property and all three test accounts were absent. Cleanup also completed after the earlier review-timeout failure. No permanent role seeds were created. |
| Browser and deployed-site acceptance | Not run. Browser review remains with the project owner. The migration is deployed; publishing the updated API/frontend remains a separate deployment step. |

No live email was sent. Operational fixture accounts are temporary and are removed by their test harness; they are not role seeds. Payment and scanner behavior were not changed.

## Historical dashboard verification - 10 October 2026

The interrupted work was resumed after confirming both project folders support temporary file creation/read/deletion and inspecting their Git statuses. Existing edits were preserved. Scanner code, tests, configuration, service calls, deployment container, and protocol fixture deletions persisted. The only remaining mention is the dated historical note below; scanning is not a runtime requirement in either development or production.

The follow-up centralizes frontend Fetch requests and signed uploads, preserves auth refresh/session behavior, completes remaining dashboard/report source requirements, adds scoped monthly reporting with inclusive Nigerian dates, and resolves quote authors independently of current assignment. Current portfolio snapshots remain separate from date-filtered activity. Reservation amounts are not received revenue. See [reporting semantics](reporting.md) and `property/docs/API_CLIENT.md`.

| Current check | Actual result |
| --- | --- |
| Frontend TypeScript and Vite build | Passed, exit 0; 2,663 modules. Main JS 741.75 kB / 205.49 kB gzip; nonfatal >500 kB and plugin timing warnings remain. |
| Frontend lint | Passed, exit 0. |
| Frontend full Vitest suite | 16 files / 83 tests passed, exit 0, after correcting a new test-hook issue. |
| Backend full Jest suite | 16 suites / 113 tests passed, exit 0; includes scanner-free uploads, report dates/scope, quote authors, and admin month comparisons. |
| Backend final production build | Passed, exit 0, after the reporting, analytics-timezone, quote-author, and scanner-removal changes. |
| Cleanup and scheduler regressions | 8 tests passed, exit 0. |
| Read-only Neon fixture inventory | Passed: no previous storage/inspection/maintenance smoke fixture accounts or associated properties found. |
| Hosted reporting SQL | Passed, exit 0: real monthly SQL, zero-filled months/activity sums, empty unrelated Owner/Manager scopes, six admin creation-cohort comparisons, and consistent Africa/Lagos analytics months. Read-only; no fixtures or emails. |
| Scanner-free live property/profile uploads | Passed in production mode, exit 0: real photo/PDF/avatar bytes, private signed reads and origin expiry, idempotent completion, replacement races, size/type/signature/expiry checks, and owner scope. Independent bucket/privacy/5,000,000-byte/MIME checks passed; all 20 tracked object paths were absent after cleanup. |
| Scanner-free live inspections | Passed in production mode, exit 0: active/suspended-inspector assignment, Owner/Manager/Inspector scope, visit/report transitions, evidence completion, 5 MB rejection, report visibility, and signed reads. Independent cleanup confirmed both tracked evidence paths absent. |
| Scanner-free live maintenance | Passed in production mode, exit 0: active-contractor assignment/scope, quote rejection/revision/approval, progress/completion requirements, 5 MB evidence limit, private signed evidence, manager tracking, audit/analytics, and admin closeout. Independent cleanup confirmed all six tracked evidence paths absent. |
| Final live-fixture cleanup | Passed, exit 0: zero storage/inspection/maintenance fixture accounts or associated properties remain in Neon; all 28 tracked storage object paths across the three runs were confirmed absent. |
| Source whitespace checks | Windows-aware `git diff --check` passed for both projects; assigned frontend files and 16 root-edited source/script/document files checked for NUL bytes. |
| Browser/Playwright | Not run; review remains with the project owner. |
| Schema migrations | No schema or migration changes in this follow-up. The earlier 11-migration deployment confirmation is historical, not a new deployment run. |

Initial sandbox Node checks hit EPERM while resolving `C:\Users\MATTHEW`. Successful automated checks used the approved escalated runner. Earlier stalled/aborted backend commands are not counted as passes. No live email test was requested or performed in this follow-up.

## Historical acceptance — 7 October 2026

Scope: storage operations and API acceptance for the non-payment workflows. Browser testing remains with the project owner. Both project folders passed a temporary file create/delete check before editing, and their existing Git changes were preserved.

The results in this historical section describe the 7 October run. On 8 October, the project owner requested removal of antivirus integration from upload completion. Its implementation, configuration, deployment service, and protocol fixtures were removed; current verification is recorded separately above. The historical live results do not establish a new live run after that removal.

## Actual check results

| Check | Result |
| --- | --- |
| Backend production build | Passed; latest build includes the authentication transaction fix. |
| Backend full Jest suite | 14 suites / 114 tests passed. This full run preceded the final authentication deadline change. |
| Updated authentication regression suite | 15 tests passed, including four new password-reset transaction cases. |
| Cleanup and scheduler regressions | 8 tests passed after the five-minute cleanup grace change. |
| Live property workflow | Passed owner access, admin review/overview, manager assignment, and edit permissions. |
| Live property-file storage | Passed private access, API and bucket size/type limits, spoofed-byte rejection, expiry, signed reads, duplicate completion, and concurrent cover replacement. |
| Live profile-image storage | Focused rerun passed upload, replacement, removal, original-byte reads, and never-cached signed URL expiry. The initial combined storage run stopped with HTTP 503 at profile completion; that run did not pass as a whole. |
| Live authentication on Neon | Passed registration/verification, restricted internal roles, invitations, expired/replaced/reused/revoked links, suspended-account access, profile updates, recovery, refresh rotation, and logout using captured emails. Seven temporary accounts were removed. |
| Live Resend acceptance | Failed: HTTP 403, `empirenigeria.com` is not verified. Captured-email checks do not verify provider acceptance or inbox delivery. |
| Live inspections | Passed scheduling, inactive-inspector rejection, role scope, visit/report transitions, private evidence, 5 MB limit, signed reads, and fixture cleanup. |
| Live maintenance | Passed inactive-contractor rejection, quote rejection/revision/approval, assigned contractor progress, issue/work/completion evidence, owner/manager visibility, closeout, audit, analytics, and fixture cleanup. |
| Live Stay and operations | Passed publication/search, booking prices and permissions, simultaneous overlap prevention, cancellation, blocked dates, checkout completion, manager tasks, occupancy, expenses, reports, audit, and fixture cleanup. No payment was collected or reported as received. |
| Live expired-upload cleanup | Passed isolated dry-run, six expired files across all four upload types, bounded batches, READY/recent/unrelated-file preservation, avatar preservation, and repeat cleanup. Verified every created fixture account, record, and object was removed. |
| Frontend checks from the preceding completed run | 49 tests, lint, and TypeScript/Vite build passed. No frontend code changed in this backend/storage batch, so these checks were not repeated. The Vite bundle-size warning remains. |
| Hosted database migrations | Earlier deployment verification confirmed all 11 applied, including `20261007000000_stay_operations_financials`; its six operational tables were verified. This batch adds no migration. |

The final inspection/maintenance/Stay/cleanup runner exited successfully on 7 October. That run also used a controlled ClamD protocol fixture rather than an antivirus engine. Those integration tests are retired following the 8 October removal; they are not current deployment requirements.

## Changes and folders

```text
empire_api/
  src/modules/storage/          Shared Supabase access and bounded byte validation
  src/modules/properties/       Property upload completion and cover serialization
  src/modules/auth/             Profile completion and bounded account transactions
  src/modules/inspections/      Locked evidence completion and atomic audit publication
  src/modules/maintenance/      Locked evidence completion and atomic audit publication
  scripts/acceptance-check.cjs  Sequential live workflow runner
  scripts/*-smoke.cjs           Isolated live checks and fixture cleanup
  scripts/lib/                  Scoped expired-upload cleanup with row locks/batching
  scripts/tests/                Cleanup/scheduler regressions
  deployment/storage/          Scheduled cleanup preparation
  .dockerignore                 Excludes credentials, dependencies, and Git from build context
  docs/                         Storage design, deployment links, and this report
```

All four completion paths lock the upload row used by cleanup, recheck state/expiry/permission, and publish after byte validation. Parent locks serialize cover and avatar changes. Inspection and maintenance evidence audits commit with READY state. Downloads cap actual bytes at 5,000,000 and return sanitized availability errors.

The password-reset test exposed Prisma's default five-second transaction deadline on the hosted connection. Verification and password reset now use bounded 30-second transactions with atomic token consumption and session invalidation preserved. Password hashing remains outside the transaction.

## Pending external checks

- Verify the Resend sender domain and rerun the authorized live-email check.
- Choose/provide the production host and verify the prepared [cleanup deployment files](../deployment/storage/README.md), which have not been activated or container-tested.
- Install and monitor the six-hour production cleanup worker. Its logic and live scoped deletion passed; no production schedule was installed on the development desktop.
- Complete the browser testing reserved for the project owner.
- Payment remains a separate later phase.

Pending cleanup starts after 2 hours 5 minutes and never sweeps READY/finalized keys. PostgreSQL and Supabase cannot commit together; uncertain move/commit outcomes require reconciliation against the exact records and object keys. Signed-token expiry also does not revoke bytes already fetched or retained by a CDN cache; see [the storage design](file-storage.md).
