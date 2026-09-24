# Advisor KPI Dashboard

Production performance dashboard for the investment-advisor unit, migrated from Google Apps Script / Excel-first operation to Next.js on Vercel with Supabase/PostgreSQL as the operational database.

## Production architecture

- Frontend / API: Next.js 16 on Vercel
- Operational database: Supabase PostgreSQL
- CRM ingestion: Windows Connector -> CRM API -> local snapshot backup -> Supabase
- Manual fallback: Admin Excel import
- Local recovery: rolling compressed snapshots on the Connector workstation

The dashboard no longer depends on Turso.

## Production URLs

- App: `https://advisor-kpi.vercel.app/`
- Admin: `https://advisor-kpi.vercel.app/admin`
- Health: `https://advisor-kpi.vercel.app/api/health`

## Required Vercel environment variables

- `SUPABASE_DATABASE_URL`
- `ADMIN_PASSWORD`
- `CRM_CONNECTOR_TOKEN`

Secrets must never be committed to the repository.

## Automated refresh policy

Windows Task Scheduler runs the local Connector only Saturday through Thursday.

Open Leads:
- 07:00
- 09:00
- 12:00
- 15:00

Historical activity (Daily / Weekly / Monthly):
- 07:00 only

Friday:
- no automatic CRM refresh

The runner scripts also contain a Friday safety guard.

## CRM datasets

Operational CRM datasets:
- Open Leads
- Lead: Daily / Weekly / Monthly
- Opportunity: Daily / Weekly / Monthly
- Calls: Daily / Weekly / Monthly
- Ticket: Daily / Weekly / Monthly

Business rules are stored in Supabase and editable from Admin where appropriate. Technical CRM wiring (origin, API version, entity names, technical date fields and lookup source fields) is read-only from the Admin UI and protected server-side.

## Admin

The Admin dashboard supports:
- CRM / Excel source selection per dataset
- business-rule management
- CRM row-count / sync status
- Excel Preflight + full Replace + Verify
- local-backup recovery request
- production QA
- Excel import history
- update-policy help modal

Editable business rules include values such as:
- allowed business units
- Lead statuses
- Ticket queues
- Ticket topics
- excluded Ticket status reasons
- customer ranks

A new value inside an existing rule list can be added directly in Admin. A completely new rule dimension, CRM field, relationship or logical condition requires a code/schema change.

## Excel fallback rules

Excel is a controlled fallback path.

1. Set the target dataset source to `Excel` in Admin.
2. Upload the supported workbook.
3. Run Preflight.
4. Review row-count changes and warnings.
5. Replace the target dataset.
6. Verify row count.
7. Run Final QA.

Replace is complete replacement, not append. If the source is switched back to CRM, the next eligible CRM sync becomes authoritative again.

## Local backup and recovery

Before CRM data is pushed to Supabase, the Connector saves a compressed local snapshot.

Default local backup:
- `connector/data-backup/<dataset>/latest.json.gz`
- rolling archive retained for 7 days by default

The Admin recovery button queues a restore request. The Connector processes the request on its next run and restores the latest local snapshots into Supabase.

## Production QA

Final QA checks:
- Metadata
- team members
- Open Leads
- Daily / Weekly / Monthly summaries
- production row availability for all operational datasets

Release health requires:
- latest Vercel deployment green
- `/api/health` healthy
- Admin Final QA successful
- Team / Open Leads / Daily / Weekly / Monthly pages load
- filters and drilldowns return data without RPC errors

## Migration status

The production cutover is complete:
- Google Apps Script is no longer required by the dashboard runtime.
- Turso is no longer required by the dashboard runtime.
- Supabase is the only operational database.
- CRM ingestion is automated through the Windows Connector.
- Excel remains available as a manual fallback.
- local snapshots provide a recovery path.
