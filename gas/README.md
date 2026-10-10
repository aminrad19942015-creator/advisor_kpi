# Google Apps Script dashboard runtime

This folder is the new GAS runtime for the Advisor KPI dashboard.

## Architecture

CRM / Windows Connector -> Supabase PostgreSQL -> Supabase Edge Function (`dashboard-rpc`) -> Google Apps Script Web App

The Connector is intentionally not required for dashboard availability. If the company PC is off, the Web App still loads the latest successful data already stored in Supabase. Only refresh stops.

## Security

GAS never receives the PostgreSQL connection string.

Script Properties:

- `SUPABASE_DASHBOARD_RPC_URL`
- `SUPABASE_ANON_KEY`

The Edge Function requires JWT verification and performs the database work server-side.

## Current status

Implemented:

- GAS Web App skeleton
- Server-side RPC adapter
- wrappers for all currently migrated dashboard RPC methods
- short server-side cache for bootstrap and filter metadata
- Supabase `dashboard-rpc` Edge Function deployed
- no Connector changes yet

Not migrated yet:

- final production UI files
- Excel export path
- Admin dashboard
- Connector endpoint cutover
- final deployment / domain access validation

## Initial Script Properties

Use:

`SUPABASE_DASHBOARD_RPC_URL=https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/dashboard-rpc`

Set `SUPABASE_ANON_KEY` to the active legacy anon JWT for the advisor-kpi Supabase project.

Do not commit private database credentials or service-role credentials.
