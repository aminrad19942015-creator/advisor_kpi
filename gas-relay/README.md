# Private Google RPC relay (no Sheets)

This is a separate Apps Script web app. It is not the dashboard web app and must never replace its domain-only access setting. Its anonymous web-app endpoint accepts only recent HMAC-SHA256-signed requests and exposes four fixed operations: enqueue an allow-listed dashboard RPC, claim one job, complete a claimed job, or wait for a result.

## Data handling

- PostgreSQL on the office PC remains authoritative; the relay is only a transport queue.
- No Google Sheets APIs, spreadsheets, or spreadsheet files are used.
- The relay creates one owner-private Drive folder. Each queued RPC request and result is a temporary JSON file in that folder; successful results are moved to Drive trash when fetched, and abandoned jobs are moved to trash after 10 minutes. Google Drive trash may retain recoverable copies until it is emptied or automatically purged; the script does not claim immediate permanent erasure.
- Do not share the queue folder. The `ANYONE_ANONYMOUS` setting applies only to the HMAC-protected relay web app, never to the Drive folder or dashboard.
- Use a dedicated random secret of at least 32 bytes for `GAS_RELAY_SECRET`; do not reuse the database password. The same secret is set in Script Properties on this relay project and the existing dashboard project, and in the ignored local `.env.local` file. Never log it or commit it.

## Setup requirements

1. Create a separate Apps Script project for these files. Keep the existing dashboard deployment `DOMAIN`-only.
2. Add Script Property `GAS_RELAY_SECRET` to the relay project and run `setupPrivateRelayQueue()` once as the deploying account. Authorize the private Drive scope. Confirm the created folder remains private.
3. Only after explicit approval, deploy this separate relay web app as `USER_DEPLOYING` and `ANYONE_ANONYMOUS`. The endpoint is internet-reachable; HMAC is its sole request authentication.
4. Set `GAS_RELAY_URL` and the same `GAS_RELAY_SECRET` in local `.env.local`; set those two Script Properties in the existing dashboard project. The dashboard project remains `DOMAIN`-only.
5. Start the local PostgreSQL-backed Next gateway and `connector/google-relay-worker.js`. The worker polls at a low rate while idle and only logs method names/errors, never payloads or secrets.

No deployment has been made by this source change. Verify the end-to-end flow and review the anonymous endpoint exposure before publishing.
