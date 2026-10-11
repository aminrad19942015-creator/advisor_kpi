# Google Apps Script dashboard runtime

This folder contains the new Google Apps Script runtime for the Advisor KPI dashboard.

## Target architecture

```
CRM / Windows Connector
        |
        v
Supabase Edge Function: connector-api
        |
        v
Supabase PostgreSQL  <-- authoritative operational snapshots
        |
        v
Supabase Edge Function: dashboard-rpc
        |
        v
Google Apps Script Web App
        |
        v
Browser
```

The company workstation is required only for CRM refreshes. If it is off, the dashboard continues serving the last successful Supabase snapshot.

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

- Supabase remains the source of truth.
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

The Supabase Edge Function:
- has platform JWT verification disabled because GAS is not a Supabase user session,
- requires `DASHBOARD_RPC_TOKEN` on every dashboard POST request,
- compares only a SHA-256 hash stored in the private schema,
- connects to Postgres using Supabase's server-side `SUPABASE_DB_URL`,
- exposes only the dashboard RPC methods.

The GAS manifest is restricted to the advisor-kpi Supabase hostname and is configured for domain-only Web App access.

## Production status

Production branch: `main`

Migration branch: `gas-dashboard-v1` (completed and ready to merge)

Implemented:
- GAS Web App shell using the existing production dashboard UI
- real `google.script.run` RPC wrappers
- one-call initial team/open bootstrap
- one-call initial period bootstrap
- retry only for transient HTTP errors
- chunked Script Cache + lock to reduce stampedes
- Supabase `dashboard-rpc` Edge Function
- Supabase `connector-api` Edge Function for Open Leads / Activity / Config / Commands
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

Production runtime is now:
- Windows Connector for CRM refresh only
- Supabase PostgreSQL + Edge Functions as the authoritative backend
- Google Apps Script Web App as the user/Admin runtime
- Vercel/Railway are not part of the operational request path

## Apps Script configuration

Function URL:

```
https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/dashboard-rpc
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


## Supabase connector cutover

Prepared endpoint base:

```
https://tdsqkxyqmebyufcmskkm.supabase.co/functions/v1/connector-api
```

Routes:

- `/crm-shadow`
- `/crm-activity`
- `/crm-config`
- `/connector-command`

The Edge Function is custom-authenticated with `CRM_CONNECTOR_TOKEN` and is fail-closed when that secret is not configured.

Prepared workstation scripts:

- `connector/cutover-supabase.ps1`
  - backs up `.env.local`
  - rewrites only dashboard endpoint variables
  - preserves CRM credentials
  - runs endpoint verification
- `connector/verify-supabase-endpoints.ps1`
  - verifies all four Supabase routes using the existing Connector token

The company workstation is cut over to the Supabase Connector API. Future operational updates are sourced from the `main` branch.

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

The plain bridge token exists only in GAS Script Properties. Supabase stores only its SHA-256 hash in `private.dashboard_rpc_auth`. The browser never receives the token.


## Browser last-good fallback

The user dashboard stores only aggregate / advisor-summary payloads in browser localStorage:
- initial Team + Open Leads summary
- first-load Daily / Weekly / Monthly summaries

Customer-level drilldown rows are not persisted in browser storage.

If the GAS-to-Supabase call fails temporarily, the dashboard renders the last valid summary and shows a visible fallback warning instead of rendering zeros.

The UI also compares Open Leads and Activity timestamps with the fixed Tehran schedule and shows a stale-data warning when a scheduled refresh appears to have been missed.

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

The browser never receives the dashboard bridge token. Admin writes pass through GAS to the separate Supabase `admin-rpc` Edge Function, and successful Admin writes increment `admin_revision` so dashboard caches are invalidated automatically.
