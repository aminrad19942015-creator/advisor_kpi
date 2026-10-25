const RELAY = {
  SECRET_PROPERTY: 'GAS_RELAY_SECRET',
  FOLDER_PROPERTY: 'GAS_RELAY_QUEUE_FOLDER_ID',
  MAX_CLOCK_SKEW_MS: 120000,
  JOB_TTL_MS: 10 * 60 * 1000,
  CLAIM_TTL_MS: 45000,
  MAX_WAIT_MS: 18000,
  MAX_BODY_CHARS: 8 * 1024 * 1024,
  CACHE_CHUNK_CHARS: 20000,
  MAX_CACHE_CHUNKS: 40,
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
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (cache.get(nonceKey)) throw new Error('Duplicate relay request.');
    cache.put(nonceKey, '1', 300);
  } finally { lock.releaseLock(); }
}

function constantTimeEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function dispatch_(body) {
  // Waiting/completing a single job must not re-read every file in Drive.
  if (body.action === 'claim' || body.action === 'health') cleanupExpired_();
  switch (String(body.action || '')) {
    case 'health': {
      const folder = queueFolder_();
      return {ready: true, privateQueue: folder.getSharingAccess() === DriveApp.Access.PRIVATE && folder.getEditors().length === 0 && folder.getViewers().length === 0};
    }
    case 'enqueue': return enqueue_(body);
    case 'request': {
      const queued = enqueue_(body);
      const result = waitForResult_({jobId: queued.jobId, waitMs: body.waitMs});
      result.jobId = queued.jobId;
      return result;
    }
    case 'claim': return claim_(body);
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
  const file = queueFolder_().createFile('job-' + jobId + '.json', JSON.stringify(job), MimeType.PLAIN_TEXT);
  cachePut_('relay-file:' + jobId, file.getId(), 600);
  cachePut_('relay-wake', Utilities.getUuid(), 600);
  return {jobId: jobId};
}

function claim_(body) {
  const waitMs = Math.max(0, Math.min(RELAY.MAX_WAIT_MS, Number(body && body.waitMs || 0)));
  const started = Date.now(), deadline = started + waitMs;
  let generation = null, nextScan = 0;
  while (true) {
    const signal = cacheGet_('relay-wake') || '';
    if (signal !== generation || Date.now() >= nextScan) {
      const job = claimNext_();
      if (job) return {job: job, waitedMs: Date.now() - started};
      generation = signal;
      nextScan = Date.now() + 5000; // Durable fallback if a cache hint is evicted.
    }
    if (Date.now() >= deadline) return {job: null, waitedMs: Date.now() - started};
    Utilities.sleep(Math.min(250, Math.max(1, deadline - Date.now())));
  }
}

function claimNext_() {
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
      cachePut_('relay-file:' + job.id, file.getId(), 600);
      return {id: job.id, route: job.route || 'dashboard', method: job.method, args: job.args};
    }
    return null;
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
  cachePutJson_('relay-result:' + jobId, {value: job.value, error: job.error || null});
  return {accepted: true};
}

function waitForResult_(body) {
  const jobId = String(body.jobId || '');
  const waitMs = Math.max(0, Math.min(RELAY.MAX_WAIT_MS, Number(body.waitMs || 0)));
  const deadline = Date.now() + waitMs;
  let nextDriveCheck = 0;
  while (true) {
    const cached = cacheGetJson_('relay-result:' + jobId);
    if (cached) return consumeResult_(jobId, cached);
    if (Date.now() >= nextDriveCheck) {
      const file = findJobFile_(jobId);
      if (!file) return {done: true, error: 'Relay job expired or was already consumed.'};
      const job = parseFile_(file);
      if (job && job.state === 'done') return consumeResult_(jobId, {value: job.value, error: job.error || null});
      nextDriveCheck = Date.now() + 2000;
    }
    if (Date.now() >= deadline) return {done: false};
    Utilities.sleep(Math.min(250, Math.max(1, deadline - Date.now())));
  }
}

function consumeResult_(jobId, result) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const file = findJobFile_(jobId);
    if (!file) return {done: true, error: 'Relay job expired or was already consumed.'};
    file.setTrashed(true);
    cacheRemoveJson_('relay-result:' + jobId);
    cacheRemove_('relay-file:' + jobId);
    return {done: true, value: result.value, error: result.error || null};
  } finally { lock.releaseLock(); }
}

function findJobFile_(jobId) {
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) return null;
  const fileId = cacheGet_('relay-file:' + jobId);
  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      if (!file.isTrashed()) return file;
      return null;
    } catch (err) { cacheRemove_('relay-file:' + jobId); }
  }
  const files = queueFolder_().getFilesByName('job-' + jobId + '.json');
  if (!files.hasNext()) return null;
  const file = files.next();
  cachePut_('relay-file:' + jobId, file.getId(), 600);
  return file;
}

function parseFile_(file) {
  try { return JSON.parse(file.getBlob().getDataAsString('UTF-8')); } catch (err) { return null; }
}

function cleanupExpired_() {
  const last = Number(cacheGet_('relay-cleanup-at') || 0);
  if (Date.now() - last < 60000) return;
  cachePut_('relay-cleanup-at', String(Date.now()), 60);
  const cutoff = Date.now() - RELAY.JOB_TTL_MS;
  const files = queueFolder_().getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!/^job-[a-f0-9-]+\.json$/i.test(file.getName())) continue;
    const job = parseFile_(file);
    if (!job || Number(job.createdAt || 0) < cutoff) file.setTrashed(true);
  }
}

// Cache is an acceleration layer only. Drive remains the recoverable queue.
function cacheGet_(key) {
  try { return CacheService.getScriptCache().get(key); } catch (err) { return null; }
}
function cachePut_(key, value, ttl) {
  try { CacheService.getScriptCache().put(key, value, ttl); } catch (err) {}
}
function cacheRemove_(key) {
  try { CacheService.getScriptCache().remove(key); } catch (err) {}
}
function cachePutJson_(key, value) {
  const text = JSON.stringify(value), size = RELAY.CACHE_CHUNK_CHARS;
  const count = Math.ceil(text.length / size);
  if (!count || count > RELAY.MAX_CACHE_CHUNKS) return;
  try {
    const cache = CacheService.getScriptCache(), chunks = {};
    for (let i = 0; i < count; i++) chunks[key + ':' + i] = text.slice(i * size, (i + 1) * size);
    cache.putAll(chunks, 600);
    cache.put(key + ':count', String(count), 600);
  } catch (err) {}
}
function cacheGetJson_(key) {
  const count = Number(cacheGet_(key + ':count') || 0);
  if (!count || count > RELAY.MAX_CACHE_CHUNKS) return null;
  try {
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(key + ':' + i);
    const chunks = CacheService.getScriptCache().getAll(keys);
    if (keys.some(k => chunks[k] == null)) return null;
    return JSON.parse(keys.map(k => chunks[k]).join(''));
  } catch (err) { return null; }
}
function cacheRemoveJson_(key) {
  const count = Math.min(RELAY.MAX_CACHE_CHUNKS, Number(cacheGet_(key + ':count') || 0));
  const keys = [key + ':count'];
  for (let i = 0; i < count; i++) keys.push(key + ':' + i);
  try { CacheService.getScriptCache().removeAll(keys); } catch (err) {}
}
