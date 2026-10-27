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

- Production UI remains the existing Google Apps Script web-app deployment.
- Portable PostgreSQL remains on loopback; no public database port, tunnel or Sheets storage is required.
- The user-level CRM Open Leads, Activity and Previous Month scheduled tasks are enabled. The obsolete Daily Sync task stays disabled to avoid duplicate runs.
- The original gateway on 3010 continues serving CRM writes without interruption.

## Interactive reads (monthly-report-v1)

The user-level `Advisor KPI Fast Read Server` task serves an isolated build on
127.0.0.1:3012 (guard 3013). Build it with `ADVISOR_READ_BUILD=1`; its output is
`runtime/fast-read-build`, never the live connector's `.next` directory. The
ignored `runtime/fast-read-ready.json` selects this reader for the Google worker.
`ops/install-fast-read-server.ps1` registers the current-user, non-admin logon task
after a successful isolated build. Verify it before selecting the reader; restart
only the dashboard relay worker to pick up the ready marker.
The reader also supports isolated slot B (`ADVISOR_READ_SLOT=b`, output
`runtime/fast-read-build-b`, ready marker `buildSlot: "b"`) so subsequent builds
never modify the files of the currently running reader.

Both runtime tasks retain their logon triggers and have a two-minute repeating
recovery trigger with `IgnoreNew`, so an already-running instance is never
restarted. `ops/enable-runtime-recovery.ps1` updates only these two validated,
current-user tasks, enables missed-start recovery and disables battery-stop
conditions; CRM task definitions are untouched. The browser also probes the
native Google cache after an initial connection failure (even with no loaded
interactive revision), refreshes its fallback data and clears the offline banner
when a fresh report becomes available. No whole-page reload is needed on the new
version; older already-open pages need one refresh to receive this recovery code.

The worker checks the authoritative PostgreSQL revision every 30 seconds and
proactively publishes a compressed report into the existing signed, same-owner
Google library's temporary cache. The cache is not authoritative: entries are
unusable after 90 seconds without a successful database heartbeat; cache loss
falls back to the existing private queue. Revision changes invalidate browser
reads and trigger a fresh report. Actual CRM last-sync timestamps are preserved.

Reports contain only the fields needed for calculations; lead numbers are
replaced with opaque join references. No customer names, phone numbers, national
IDs or descriptions enter the interactive report. Unpacked facts remain only in
page memory, not Sheets or browser persistent storage. All four periods, Open
Leads and Team filters calculate in the browser using the existing business rules.
`node ops/verify-report-engine.cjs` performs a read-only differential check against
the SQL implementation (49 period/Open/Team filter cases).

Drilldowns request 100 rows plus one SQL sentinel and offer **Show next 100**;
revision checks prevent mixing pages across syncs. First pages of 40 common,
unfiltered KPI drilldowns are prepared in the signed Google cache. Other details
and later pages still use the private queue, with much smaller responses. Excel
chunks now query only the requested dataset with SQL pagination. Large relay
responses are gzip-compressed and oversized failures are completed explicitly
instead of being re-claimed indefinitely. Admin writes remain ordered and gated
by the existing password/token checks.
