'use strict';

const {makeEnvelope} = require('./google-relay-protocol');

const ALLOWED_METHODS = new Set([
  'getDashboardBootstrap', 'getDashboardInitialPayload', 'getPeriodInitialPayload',
  'getTeamFilteredSummary', 'getTeamFilterOptions', 'getOpenFilteredSummary',
  'getOpenFilterOptions', 'getOpenLeadDetails', 'getOpenNearDeadlineDetails',
  'getFilteredPeriodSummary', 'getPeriodCampaignOptions', 'getActivityDetails',
  'getPeriodKpiDetails', 'getLeadStatusKpiDetails', 'getDimensionDetails',
  'getRepeatedCallDetails', 'getAdvisorTrend', 'getDashboardMeta',
  'getDashboardDiagnostics', 'getExportChunk'
]);
const ALLOWED_ADMIN_METHODS = new Set([
  'getOverview', 'listTeamMembers', 'addTeamMember', 'updateTeamMembers',
  'deleteTeamMember', 'getCrmConfig', 'saveCrmConfig', 'requestRecovery', 'runQa'
]);

const relayUrl = String(process.env.GAS_RELAY_URL || '').trim();
const relaySecret = String(process.env.GAS_RELAY_SECRET || '');
const dashboardUrl = String(process.env.LOCAL_DASHBOARD_RPC_URL || 'http://127.0.0.1:3010/api/rpc').trim();
const dashboardToken = String(process.env.DASHBOARD_RPC_TOKEN || '');
const pollMs = Math.max(5000, Math.min(60000, Number(process.env.GAS_RELAY_POLL_MS || 5000)));
let stopping = false;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`HTTP ${response.status} returned a non-JSON response.`); }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(parsed.error || 'request failed').slice(0, 200)}`);
  return parsed;
}

async function relay(body) {
  const envelope = makeEnvelope(relaySecret, body);
  const response = await postJson(relayUrl, envelope);
  if (response.ok !== true) throw new Error(String(response.error || 'Google relay rejected request.'));
  return response.result;
}

async function execute(job) {
  const route = String(job && job.route || 'dashboard');
  const allowed = route === 'dashboard' ? ALLOWED_METHODS : route === 'admin' ? ALLOWED_ADMIN_METHODS : new Set();
  if (!job || !/^[a-f0-9-]{36}$/i.test(String(job.id || '')) || !allowed.has(String(job.method || ''))) {
    throw new Error('The relay returned an invalid job.');
  }
  const endpoint = route === 'admin' ? dashboardUrl.replace(/\/api\/rpc\/?$/i, '/api/admin-rpc') : dashboardUrl;
  const response = await postJson(endpoint, {
    method: job.method,
    args: Array.isArray(job.args) ? job.args : []
  }, {'x-dashboard-token': dashboardToken, 'x-request-id': job.id});
  if (response.ok !== true) throw new Error(String(response.error || 'Local dashboard RPC failed.'));
  return response.result;
}

async function run() {
  if (!relayUrl || !/^https:\/\//i.test(relayUrl)) throw new Error('GAS_RELAY_URL must be an HTTPS Apps Script web-app URL.');
  if (relaySecret.length < 32) throw new Error('GAS_RELAY_SECRET must contain at least 32 characters.');
  if (!dashboardToken) throw new Error('DASHBOARD_RPC_TOKEN is missing.');
  console.log('Google relay worker started; job payloads and credentials are not logged.');

  while (!stopping) {
    try {
      const claimed = await relay({action: 'claim'});
      const job = claimed && claimed.job;
      if (!job) {
        await delay(pollMs);
        continue;
      }
      try {
        const value = await execute(job);
        await relay({action: 'complete', jobId: job.id, value});
      } catch (error) {
        await relay({action: 'complete', jobId: job.id, error: String(error && error.message || error).slice(0, 400)});
        console.error(`Relay job failed (${job.method}): ${String(error && error.message || error).slice(0, 200)}`);
      }
    } catch (error) {
      console.error(`Google relay unavailable: ${String(error && error.message || error).slice(0, 200)}`);
      await delay(Math.max(pollMs, 2000));
    }
  }
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

if (require.main === module) run().catch(error => {
  console.error(String(error && error.message || error));
  process.exitCode = 1;
});

module.exports = {ALLOWED_METHODS, ALLOWED_ADMIN_METHODS, postJson, execute, run};
