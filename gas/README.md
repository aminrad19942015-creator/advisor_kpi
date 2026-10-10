# Google Apps Script dashboard runtime

This folder contains the new Google Apps Script runtime for the Advisor KPI dashboard.

## Target architecture

```
CRM / Windows Connector
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
- `SUPABASE_ANON_KEY`
- `DASHBOARD_RPC_TOKEN` (required for production cutover)

The browser never receives these values.

The Supabase Edge Function:
- keeps JWT verification enabled,
- can additionally require `DASHBOARD_RPC_TOKEN`,
- connects to Postgres using Supabase's server-side `SUPABASE_DB_URL`,
- exposes only the dashboard RPC methods.

The GAS manifest is restricted to the advisor-kpi Supabase hostname and is configured for domain-only Web App access.

## Current branch status

Branch: `gas-dashboard-v1`

Implemented:
- GAS Web App shell using the existing production dashboard UI
- real `google.script.run` RPC wrappers
- one-call initial team/open bootstrap
- one-call initial period bootstrap
- retry only for transient HTTP errors
- chunked Script Cache + lock to reduce stampedes
- Supabase `dashboard-rpc` Edge Function
- PostgreSQL-backed versioned cache
- unique data guards + dashboard indexes
- atomic activity batch replacement code
- exact 07/09/12/15 schedule design
- global Connector overlap guard
- source-controlled Supabase Edge Function

Still blocked on external/runtime access:
- creation/deployment of the actual Apps Script project in the company Google Workspace account
- setting Script Properties and the matching Supabase Edge secret
- applying/verifying the new Connector schedule on the company workstation
- switching Connector upload endpoints away from the current Vercel/Railway path
- end-to-end CRM test from the company network

Implemented after the initial scaffold:
- lazy client-side Excel export with chunked data retrieval
- aggregate dashboard diagnostics RPC
- one-call `runCutoverPreflight()` for GAS + database health

Still to finish / decide before production:
- Admin runtime migration/cutover strategy
- final production smoke-test execution
- bridge-token activation after the real GAS Script Project exists

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
