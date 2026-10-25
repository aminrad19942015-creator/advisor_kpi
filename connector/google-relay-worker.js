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

function createJobPool(executeJob, completeJob, reportError = console.error, limit = 2) {
  const active = new Set();
  let adminTail = Promise.resolve();
  return {
    async waitForSlot() { if (active.size >= limit) await Promise.race(active); },
    start(job) {
      const work = async () => {
        let value, error;
        const started = Date.now();
        try { value = await executeJob(job); }
        catch (err) { error = String(err && err.message || err).slice(0, 400); }
        await completeJob(job, value, error);
        if (error) reportError(`Relay job failed (${job.method}): ${error}`);
        else console.log(JSON.stringify({event:'relay-job-completed',method:job.method,elapsedMs:Date.now()-started}));
      };
      // Dashboard reads may overlap; admin operations retain their original order.
      const pending = job.route === 'admin' ? adminTail.then(work) : work();
      if (job.route === 'admin') adminTail = pending.catch(() => {});
      const task = pending.catch(err => reportError(`Google relay completion failed: ${String(err.message || err).slice(0,200)}`))
        .finally(() => active.delete(task));
      active.add(task);
      return task;
    },
    drain() { return Promise.all(active); }
  };
}

async function run() {
  if (!relayUrl || !/^https:\/\//i.test(relayUrl)) throw new Error('GAS_RELAY_URL must be an HTTPS Apps Script web-app URL.');
  if (relaySecret.length < 32) throw new Error('GAS_RELAY_SECRET must contain at least 32 characters.');
  if (!dashboardToken) throw new Error('DASHBOARD_RPC_TOKEN is missing.');
  console.log('Google relay worker started; job payloads and credentials are not logged.');
  const pool = createJobPool(execute, (job,value,error) => relay({action:'complete',jobId:job.id,...(error?{error}:{value})}));
  let failures = 0;

  while (!stopping) {
    await pool.waitForSlot();
    try {
      const started = Date.now();
      const claimed = await relay({action: 'claim', waitMs: 15000});
      failures = 0;
      const job = claimed && claimed.job;
      if (!job) {
        // Compatible with old deployments, but no extra idle delay after long-polling.
        await delay(Math.max(0, pollMs - (Date.now() - started)));
        continue;
      }
      pool.start(job);
    } catch (error) {
      console.error(`Google relay unavailable: ${String(error && error.message || error).slice(0, 200)}`);
      await delay(Math.min(30000, Math.max(pollMs, 2000) * Math.pow(2, Math.min(failures++, 3))));
    }
  }
  await pool.drain();
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

if (require.main === module) run().catch(error => {
  console.error(String(error && error.message || error));
  process.exitCode = 1;
});

module.exports = {ALLOWED_METHODS, ALLOWED_ADMIN_METHODS, postJson, execute, createJobPool, run};
