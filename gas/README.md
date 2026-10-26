# Google Apps Script dashboard runtime

This folder contains the new Google Apps Script runtime for the Advisor KPI dashboard.

## Current local PostgreSQL publication

The existing coworkers' dashboard deployment now uses the separate Google Apps Script queue and an outbound worker on the office PC. PostgreSQL and the Next.js API listen only on loopback. No Cloudflare, public PostgreSQL port, Google Sheets, or additional hosting provider is used by this path. The queue uses owner-private temporary Drive JSON files and HMAC-signed requests.

Current project/deployment IDs and the dashboard's pre-existing `ANYONE_ANONYMOUS` access setting are recorded in `ops/apps-script-targets.json`. The older domain-only examples below describe a Workspace option, not this personal-account deployment. Production Script Properties select `GAS_RELAY_URL` plus `GAS_RELAY_SECRET`; legacy direct-API properties remain available for rollback and existing admin sessions.

See `ops/README.md` for staging, official-clasp publication, current-user startup, CRM schedules, and the end-to-end verification command. Bootstrap source containing local credentials is generated only in ignored runtime folders and is removed before versioned publication.

## Target architecture

```
CRM / Windows Connector
        |
        v
Loopback Gateway: /api/crm-shadow + /api/crm-activity
        |
        v
Portable PostgreSQL on the office PC  <-- authoritative operational snapshots
        |
        v
Loopback Gateway: /api/rpc + /api/admin-rpc
        ^
        | outbound polling by local worker
        v
Private Google Apps Script queue
        |
        v
Google Apps Script Web App
        |
        v
Browser
```

The company workstation is required for the database, local worker, and CRM refreshes. It must remain powered on with the user logged in. PostgreSQL itself is never exposed publicly.

## Non-negotiable runtime rules

### Speed

- GAS is a thin web host / secure RPC bridge, not the analytics engine.
- No raw 40k+ row CRM datasets are loaded into Google Sheets for dashboard calculation.
- Heavy filtering and aggregation stay in PostgreSQL.
- Initial team/open payload uses one GAS call.
- First load of each Daily/Weekly/Monthly page uses one GAS call.
- Repeated initial summaries use a versioned PostgreSQL cache in `private.dashboard_rpc_cache`.
- GAS Script Cache is chunked to stay below the per-key CacheService limit.
- Short-lived Edge cache and Postgres cache are versioned/short enough not to mask successful CRM refreshes.

### Data stability

- Local PostgreSQL remains the source of truth after cutover.
- A failed Connector run must not replace the last good snapshot.
- Open Leads uses shadow/next staging semantics.
- Activity batches are prepared in staging and swapped transactionally.
- Unique indexes protect Lead / Opportunity / Call / Ticket identifiers.
- A requested Daily/Weekly/Monthly family is rejected when counts are inconsistent.
- An unexpected all-zero 3-period family cannot wipe a populated monthly snapshot.
- Overall Activity sync timestamp represents the oldest successfully completed component timestamp across:
  - Lead / Opportunity
  - Calls
  - Tickets
- Connector overlap is blocked by a global Windows mutex.

### CRM schedule

Saturday through Thursday:

- **07:00**: one serial morning run
  1. Open Leads
  2. Lead + Opportunity history
  3. Calls history
  4. Tickets history
- **09:00**: Open Leads
- **12:00**: Open Leads
- **15:00**: Open Leads

Friday: no CRM refresh.

The 07:00 tasks are deliberately serial instead of two independent Windows tasks at the same clock time. This avoids two Playwright/ADFS sessions competing for the same CRM profile.

## Security

GAS never receives a PostgreSQL connection string.

Required Script Properties:

- `SUPABASE_DASHBOARD_RPC_URL`
- `DASHBOARD_RPC_TOKEN`

The browser never receives these values.

The local gateway:
- requires `DASHBOARD_RPC_TOKEN` on every dashboard and admin RPC POST request,
- requires `CRM_CONNECTOR_TOKEN` on every Connector request,
- connects only to the local `DATABASE_URL`,
- exposes only the dashboard, admin, and Connector HTTP routes.

The GAS manifest permits the advisor-kpi Supabase hostname and the `/api/` path on temporary `trycloudflare.com` subdomains for connectivity testing. The latter is intentionally broad because Quick Tunnel hostnames are randomly generated; the gateway must keep token authentication enabled. The Web App remains configured for domain-only access.

## Production status

Migration branch: `monthly-report-v1`

Migration branch: `gas-dashboard-v1` (completed and ready to merge)

Implemented:
- GAS Web App shell using the existing production dashboard UI
- real `google.script.run` RPC wrappers
- one-call initial team/open bootstrap
- one-call initial period bootstrap
- retry only for transient HTTP errors
- chunked Script Cache + lock to reduce stampedes
- Local Next.js dashboard RPC and Connector routes
- PostgreSQL-backed versioned cache
- unique data guards + dashboard indexes
- atomic activity batch replacement code
- exact 07/09/12/15 schedule design
- global Connector overlap guard
- source-controlled Supabase Edge Function

