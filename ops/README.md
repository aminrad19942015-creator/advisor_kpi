# Local PostgreSQL cutover

The planned runtime is:

`Coworker browser -> existing dashboard GAS -> private Google RPC queue -> local worker -> loopback Next.js gateway -> portable PostgreSQL`

The PostgreSQL port is never exposed to the internet. The local worker polls the separately deployed HMAC-authenticated Google relay over outbound HTTPS and calls the gateway through `127.0.0.1`. The existing transactional Finalize logic remains the only writer for snapshots. The queue temporarily stores RPC request/results as private Drive JSON files (not Sheets); retrieved or expired jobs are moved to Drive trash, where recoverable copies may remain until trash is emptied or purged.

## One-time preparation

1. If Portable PostgreSQL is already installed and running on the company PC, do not run `initialize-portable-postgres.ps1` (that creates a separate data cluster). Use `bootstrap-local-postgres.ps1 -PostgresBin 'D:\Users\m.bashirirad\Desktop\pgsql\bin' -Port 55432 -Database advisor_kpi` to verify the existing server and create the target database only if it is absent. It prompts for the password and does not change existing databases. For a genuinely new installation only, use `initialize-portable-postgres.ps1` with an explicitly chosen data directory.
2. Copy the repository `.env.example` to `.env.local` and set `DATABASE_URL`, `ADMIN_PASSWORD`, `CRM_CONNECTOR_TOKEN`, and `DASHBOARD_RPC_TOKEN`.
3. Run `migrate-supabase-to-local-postgres.ps1` with the read-only Supabase connection URL and local connection URL. It creates a dump and a rollback backup before restoring.
4. Configure and validate the separate Google RPC relay before deploying it. It is an anonymous internet-reachable endpoint protected by a high-entropy HMAC secret. The dashboard's existing access setting is preserved separately; this account's existing dashboard is `ANYONE_ANONYMOUS`, not a Workspace-domain deployment.
5. Set `GAS_RELAY_URL` and `GAS_RELAY_SECRET` in local `.env.local`, and matching Script Properties in the relay and existing dashboard projects. The worker and gateway are started by `start-local-gateway.ps1`; the logon task is installed with `install-local-gateway-task.ps1` (current-user, limited privileges).
6. Verify GAS preflight and one read-only dashboard request end to end. Do not enable CRM Connector Scheduled Tasks until this check succeeds and the data cutover is accepted.

The migration script is source-preserving: it reads Supabase, backs up the current local database, restores only the public schema, and verifies essential tables and sync metadata.

## Current-user deployment and operation

The official Google `clasp` tool is installed under `%LOCALAPPDATA%\AdvisorKpiTools\clasp`; its OAuth credentials remain in the user's `.clasprc.json`, outside Git. `ops/apps-script-targets.json` records only project/deployment IDs and the existing access setting. No password or token belongs in it.

`node ops/stage-google-project.cjs dashboard` copies the reviewed source into ignored `runtime/gas-dashboard-deploy`. Use `ops/apps-script.ps1 -Project dashboard push --force`, then `deploy --deploymentId` with the existing dashboard deployment ID to retain the coworkers' URL. Use `-Project relay` for the separate transport project. Always check exit codes and verify the existing deployment ID before updating it.

The one-time `--bootstrap` stage generates an owner-run `ownerSetupOnce` function from the ignored local environment. After its successful execution, stage again without `--bootstrap` and push before creating a version. This removes the temporary setup source; subsequent code releases do not require re-entering credentials in the browser.

`node ops/configure-google-runtime.cjs <Google-queue-exec-URL>` records the queue URL and discovers the existing portable PostgreSQL data directory without changing its data. `ops/start-local-gateway.ps1` runs a supervised local gateway and outbound worker. Its default port is 3010, bound to `127.0.0.1`; a loopback guard prevents duplicate supervisors. PostgreSQL is started with the existing data directory only if it is stopped.

`ops/install-local-gateway-task.ps1` registers a limited current-user logon task. If organizational Task Scheduler policy refuses registration, it creates a current-user Startup shortcut instead. Both paths need no administrator access. The workstation must remain powered on with the user logged in for live dashboard requests and CRM refreshes.

`node ops/verify-google-postgres.cjs` verifies private Drive permissions, unsigned-request rejection, local diagnostics, and a real signed Google queue request handled by the local worker. It prints only aggregate counts and sync metadata.

Connector endpoints must use `http://127.0.0.1:3010` on this workstation. `configure-connector-local-gateway.ps1` permits unencrypted HTTP only on loopback; external endpoints still require HTTPS. Open Leads runs Saturday–Thursday at 07:00, 09:00, 12:00 and 15:00; Activity runs at 07:30. The previous-month guard runs daily at 15:30 and contacts CRM only when its Persian-calendar rule permits it.
