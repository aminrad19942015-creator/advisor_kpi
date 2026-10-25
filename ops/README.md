# Local PostgreSQL cutover

The planned runtime is:

`Coworker browser -> domain-only dashboard GAS -> private Google RPC queue -> local worker -> local Next.js gateway -> portable PostgreSQL`

The PostgreSQL port is never exposed to the internet. The local worker polls the separately deployed HMAC-authenticated Google relay over outbound HTTPS and calls the gateway through `127.0.0.1`. The existing transactional Finalize logic remains the only writer for snapshots. The queue temporarily stores RPC request/results as private Drive JSON files (not Sheets); retrieved or expired jobs are moved to Drive trash, where recoverable copies may remain until trash is emptied or purged.

## One-time preparation

1. If Portable PostgreSQL is already installed and running on the company PC, do not run `initialize-portable-postgres.ps1` (that creates a separate data cluster). Use `bootstrap-local-postgres.ps1 -PostgresBin 'D:\Users\m.bashirirad\Desktop\pgsql\bin' -Port 55432 -Database advisor_kpi` to verify the existing server and create the target database only if it is absent. It prompts for the password and does not change existing databases. For a genuinely new installation only, use `initialize-portable-postgres.ps1` with an explicitly chosen data directory.
2. Copy the repository `.env.example` to `.env.local` and set `DATABASE_URL`, `ADMIN_PASSWORD`, `CRM_CONNECTOR_TOKEN`, and `DASHBOARD_RPC_TOKEN`.
3. Run `migrate-supabase-to-local-postgres.ps1` with the read-only Supabase connection URL and local connection URL. It creates a dump and a rollback backup before restoring.
4. Configure and validate the separate Google RPC relay before deploying it. It is an anonymous internet-reachable endpoint protected only by a high-entropy HMAC secret; do not publish until that exposure is explicitly approved. Keep the dashboard web app domain-only.
5. Set `GAS_RELAY_URL` and `GAS_RELAY_SECRET` in local `.env.local`, and matching Script Properties in the relay and existing dashboard projects. The worker and gateway are started by `start-local-gateway.ps1`; the logon task is installed with `install-local-gateway-task.ps1` (current-user, limited privileges).
6. Verify GAS preflight and one read-only dashboard request end to end. Do not enable CRM Connector Scheduled Tasks until this check succeeds and the data cutover is accepted.

The migration script is source-preserving: it reads Supabase, backs up the current local database, restores only the public schema, and verifies essential tables and sync metadata.
