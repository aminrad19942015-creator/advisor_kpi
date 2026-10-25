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
5. Start the local PostgreSQL-backed Next gateway and `connector/google-relay-worker.js`. The worker polls at a low rate while idle and only logs method names/errors, never payloads or secrets.

Deployment targets and the official-clasp workflow are documented in `ops/README.md`. The signed `health` operation verifies that the queue is not shared. `ops/verify-google-postgres.cjs` verifies unsigned rejection and a real request through the local worker to PostgreSQL.
