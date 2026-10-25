# Advisor KPI Dashboard

Performance dashboard for the investment-advisor unit. The live UI remains Google Apps Script, while the operational database and API gateway are designed to run permanently on the office PC.

## Target architecture

- Frontend: Google Apps Script Web App
- HTTPS bridge: stable HTTPS tunnel to the office PC
- API gateway: Next.js 16 running locally
- Operational database: portable PostgreSQL on the office PC
- CRM ingestion: Windows Connector -> CRM API -> local gateway -> local PostgreSQL
- Manual fallback: Admin Excel import
- Local recovery: rolling compressed snapshots on the Connector workstation

Supabase is retained only as the source for the one-time, verified migration. The runtime does not require Supabase after cutover.

## Local gateway environment variables

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `CRM_CONNECTOR_TOKEN`
- `DASHBOARD_RPC_TOKEN`

Secrets must never be committed to the repository.

The complete cutover scripts are in `ops/`. They create a rollback dump before restoring the public Supabase schema, verify essential tables and metadata, and configure the Connector endpoints without changing its credentials or snapshots.

## Automated refresh policy

Windows Task Scheduler runs the local Connector only Saturday through Thursday.

Open Leads:
- 07:00
- 09:00
- 12:00
- 15:00

Historical activity (Daily / Weekly / Monthly):
- 07:30 only

The 07:00 Open Leads refresh is intentionally separated from the 07:30 activity refresh.
If the 07:30 activity run is missed, later Open Leads triggers recover stale activity components.

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

Business rules are stored in PostgreSQL and editable from Admin where appropriate. Technical CRM wiring (origin, API version, entity names, technical date fields and lookup source fields) is read-only from the Admin UI and protected server-side.

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

Before CRM data is pushed to PostgreSQL, the Connector saves a compressed local snapshot.

Default local backup:
- `connector/data-backup/<dataset>/latest.json.gz`
- rolling archive retained for 7 days by default

The Admin recovery button queues a restore request. The Connector processes the request on its next run and restores the latest local snapshots into PostgreSQL.

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

## Current cutover status

- Connector Scheduled Tasks are intentionally disabled.
- Supabase remains untouched until the local migration is verified.
- The local gateway routes and PostgreSQL adapter are prepared in this branch.
- After the dashboard preflight passes through the stable HTTPS gateway, Connector endpoints can be switched and the tasks can be re-enabled deliberately.