Production cutover completed and verified:
- Apps Script Web App deployed in the company Google Workspace account
- GAS Script Properties configured
- Connector endpoints cut over to Supabase
- Windows schedules installed and verified on the company workstation
- Open Leads, Lead/Opportunity, Calls and Tickets all completed successful live CRM syncs
- Admin login, health check and read path verified
- production verification returned `PRODUCTION_VERIFICATION_OK` and `COMPANY_PC_FINALIZATION_OK`

Implemented after the initial scaffold:
- lazy client-side Excel export with chunked data retrieval
- aggregate dashboard diagnostics RPC
- one-call `runCutoverPreflight()` for GAS + database health

Target runtime is:
- Windows Connector for CRM refresh
- Portable PostgreSQL + local Next.js gateway as the authoritative backend
- Google Apps Script Web App as the user/Admin runtime
- Supabase is used only for the one-time verified migration

## Apps Script configuration

Function URL:

```
https://YOUR-STABLE-GATEWAY.example/api/rpc
```

Do not commit API keys, database credentials, CRM passwords, Connector tokens, or the dashboard bridge token.


## Cutover preflight

After the Apps Script project is created and Script Properties are configured, run:

```javascript
runCutoverPreflight()
```

The result checks both:
- GAS configuration health
- Supabase dashboard diagnostics

Diagnostics include aggregate row counts, Daily/Weekly/Monthly consistency, Open Leads availability, staging state, cache state, and the three Activity component timestamps. No customer-level rows are returned by the diagnostic endpoint.


## Local connector cutover

Prepared endpoint base:

```
https://YOUR-STABLE-GATEWAY.example/api
```

Routes:

- `/crm-shadow`
- `/crm-activity`
- `/crm-config`
- `/connector-command`

The Edge Function is custom-authenticated with `CRM_CONNECTOR_TOKEN` and is fail-closed when that secret is not configured.

Prepared workstation scripts:

- `ops/configure-connector-local-gateway.ps1`
  - rewrites only dashboard endpoint variables
  - preserves CRM credentials and local snapshots

The company workstation remains stopped until the local PostgreSQL migration and GAS preflight both pass.

## Morning failure policy

The 07:00 runner now treats Lead/Opportunity, Calls and Tickets as independent update components after the Open Leads step.

If one Activity component fails:
- the remaining components still run,
- successful components keep their new snapshots,
- the failed component keeps its last successful snapshot,
- the Windows task exits failed at the end so monitoring still sees the problem,
- the overall Activity freshness timestamp resolves to the oldest successful component timestamp.

This avoids one CRM family blocking the other Activity families while preserving last-known-good data.


## Dashboard bridge authentication

The GAS dashboard bridge no longer uses the legacy Supabase anon JWT.

Required GAS Script Properties are only:

- `SUPABASE_DASHBOARD_RPC_URL`
- `DASHBOARD_RPC_TOKEN`

The plain bridge token exists only in GAS Script Properties and the local gateway environment. The browser never receives the token.


## Browser last-good fallback

The user dashboard stores only aggregate / advisor-summary payloads in browser localStorage:
- initial Team + Open Leads summary
- first-load Daily / Weekly / Monthly summaries

Customer-level drilldown rows are not persisted in browser storage.

If the data-service call fails temporarily, the dashboard renders the last valid summary and shows a visible fallback warning instead of rendering zeros.

The UI also compares Open Leads and Activity timestamps with the fixed Tehran schedule and shows a stale-data warning when a scheduled refresh appears to have been missed.

## Prepared activity tabs

The initial dashboard response optionally includes the unchanged Daily, Weekly, Monthly and Previous-month summary payloads. The local API prepares at most two periods concurrently with a four-second overall budget, isolating failed/slow periods from the initial Team/Open response. No customer-detail rows are prefetched.

The browser renders a prefetched tab on its first click without another Google round trip. Prepared payloads expire one minute after server generation, apply only to the default unfiltered tab, and are not reused for a different period or filtered view. Missing, expired or invalid payloads retain the existing on-demand loader and explicitly labelled last-good fallback. Rendering is lazy, so hidden charts/tables do not slow initial display. The initial browser snapshot excludes the bundle; an opened period uses its existing summary snapshot key.

## GAS Admin

The same Apps Script project can serve the independent Admin page using:

`?admin=1`

Admin features:
- independent password login with an 8-hour signed session
- CRM/Open Leads/Activity row counts and sync timestamps
- Daily/Weekly/Monthly consistency QA
- team member add/edit/delete
- CRM source-mode and business-rule editing
- local-backup recovery command for the next Connector run

Required additional Script Property:

- `ADMIN_PASSWORD`

The browser never receives the dashboard bridge token. Admin writes pass through GAS to the local `/api/admin-rpc` route, and successful Admin writes increment `admin_revision` so dashboard caches are invalidated automatically.

## Self-contained Excel exports

`ExcelVendor.html` wraps the unmodified SheetJS CE 0.20.3 mini browser build in a script tag from
`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js`.
SHA-256: `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939`.
Its Apache-2.0 license is preserved in `ExcelVendor.LICENSE.txt`.
The dashboard includes it inline, so clicking Export does not fetch code from a CDN.
The smaller mini build retains the existing XLSX writer without unused legacy spreadsheet formats.
`node --test connector/test-excel-export.js` checks the pinned bytes and round-trips
the actual Persian export helpers, including numeric AML columns and multiple data chunks.
