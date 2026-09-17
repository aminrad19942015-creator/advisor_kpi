# Advisor KPI Dashboard

Production migration of the investment-advisor performance dashboard from Google Apps Script to Next.js/Node.js on Vercel, while preserving the existing UI/UX and KPI logic.

## Production

- App: `https://advisor-kpi.vercel.app/`
- Health: `https://advisor-kpi.vercel.app/api/health`
- Data source: Turso
- Runtime: Next.js / Node.js on Vercel
- UI: preserved from the GAS dashboard

## Environment variables

Required in Vercel for Production and Preview:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Secrets must never be committed to the repository.

## Data architecture

Vercel is the execution and presentation layer only. The durable dashboard data remains in Turso. Excel source files must not be stored permanently on Vercel.

## Migration baseline

The current production version is the 1:1 migration baseline. KPI definitions, filters, drill-down behavior, SLA logic and dashboard UI should not be changed during migration QA unless a verified discrepancy is found.

Lead SLA rules preserved from the original dashboard:

- Real-person leads: 18 full days
- Legal-entity leads: 60 full days
- Near deadline: final 3 days before SLA expiry

## Admin Excel Import — planned phase

The admin module will be implemented after production migration QA. Planned flow:

1. Admin selects expected Excel inputs.
2. Server validates filename/type, workbook structure, required sheets and columns.
3. Invalid or duplicate inputs are rejected before database mutation.
4. Valid files are processed only in temporary runtime memory/storage.
5. Parsed rows are synchronized/upserted into Turso.
6. `dashboard_meta.data_version` and `dashboard_meta.last_sync_at` are updated only after a successful sync.
7. Admin receives row counts, validation results and per-file errors/success status.
8. Large uploaded Excel files are not retained on Vercel.

Tracking issue: #1 `Admin Excel Import dashboard`.

## Operational checks

Before considering a release healthy:

- GitHub Actions `Build` must pass.
- `/api/health` must return `ok: true`.
- Team, open leads, daily, weekly and monthly pages must load.
- Filters and drill-downs must return data without RPC errors.
- Core production KPIs should match the verified migration baseline.
