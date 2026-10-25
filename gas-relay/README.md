# Private Google RPC relay (no Sheets)

This is a separate Apps Script web app. Its access configuration is independent of the existing dashboard. Its anonymous web-app endpoint accepts only recent HMAC-SHA256-signed requests and exposes fixed operations: a private-folder health check, enqueue an allow-listed dashboard RPC, claim one job, complete a claimed job, or wait for a result.

## Data handling

- PostgreSQL on the office PC remains authoritative; the relay is only a transport queue.
- No Google Sheets APIs, spreadsheets, or spreadsheet files are used.
- The relay creates one owner-private Drive folder. Each queued RPC request and result is a temporary JSON file in that folder; successful results are moved to Drive trash when fetched, and abandoned jobs are moved to trash after 10 minutes. Google Drive trash may retain recoverable copies until it is emptied or automatically purged; the script does not claim immediate permanent erasure.
- Do not share the queue folder. The relay's `ANYONE_ANONYMOUS` setting does not share its Drive files. The dashboard retains its independently configured access setting.
- Use a dedicated random secret of at least 32 bytes for `GAS_RELAY_SECRET`; do not reuse the database password. The same secret is set in Script Properties on this relay project and the existing dashboard project, and in the ignored local `.env.local` file. Never log it or commit it.

## Setup requirements

1. Create a separate Apps Script project for these files. Preserve the existing dashboard deployment's access setting separately; the current personal-account deployment uses its existing `ANYONE_ANONYMOUS` setting.
2. Add Script Property `GAS_RELAY_SECRET` to the relay project and run `setupPrivateRelayQueue()` once as the deploying account. Authorize the private Drive scope. Confirm the created folder remains private.
3. Only after explicit approval, deploy this separate relay web app as `USER_DEPLOYING` and `ANYONE_ANONYMOUS`. The endpoint is internet-reachable; HMAC is its sole request authentication.
4. Set `GAS_RELAY_URL` and the same `GAS_RELAY_SECRET` in local `.env.local`; set those two Script Properties in the existing dashboard project. The dashboard and relay keep separate deployments.
5. Start the local PostgreSQL-backed Next gateway and `connector/google-relay-worker.js`. The worker uses an outbound long poll while idle and only logs method names/timings/errors, never payloads or secrets.

Deployment targets and the official-clasp workflow are documented in `ops/README.md`. The signed `health` operation verifies that the queue is not shared. `ops/verify-google-postgres.cjs` verifies unsigned rejection and a real request through the local worker to PostgreSQL.

## Latency and compatibility

The signed `request` action combines enqueue and result waiting in one HTTP round trip. Legacy `enqueue`/`wait` callers remain supported. Deploy the relay before the dashboard when upgrading. Claims may wait up to 15 seconds for a wake hint instead of adding a fixed five-second idle delay. At most two dashboard reads run together; admin operations remain serialized.

Drive remains the recoverable queue. Script Cache holds wake hints, file IDs, and bounded result chunks; evicted/missing cache entries fall back to Drive. Waiting never scans the entire folder, and expiry cleanup is throttled to once per minute. The HMAC, replay protection, method allowlists and private-folder requirements are unchanged.

Dashboard summaries use a 15-second GAS read cache and a bounded 20-second page-memory cache (at most 35 seconds combined, without new browser persistence). Detail caches expire after 10 seconds. Filter/period arguments and the admin cache revision isolate server cache keys. In-flight duplicate reads are shared, and late filter responses cannot overwrite newer selections. Database queries and KPI rules are unchanged.

Read-only measurement: run `node ops/benchmark-google-latency.cjs` before upgrading, then `node ops/benchmark-google-latency.cjs --combined` afterward. Ignored `runtime/latency-*.json` files contain only timings and result checksums; the comparison excludes volatile generation/age fields and SQL tie ordering, not KPI values.
