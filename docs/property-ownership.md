# Property ownership and submission

New properties require at least one completed ownership document before entering administrator review. Supported categories are Certificate of Occupancy, Deed of Assignment, Deed of Conveyance, Registered Survey Plan, Grant of Probate, and Letter of Administration. Several files may represent the pages of the same document. Other supporting documents remain optional.

PDF is preferred for complete multipage scans. PDF, JPEG, and PNG are accepted, with a maximum of 5,000,000 bytes per file. Existing type, signature, size, authorization, and private Storage checks remain in effect. Uploading evidence does not authenticate the document or automatically verify legal title; administrator review remains required.

## API sequence

All paths are relative to `/api/v1`.

| Operation | Behavior |
| --- | --- |
| `POST /properties` | Creates an owner-scoped `DRAFT` with server-controlled `ownershipProofRequired: true`. |
| `PATCH /properties/:id` | Saves changed property fields. Proof-required properties return to `DRAFT`; identical retries preserve review progress. Existing approved-property edit restrictions remain. |
| `POST /properties/:id/files` | Begins an upload; `purpose: DOCUMENT` may include `ownershipDocumentType`. Photo uploads cannot carry an ownership category. |
| Signed Storage PUT | Transfers bytes directly to the existing private property bucket. Application bearer tokens are not sent to Storage. |
| `POST /properties/:id/files/:fileId/complete` | Checks bytes and publishes `READY` metadata. Repeated completion is idempotent. |
| `POST /properties/:id/submit` | Requires completed categorized proof for proof-required properties, then moves a draft or changes-requested property to `SUBMITTED`. Repeated requests do not rewind review or duplicate submission audit events. |
| `PATCH /properties/:id/review` | Administrator review cannot bypass draft submission or required proof. Changes may still be requested. |

`ownershipDocumentType` values:

- `CERTIFICATE_OF_OCCUPANCY`
- `DEED_OF_ASSIGNMENT`
- `DEED_OF_CONVEYANCE`
- `REGISTERED_SURVEY_PLAN`
- `GRANT_OF_PROBATE`
- `LETTER_OF_ADMINISTRATION`

Drafts remain available to their owner for resumption. They are excluded from admin review lists, report totals, occupancy/financial scopes, and operational creation. Assigned managers cannot read drafts. For submitted property files, the existing owner, administrator, and assigned-manager access scope is preserved; file access uses short-lived signed URLs.

## Failures and replacement

The form preserves a saved property ID and completed uploads when a later file or submission fails. It reports success only after final submission. The saved draft URL can resume property details after reloading; untransferred local files must be selected again.

Only `READY` categorized documents count as proof. Pending, failed, removed, or generic documents do not. The last proof on a submitted property cannot be removed before a completed replacement exists. Removing metadata is committed before deleting Storage bytes, using `DELETING` records to retain cleanup retries after Storage failure. Global expired-upload cleanup retries these deletion records; scoped cleanup skips them. Expired pending property uploads also clean a possible final path left by an interrupted completion.

Submission, review, completion, and removal use the same property-row lock. Ownership upload, submission, review, and removal actions are recorded in the existing audit trail. Completion can recover an already-moved object after a database transaction rolls back, validating its size and signature again.

Metadata transactions use a bounded 20-second execution timeout with a 5-second acquisition wait, allowing for hosted database latency within normal request deadlines. Storage completion retains a separate 90-second transaction limit. The hosted smoke harness also applies bounded connection, pool, and socket timeouts.

## Existing properties and rollout

Migration `20261021090000_required_ownership_proof` adds draft status, ownership categories, the requirement flag, and the internal file-removal state. It preserves existing property statuses and initializes their requirement flag to `false`. Existing generic attachments remain uncategorized; no historical record is automatically declared verified. All new API-created properties explicitly enable the requirement.

Deploy the migration before the updated API and frontend. Use `npx prisma migrate deploy` against the configured hosted database; do not reset or seed the database. The updated frontend and API implement the same draft/upload/submit contract.

On Render, the build command is `npm ci --include=dev && npm run prisma:generate && npm run build`, and the start command is `npm run start:prod`. Keep production runtime configuration and existing Resend/Supabase credentials server-side. There are no new bucket requirements.

## Verification

Backend regressions cover required proof, incomplete and generic files, category validation, private scopes, legacy records, review/submission retries, replacement, removal failures, and interrupted completion. Frontend regressions cover type/size validation, metadata mapping, proof-first uploads, preserved progress, and submission retries. Operational smoke fixtures now follow the genuine ownership upload/complete/submit sequence and track their Storage paths for cleanup. Browser testing remains manual.
