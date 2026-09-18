# Advisor KPI Dashboard

Production migration of the investment-advisor performance dashboard from Google Apps Script to Next.js/Node.js on Vercel, preserving the original UI/UX and KPI logic.

## Production

- App: `https://advisor-kpi.vercel.app/`
- Admin: `https://advisor-kpi.vercel.app/admin`
- Health: `https://advisor-kpi.vercel.app/api/health`
- Data source: Turso
- Runtime: Next.js / Node.js on Vercel
- UI: preserved from the GAS dashboard

## Environment variables

Required in Vercel for Production and Preview:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `ADMIN_PASSWORD`

Secrets must never be committed to the repository.

## Data architecture

Vercel is the execution and presentation layer only. Durable dashboard data remains in Turso. Excel source files are not retained permanently on Vercel.

## Migration baseline

The 1:1 migration from Google Apps Script is complete. The production baseline preserves the original KPI definitions, filters, drill-down behavior, SLA logic and dashboard UI.

Lead SLA rules:

- Real-person leads: 18 full days
- Legal-entity leads: 60 full days
- Near deadline: final 3 days before SLA expiry

## Admin Excel Import

The admin import pipeline is operational.

Flow:

1. Admin selects one or more supported Excel inputs.
2. Files are uploaded in chunks and held temporarily in Turso staging.
3. Filename, workbook structure, required sheet/columns and database mappings are validated.
4. Preflight compares current database row counts with the incoming dataset and surfaces warnings.
5. Each selected file replaces the complete previous version of its matching Dataset; data is never appended.
6. Replacement uses a staging table before the production table is mutated.
7. Destination row count is verified after replacement.
8. `dashboard_meta.data_version` and `dashboard_meta.last_sync_at` are updated after a successful replacement.
9. Verified imports are recorded in the admin import history.
10. Old staging chunks are automatically eligible for cleanup and source Excel files are not stored on Vercel.

Supported datasets:

- `team_members`
- `open_leads`
- `daily_leads`, `weekly_leads`, `monthly_leads`
- `daily_opportunities`, `weekly_opportunities`, `monthly_opportunities`
- `daily_calls`, `weekly_calls`, `monthly_calls`
- `daily_tickets`, `weekly_tickets`, `monthly_tickets`

## Production QA

The Admin dashboard includes a final QA control that checks:

- Metadata and latest sync state
- Team row count
- Open-leads row count
- Daily / weekly / monthly activity summaries
- Row availability for all 14 production datasets

The verified migration baseline passed all QA checks after the first full production import.

## Operational procedure for future updates

1. Open `/admin` and sign in.
2. Select only the Excel files that changed, or all files when a full refresh is required.
3. Run **Preflight**.
4. Review row-count changes and warnings.
5. Replace individual Datasets or all validated Datasets.
6. Confirm **Replace + Verify** success.
7. Run **Final QA**.
8. Open the main dashboard for a quick visual check.

## Release checks

Before considering a release healthy:

- GitHub Actions `Build` must pass.
- `/api/health` must return `ok: true`.
- Admin Final QA must pass.
- Team, open leads, daily, weekly and monthly pages must load.
- Filters and drill-downs must return data without RPC errors.
- Core production KPIs should match the verified source files.

## Security

- Turso credentials and the Admin password are supplied only through Vercel Environment Variables.
- Admin sessions use an HttpOnly, Secure, SameSite=Strict cookie.
- Admin import, history and QA APIs require the Admin session.
- Security response headers are configured globally in Next.js.
