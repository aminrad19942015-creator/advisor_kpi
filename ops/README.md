# Local PostgreSQL cutover

The permanent runtime is:

`Google Apps Script -> HTTPS tunnel -> local Next.js gateway -> portable PostgreSQL`

The PostgreSQL port is never exposed to the internet. The gateway accepts the dashboard bridge token and Connector token, and the existing transactional Finalize logic remains the only writer for snapshots.

## One-time preparation

1. If Portable PostgreSQL is already installed and running on the company PC, do not run `initialize-portable-postgres.ps1` (that creates a separate data cluster). Use `bootstrap-local-postgres.ps1 -PostgresBin 'D:\Users\m.bashirirad\Desktop\pgsql\bin' -Port 55432 -Database advisor_kpi` to verify the existing server and create the target database only if it is absent. It prompts for the password and does not change existing databases. For a genuinely new installation only, use `initialize-portable-postgres.ps1` with an explicitly chosen data directory.
2. Copy the repository `.env.example` to `.env.local` and set `DATABASE_URL`, `ADMIN_PASSWORD`, `CRM_CONNECTOR_TOKEN`, and `DASHBOARD_RPC_TOKEN`.
3. Run `migrate-supabase-to-local-postgres.ps1` with the read-only Supabase connection URL and local connection URL. It creates a dump and a rollback backup before restoring.
4. Build/start the gateway with `start-local-gateway.ps1`. A named Cloudflare Tunnel token is required for a stable HTTPS address that GAS can call.
5. If the gateway should start automatically at Windows logon, run `install-local-gateway-task.ps1` once. Keep the named HTTPS tunnel as a separate Cloudflare service/task so its credentials are not placed in the application command line.
6. Point the GAS Script Property `SUPABASE_DASHBOARD_RPC_URL` at `<gateway-url>/api/rpc` and keep the same `DASHBOARD_RPC_TOKEN` value.
7. After the dashboard preflight succeeds, run `configure-connector-local-gateway.ps1 -GatewayUrl <gateway-url>`. Connector Scheduled Tasks are intentionally still disabled until the cutover is accepted.

The migration script is source-preserving: it reads Supabase, backs up the current local database, restores only the public schema, and verifies essential tables and sync metadata.
