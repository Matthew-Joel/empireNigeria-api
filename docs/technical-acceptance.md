# Technical acceptance — 7 October 2026

Scope: storage operations and API acceptance for the non-payment workflows. Browser testing remains with the project owner. Both project folders passed a temporary file create/delete check before editing, and their existing Git changes were preserved.

## Actual check results

| Check | Result |
| --- | --- |
| Backend production build | Passed; latest build includes the authentication transaction fix. |
| Backend full Jest suite | 14 suites / 114 tests passed. This full run preceded the final authentication deadline change. |
| Updated authentication regression suite | 15 tests passed, including four new password-reset transaction cases. |
| Cleanup and scheduler regressions | 8 tests passed after the five-minute cleanup grace change. |
| Live property workflow | Passed owner access, admin review/overview, manager assignment, and edit permissions. |
| Live property-file storage | Passed private access, API and bucket size/type limits, spoofed-byte rejection, expiry, signed reads, duplicate completion, concurrent cover replacement, and controlled scanner failures/retries. |
| Live profile-image storage | Focused rerun passed upload, replacement, removal, original-byte reads, and never-cached signed URL expiry. The initial combined storage run stopped with HTTP 503 at profile completion; that run did not pass as a whole. |
| Live authentication on Neon | Passed registration/verification, restricted internal roles, invitations, expired/replaced/reused/revoked links, suspended-account access, profile updates, recovery, refresh rotation, and logout using captured emails. Seven temporary accounts were removed. |
| Live Resend acceptance | Failed: HTTP 403, `empirenigeria.com` is not verified. Captured-email checks do not verify provider acceptance or inbox delivery. |
| Live inspections | Passed scheduling, inactive-inspector rejection, role scope, visit/report transitions, private scanned evidence, 5 MB limit, signed reads, and fixture cleanup. |
| Live maintenance | Passed inactive-contractor rejection, quote rejection/revision/approval, assigned contractor progress, issue/work/completion evidence, owner/manager visibility, closeout, audit, analytics, and fixture cleanup. |
| Live Stay and operations | Passed publication/search, booking prices and permissions, simultaneous overlap prevention, cancellation, blocked dates, checkout completion, manager tasks, occupancy, expenses, reports, audit, and fixture cleanup. No payment was collected or reported as received. |
| Live expired-upload cleanup | Passed isolated dry-run, six expired files across all four upload types, bounded batches, READY/recent/unrelated-file preservation, avatar preservation, and repeat cleanup. Verified every created fixture account, record, and object was removed. |
| Frontend checks from the preceding completed run | 49 tests, lint, and TypeScript/Vite build passed. No frontend code changed in this backend/storage batch, so these checks were not repeated. The Vite bundle-size warning remains. |
| Hosted database migrations | Earlier deployment verification confirmed all 11 applied, including `20261007000000_stay_operations_financials`; its six operational tables were verified. This batch adds no migration. |

The final inspection/maintenance/Stay/cleanup runner exited successfully. Its controlled ClamD fixture received four upload streams. The fixture verifies protocol integration, failure handling, and publication gates; it is not a real antivirus engine. Separate storage failure tests exercised missing configuration, production-required scanning, infected replies, scanner errors/disconnects, and clean retry without publishing failed uploads.

## Changes and folders

```text
empire_api/
  src/modules/storage/          Shared Supabase access and bounded ClamD scanner
  src/modules/properties/       Property upload completion and cover serialization
  src/modules/auth/             Profile completion and bounded account transactions
  src/modules/inspections/      Locked evidence completion and atomic audit publication
  src/modules/maintenance/      Locked evidence completion and atomic audit publication
  scripts/acceptance-check.cjs  Sequential live workflow runner
  scripts/*-smoke.cjs           Isolated live checks and fixture cleanup
  scripts/lib/                  Scoped expired-upload cleanup with row locks/batching
  scripts/test-support/         Controlled ClamD protocol fixture
  scripts/tests/                Cleanup/scheduler regressions
  deployment/storage/          Private scanner and scheduled cleanup preparation
  .dockerignore                 Excludes credentials, dependencies, and Git from build context
  docs/                         Storage design, deployment links, and this report
```

All four completion paths now lock the upload row used by cleanup, recheck state/expiry/permission, and publish after byte validation and scanning. Parent locks serialize cover and avatar changes. Inspection and maintenance evidence audits commit with READY state. The scanner has an absolute 15-second deadline and requires a strict clean response. Downloads cap actual bytes at 5,000,000 and return sanitized availability errors.

The password-reset test exposed Prisma's default five-second transaction deadline on the hosted connection. Verification and password reset now use bounded 30-second transactions with atomic token consumption and session invalidation preserved. Password hashing remains outside the transaction.

## Pending external checks

- Verify the Resend sender domain and rerun the authorized live-email check.
- Choose/provide the production host, deploy a real ClamAV engine with updated definitions, connect the API over its private network, and verify real scanning. [Deployment files](../deployment/storage/README.md) are prepared, not activated or container-tested.
- Install and monitor the six-hour production cleanup worker. Its logic and live scoped deletion passed; no production schedule was installed on the development desktop.
- Complete the browser testing reserved for the project owner.
- Payment remains a separate later phase.

Pending cleanup starts after 2 hours 5 minutes and never sweeps READY/finalized keys. PostgreSQL and Supabase cannot commit together; uncertain move/commit outcomes require reconciliation against the exact records and object keys. Signed-token expiry also does not revoke bytes already fetched or retained by a CDN cache; see [the storage design](file-storage.md).
