# Storage operations deployment

These files prepare production storage operations. They have not been installed on a production host. The API continues to use hosted Neon PostgreSQL and private Supabase Storage buckets; this configuration creates no database container or user seeds.

Set `CLAMAV_IMAGE` to a pinned official `clamav/clamav` release tag and `EMPIRE_STORAGE_ENV_FILE` to an absolute path to a protected runtime environment file. That file needs the hosted `DATABASE_URL`, `SUPABASE_URL`, privileged Supabase key, and bucket settings. Keep it outside source control. From the backend root, run:

```sh
docker compose -f deployment/storage/compose.storage.yml up -d --build
```

The scanner publishes no host port. Attach the production API container to `empire-storage-private`, set `CLAMAV_HOST=clamav`, `CLAMAV_PORT=3310`, and `NODE_ENV=production`, and wait for scanner health before testing uploads. An API running outside this Docker network needs a deployment-specific private connection; this compose file alone will not connect an externally hosted API. Never expose unauthenticated TCP 3310 to the Internet.

ClamAV definitions persist in a named volume. Its update process needs outbound access; monitor scanner health and definition freshness. See the [official ClamAV container instructions](https://docs.clamav.net/manual/Installing/Docker.html). Docker and a real ClamAV engine were not available on the development machine, so container startup and real engine scanning still require verification on the chosen host.

The cleanup worker runs at 00:00, 06:00, 12:00, and 18:00 UTC (01:00, 07:00, 13:00, and 19:00 in Lagos). It prevents overlapping runs, bounds each run to 30 minutes, and reports JSON counts and failures. Logs should be monitored. To preview manually from the backend root:

```sh
npm run storage:cleanup -- --dry-run
```

For an isolated test scope, add `--prefix pending/test-run/`. Adjust load with `--batch-size 100 --max-batches 10`. A bounded run can leave more expired records for the next run; inspect `mayHaveMore` and failed counts. Do not apply a test prefix to the scheduled production command.

Cleanup handles pending objects older than 2 hours 5 minutes, allowing a five-minute grace after the two-hour upload lifetime. PostgreSQL transactions cannot atomically commit a Supabase object move. If a database commit has an uncertain outcome, inspect both the database and the exact object keys before reconciliation. This worker deliberately preserves final keys and READY files; it does not automatically remove final objects that might still belong to a published record.
