const RELAY = {
  SECRET_PROPERTY: 'GAS_RELAY_SECRET',
  FOLDER_PROPERTY: 'GAS_RELAY_QUEUE_FOLDER_ID',
  MAX_CLOCK_SKEW_MS: 120000,
  JOB_TTL_MS: 10 * 60 * 1000,
  CLAIM_TTL_MS: 45000,
  MAX_WAIT_MS: 18000,
  MAX_BODY_CHARS: 8 * 1024 * 1024,
  METHODS: [
    'getDashboardBootstrap', 'getDashboardInitialPayload', 'getPeriodInitialPayload',
    'getTeamFilteredSummary', 'getTeamFilterOptions', 'getOpenFilteredSummary',
    'getOpenFilterOptions', 'getOpenLeadDetails', 'getOpenNearDeadlineDetails',
    'getFilteredPeriodSummary', 'getPeriodCampaignOptions', 'getActivityDetails',
    'getPeriodKpiDetails', 'getLeadStatusKpiDetails', 'getDimensionDetails',
    'getRepeatedCallDetails', 'getAdvisorTrend', 'getDashboardMeta',
    'getDashboardDiagnostics', 'getExportChunk'
  ],
  ADMIN_METHODS: [
    'getOverview', 'listTeamMembers', 'addTeamMember', 'updateTeamMembers',
    'deleteTeamMember', 'getCrmConfig', 'saveCrmConfig', 'requestRecovery', 'runQa'
  ]
};

function setupPrivateRelayQueue() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty(RELAY.FOLDER_PROPERTY);
  if (!folderId) {
    const folder = DriveApp.createFolder('Advisor KPI private RPC queue');
    folderId = folder.getId();
    props.setProperty(RELAY.FOLDER_PROPERTY, folderId);
  }
  return {ok: true, folderConfigured: true, folderId: folderId};
}

function doPost(e) {
  try {
    const envelope = JSON.parse(String(e && e.postData && e.postData.contents || '{}'));
    verifyEnvelope_(envelope);
    const result = dispatch_(envelope.body || {});
    return json_({ok: true, result: result});
  } catch (err) {
    return json_({ok: false, error: safeError_(err)}, 400);
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function safeError_(err) {
  return String(err && err.message || err || 'Relay request failed').slice(0, 300);
}

function verifyEnvelope_(env) {
  const timestamp = String(env.timestamp || '');
  const nonce = String(env.nonce || '');
  const signature = String(env.signature || '');
  const raw = JSON.stringify(env.body || {});
  const time = Number(timestamp);
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > RELAY.MAX_CLOCK_SKEW_MS) throw new Error('Expired relay request.');
  if (!/^[a-f0-9-]{20,80}$/i.test(nonce)) throw new Error('Invalid relay request id.');
  if (raw.length > RELAY.MAX_BODY_CHARS) throw new Error('Relay request is too large.');

  const secret = PropertiesService.getScriptProperties().getProperty(RELAY.SECRET_PROPERTY) || '';
  if (secret.length < 32) throw new Error('Relay secret is not configured.');
  const canonical = timestamp + '\n' + nonce + '\n' + raw;
  const expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8)
  ).replace(/=+$/g, '');
  if (!constantTimeEqual_(expected, signature)) throw new Error('Unauthorized relay request.');

  const cache = CacheService.getScriptCache();
  const nonceKey = 'relay-nonce:' + nonce;
  if (cache.get(nonceKey)) throw new Error('Duplicate relay request.');
  cache.put(nonceKey, '1', 300);
}

function constantTimeEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function dispatch_(body) {
  cleanupExpired_();
  switch (String(body.action || '')) {
    case 'enqueue': return enqueue_(body);
    case 'claim': return claim_();
    case 'complete': return complete_(body);
    case 'wait': return waitForResult_(body);
    default: throw new Error('Unknown relay action.');
  }
}

function queueFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty(RELAY.FOLDER_PROPERTY);
  if (!id) throw new Error('Private queue is not initialized.');
  return DriveApp.getFolderById(id);
}

function enqueue_(body) {
  const route = String(body.route || 'dashboard');
  const method = String(body.method || '');
  const allowed = route === 'dashboard' ? RELAY.METHODS : route === 'admin' ? RELAY.ADMIN_METHODS : [];
  if (allowed.indexOf(method) < 0) throw new Error('RPC method is not allowed.');
  const jobId = Utilities.getUuid();
  const now = Date.now();
  const job = {id: jobId, state: 'queued', route: route, method: method, args: Array.isArray(body.args) ? body.args : [], createdAt: now};
  queueFolder_().createFile('job-' + jobId + '.json', JSON.stringify(job), MimeType.PLAIN_TEXT);
  return {jobId: jobId};
}

function claim_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const files = queueFolder_().getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (!/^job-[a-f0-9-]+\.json$/i.test(file.getName())) continue;
      const job = parseFile_(file);
      if (!job || (job.state !== 'queued' && !(job.state === 'claimed' && Date.now() - Number(job.claimedAt || 0) > RELAY.CLAIM_TTL_MS))) continue;
      job.state = 'claimed';
      job.claimedAt = Date.now();
      file.setContent(JSON.stringify(job));
      return {job: {id: job.id, route: job.route || 'dashboard', method: job.method, args: job.args}};
    }
    return {job: null};
  } finally {
    lock.releaseLock();
  }
}

function complete_(body) {
  const jobId = String(body.jobId || '');
  const file = findJobFile_(jobId);
  if (!file) throw new Error('Relay job not found.');
  const job = parseFile_(file);
  if (!job || job.state !== 'claimed') throw new Error('Relay job is not claimed.');
  if (body.error) {
    job.state = 'done';
    job.error = String(body.error).slice(0, 500);
  } else {
    const value = body.value;
    const serialized = JSON.stringify(value);
    if (serialized.length > RELAY.MAX_BODY_CHARS) throw new Error('RPC result is too large for the relay.');
    job.state = 'done';
    job.value = value;
  }
  job.completedAt = Date.now();
  file.setContent(JSON.stringify(job));
  return {accepted: true};
}

function waitForResult_(body) {
  const jobId = String(body.jobId || '');
  const waitMs = Math.max(0, Math.min(RELAY.MAX_WAIT_MS, Number(body.waitMs || 0)));
  const deadline = Date.now() + waitMs;
  while (true) {
    const file = findJobFile_(jobId);
    if (!file) return {done: true, error: 'Relay job expired or was already consumed.'};
    const job = parseFile_(file);
    if (job && job.state === 'done') {
      const result = {done: true, value: job.value, error: job.error || null};
      file.setTrashed(true);
      return result;
    }
    if (Date.now() >= deadline) return {done: false};
    Utilities.sleep(Math.min(400, Math.max(100, deadline - Date.now())));
  }
}

function findJobFile_(jobId) {
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) return null;
  const files = queueFolder_().getFilesByName('job-' + jobId + '.json');
  return files.hasNext() ? files.next() : null;
}

function parseFile_(file) {
  try { return JSON.parse(file.getBlob().getDataAsString('UTF-8')); } catch (err) { return null; }
}

function cleanupExpired_() {
  const cutoff = Date.now() - RELAY.JOB_TTL_MS;
  const files = queueFolder_().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!/^job-[a-f0-9-]+\.json$/i.test(file.getName())) continue;
    const job = parseFile_(file);
    if (!job || Number(job.createdAt || 0) < cutoff) file.setTrashed(true);
  }
}
