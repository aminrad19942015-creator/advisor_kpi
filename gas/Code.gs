const GAS_CONFIG = {
  FUNCTION_URL_PROPERTY: 'SUPABASE_DASHBOARD_RPC_URL',
  RELAY_URL_PROPERTY: 'GAS_RELAY_URL',
  RELAY_SECRET_PROPERTY: 'GAS_RELAY_SECRET',
  BRIDGE_TOKEN_PROPERTY: 'DASHBOARD_RPC_TOKEN',
  CACHE_CHUNK_CHARS: 28000,
  CACHE_DEFAULT_TTL_SECONDS: 45,
  MAX_RETRIES: 3,
  ADMIN_PASSWORD_PROPERTY: 'ADMIN_PASSWORD',
  CACHE_REV_PROPERTY: 'DASHBOARD_CACHE_REV'
};

function doGet(e) {
  const admin = !!(e && e.parameter && String(e.parameter.admin || '') === '1');
  return HtmlService.createTemplateFromFile(admin ? 'Admin' : 'Index')
    .evaluate()
    .setTitle(admin ? 'مدیریت داشبورد مشاوران' : 'داشبورد عملکرد مشاوران')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getGasHealth() {
  const props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    runtime: 'Google Apps Script',
    functionUrlConfigured: !!props.getProperty(GAS_CONFIG.FUNCTION_URL_PROPERTY),
    relayUrlConfigured: !!props.getProperty(GAS_CONFIG.RELAY_URL_PROPERTY),
    relaySecretConfigured: !!props.getProperty(GAS_CONFIG.RELAY_SECRET_PROPERTY),
    bridgeTokenConfigured: !!props.getProperty(GAS_CONFIG.BRIDGE_TOKEN_PROPERTY),
    now: new Date().toISOString()
  };
}

function setInitialConfig(functionUrl, bridgeToken) {
  if (!functionUrl || !/^https:\/\//i.test(String(functionUrl))) {
    throw new Error('Dashboard API URL is invalid.');
  }
  if (!bridgeToken || String(bridgeToken).length < 32) {
    throw new Error('Dashboard bridge token is invalid.');
  }

  PropertiesService.getScriptProperties().setProperties({
    [GAS_CONFIG.FUNCTION_URL_PROPERTY]: String(functionUrl).trim(),
    [GAS_CONFIG.BRIDGE_TOKEN_PROPERTY]: String(bridgeToken).trim()
  }, true);

  return getGasHealth();
}

function rpcConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty(GAS_CONFIG.FUNCTION_URL_PROPERTY);
  const bridgeToken = props.getProperty(GAS_CONFIG.BRIDGE_TOKEN_PROPERTY);

  if (!url || !bridgeToken) {
    throw new Error('GAS is not configured. Set the dashboard API URL and DASHBOARD_RPC_TOKEN in Script Properties.');
  }
  return {
    url: url,
    bridgeToken: bridgeToken
  };
}

function activeCacheKey_(key) {
  if (!key) return key;
  const props = PropertiesService.getScriptProperties();
  let rev = props.getProperty(GAS_CONFIG.CACHE_REV_PROPERTY);
  if (!rev) {
    rev = '1';
    props.setProperty(GAS_CONFIG.CACHE_REV_PROPERTY, rev);
  }
  return key + ':rev:' + rev;
}

function cacheManifestKey_(key) {
  return key + ':manifest';
}

function cacheGetJson_(key) {
  if (!key) return null;
  try {
    const cache = CacheService.getScriptCache();
    const rawManifest = cache.get(cacheManifestKey_(key));
    if (!rawManifest) return null;
    const manifest = JSON.parse(rawManifest);
    const count = Number(manifest && manifest.count || 0);
    if (!Number.isInteger(count) || count < 1 || count > 40) return null;
    const keys = [];
    const chunkKey = key + (manifest.version ? ':' + manifest.version : '') + ':chunk:';
    for (let i = 0; i < count; i++) keys.push(chunkKey + i);
    const chunks = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < count; i++) {
      const part = chunks[chunkKey + i];
      if (part == null) return null;
      json += part;
    }
    return JSON.parse(json);
  } catch (err) { return null; }
}

function cachePutJson_(key, value, ttlSeconds) {
  if (!key) return;
  const json = JSON.stringify(value);
  const size = GAS_CONFIG.CACHE_CHUNK_CHARS;
  const count = Math.ceil(json.length / size);
  if (count < 1 || count > 40) return;

  const ttl = Math.max(1, Math.min(Number(ttlSeconds || GAS_CONFIG.CACHE_DEFAULT_TTL_SECONDS), 21600));
  const chunks = {};
  const version = Utilities.getUuid();

  for (let i = 0; i < count; i++) {
    chunks[key + ':' + version + ':chunk:' + i] = json.slice(i * size, (i + 1) * size);
  }

  try {
    const cache = CacheService.getScriptCache();
    cache.putAll(chunks, ttl);
    cache.put(cacheManifestKey_(key), JSON.stringify({ count: count, version: version }), ttl);
  } catch (err) {} // A cache outage must not turn a successful database read into an error.
}

function cacheRemoveJson_(key) {
  if (!key) return;
  const cache = CacheService.getScriptCache();
  const rawManifest = cache.get(cacheManifestKey_(key));
  const keys = [cacheManifestKey_(key)];

  if (rawManifest) {
    try {
      const manifest = JSON.parse(rawManifest), count = Number(manifest.count || 0);
      const prefix = key + (manifest.version ? ':' + manifest.version : '') + ':chunk:';
      for (let i = 0; i < Math.min(count, 40); i++) keys.push(prefix + i);
    } catch (err) {}
  }

  cache.removeAll(keys);
}

function fetchDashboardRpc_(method, args) {
  const props = PropertiesService.getScriptProperties();
  const relayUrl = props.getProperty(GAS_CONFIG.RELAY_URL_PROPERTY);
  const relaySecret = props.getProperty(GAS_CONFIG.RELAY_SECRET_PROPERTY);
  if (relayUrl || relaySecret) {
    if (!relayUrl || !/^https:\/\//i.test(relayUrl) || !relaySecret || relaySecret.length < 32) {
      throw new Error('Google relay configuration is incomplete.');
    }
    return fetchDashboardRpcViaRelay_(relayUrl, relaySecret, method, args);
  }

  const cfg = rpcConfig_();
  const requestId = Utilities.getUuid();
  const payload = JSON.stringify({
    method: method,
    args: Array.isArray(args) ? args : []
  });

  let lastError = null;

  for (let attempt = 1; attempt <= GAS_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(cfg.url, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-request-id': requestId,
          'x-dashboard-token': cfg.bridgeToken
        },
        payload: payload,
        muteHttpExceptions: true,
        followRedirects: true
      });

      const status = response.getResponseCode();
      const text = response.getContentText('UTF-8');
      let body;

      try {
        body = JSON.parse(text);
      } catch (err) {
        body = null;
      }

      if (status >= 200 && status < 300 && body && body.ok === true) {
        return body.result;
      }

      const message = body && body.error ? body.error : ('Dashboard RPC HTTP ' + status);
      const retryable = status === 408 || status === 429 || status >= 500;
      lastError = new Error(message + ' [requestId=' + requestId + ']');
      lastError.retryable = retryable;

      if (!retryable || attempt === GAS_CONFIG.MAX_RETRIES) throw lastError;
    } catch (err) {
      lastError = err;
      if (err && err.retryable === false) throw err;
      if (attempt === GAS_CONFIG.MAX_RETRIES) throw err;
    }

    Utilities.sleep(250 * Math.pow(2, attempt - 1));
  }

  throw lastError || new Error('Dashboard RPC failed.');
}

function relayEnvelope_(secret, body) {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = Utilities.getUuid();
  const canonical = timestamp + '\n' + nonce + '\n' + raw;
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8)
  ).replace(/=+$/g, '');
  return {timestamp:timestamp,nonce:nonce,signature:signature,body:body};
}

function relayCall_(url, secret, body) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(relayEnvelope_(secret,body)),
    muteHttpExceptions: true,
    followRedirects: true
  });
  const status = response.getResponseCode();
  let parsed = null;
  try { parsed = JSON.parse(response.getContentText('UTF-8')); } catch (err) {}
  if (status < 200 || status >= 300 || !parsed || parsed.ok !== true) {
    throw new Error((parsed && parsed.error) || ('Google relay HTTP ' + status));
  }
  return parsed.result;
}

function fetchDashboardRpcViaRelay_(url, secret, method, args) {
  const allowed = [
    'getDashboardBootstrap', 'getDashboardInitialPayload', 'getPeriodInitialPayload',
    'getTeamFilteredSummary', 'getTeamFilterOptions', 'getOpenFilteredSummary',
    'getOpenFilterOptions', 'getOpenLeadDetails', 'getOpenNearDeadlineDetails',
    'getFilteredPeriodSummary', 'getPeriodCampaignOptions', 'getActivityDetails',
    'getPeriodKpiDetails', 'getLeadStatusKpiDetails', 'getDimensionDetails',
    'getRepeatedCallDetails', 'getAdvisorTrend', 'getDashboardMeta',
    'getDashboardDiagnostics', 'getExportChunk'
  ];
  if (allowed.indexOf(String(method)) < 0) throw new Error('RPC method is not allowed through the Google relay.');
  return relayRpc_(url, secret, 'dashboard', method, args);
}

function relayRpc_(url, secret, route, method, args, skipNative) {
  if (!skipNative && route === 'dashboard' && typeof AdvisorQueue !== 'undefined') {
    let result=AdvisorQueue.signedReadCall(relayEnvelope_(secret,{action:'request',route:route,method:String(method),args:Array.isArray(args)?args:[],waitMs:18000}));
    const deadline=Date.now()+150000;
    while (!result.done && !result.useHttp && Date.now()<deadline) {
      result=AdvisorQueue.signedReadCall(relayEnvelope_(secret,{action:'wait',jobId:result.jobId,waitMs:18000}));
    }
    if (result.useHttp) return relayRpc_(url,secret,route,method,args,true);
    if (result.error) throw new Error(String(result.error));
    if (!result.done) throw new Error('Local PostgreSQL gateway did not respond before the relay timeout.');
    return result.value;
  }
  const enqueued = relayCall_(url, secret, {action: 'request', route: route, method: String(method), args: Array.isArray(args) ? args : [], waitMs: 18000});
  if (enqueued && enqueued.done === true) {
    if (enqueued.error) throw new Error(String(enqueued.error));
    return enqueued.value;
  }
  const jobId = String(enqueued && enqueued.jobId || '');
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('Google relay returned an invalid job id.');

  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const result = relayCall_(url, secret, {action: 'wait', jobId: jobId, waitMs: 18000});
    if (result && result.done === true) {
      if (result.error) throw new Error(String(result.error));
      return result.value;
    }
  }
  throw new Error('Local PostgreSQL gateway did not respond before the relay timeout.');
}

function cachedRpc_(method, args, cacheKey, ttlSeconds) {
  const resolvedKey = activeCacheKey_(cacheKey);
  const hit = cacheGetJson_(resolvedKey);
  if (hit != null) return hit;

  // Independent filters must not wait on a global lock held across network I/O.
  const result = fetchDashboardRpc_(method, args);
  if (resolvedKey) cachePutJson_(resolvedKey, result, ttlSeconds);
  return result;
}

function cachedReadRpc_(method, args, ttlSeconds) {
  const hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify(args), Utilities.Charset.UTF_8
  )).slice(0, 32);
  return cachedRpc_(method, args, 'dashboard:read:v1:' + method + ':' + hash, ttlSeconds || 15);
}

function getDashboardInitialPayload(openFilters) {
  return cachedRpc_(
    'getDashboardInitialPayload',
    [openFilters || {}],
    'dashboard:initial:v3:' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        JSON.stringify(openFilters || {}),
        Utilities.Charset.UTF_8
      )
    ).slice(0, 24),
    45
  );
}

function getPeriodInitialPayload(period, filters) {
  const p = String(period || '');
  return cachedReadRpc_('getPeriodInitialPayload', [p, filters || {}]);
}

function getDashboardBootstrap() {
  return cachedRpc_('getDashboardBootstrap', [], 'dashboard:bootstrap:v2', 45);
}

function getTeamFilteredSummary(filters) {
  return cachedReadRpc_('getTeamFilteredSummary', [filters || {}]);
}

function getTeamFilterOptions() {
  return cachedRpc_('getTeamFilterOptions', [], 'dashboard:team-filter-options:v2', 300);
}

function getOpenFilteredSummary(filters) {
  return cachedReadRpc_('getOpenFilteredSummary', [filters || {}]);
}

function getOpenFilterOptions() {
  return cachedRpc_('getOpenFilterOptions', [], 'dashboard:open-filter-options:v2', 180);
}

function getOpenLeadDetails(field, value, filters) {
  return cachedReadRpc_('getOpenLeadDetails', [field, value, filters || {}], 10);
}

function getOpenNearDeadlineDetails(leadType, owner, filters) {
  return cachedReadRpc_('getOpenNearDeadlineDetails', [leadType, owner || '', filters || {}], 10);
}

function getFilteredPeriodSummary(period, filters) {
  return cachedReadRpc_('getFilteredPeriodSummary', [period, filters || {}]);
}

function getPeriodCampaignOptions(period) {
  return cachedRpc_(
    'getPeriodCampaignOptions',
    [period],
    'dashboard:campaign-options:v2:' + String(period || ''),
    180
  );
}

function getActivityDetails(period, type, user, filters) {
  return cachedReadRpc_('getActivityDetails', [period, type, user, filters || {}], 10);
}

function getPeriodKpiDetails(period, type, filters) {
  return cachedReadRpc_('getPeriodKpiDetails', [period, type, filters || {}], 10);
}

function getLeadStatusKpiDetails(period, type, filters) {
  return cachedReadRpc_('getLeadStatusKpiDetails', [period, type, filters || {}], 10);
}

function getDimensionDetails(period, source, field, value, filters) {
  return cachedReadRpc_('getDimensionDetails', [period, source, field, value, filters || {}], 10);
}

function getRepeatedCallDetails(period, filters) {
  return cachedReadRpc_('getRepeatedCallDetails', [period, filters || {}], 10);
}

function getAdvisorTrend(period, advisor) {
  return cachedReadRpc_('getAdvisorTrend', [period, advisor], 10);
}

function getDashboardMeta() {
  return cachedRpc_('getDashboardMeta', [], 'dashboard:meta:v2', 30);
}

function clearDashboardCache() {
  PropertiesService.getScriptProperties().setProperty(
    GAS_CONFIG.CACHE_REV_PROPERTY,
    Utilities.getUuid()
  );
  return { ok: true };
}


function getExportChunk(tab, dataset, filters, offset, limit) {
  return fetchDashboardRpc_('getExportChunk', [
    String(tab || ''),
    String(dataset || ''),
    filters || {},
    Math.max(0, Number(offset || 0)),
    Math.max(1, Math.min(10000, Number(limit || 10000)))
  ]);
}


function getDashboardDiagnostics() {
  return fetchDashboardRpc_('getDashboardDiagnostics', []);
}


function runCutoverPreflight() {
  return {
    gas: getGasHealth(),
    dashboard: getDashboardDiagnostics()
  };
}


function testConnection() {
  const started = Date.now();
  const result = runCutoverPreflight();
  const output = {
    ok: !!(result && result.gas && result.gas.ok && result.dashboard && result.dashboard.ok),
    elapsedMs: Date.now() - started,
    gas: result.gas,
    dashboard: result.dashboard
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}


function digestHex_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  ).map(function(b) {
    const v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function constantEqual_(a, b) {
  const x = digestHex_(a);
  const y = digestHex_(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function adminPassword_() {
  const value = PropertiesService.getScriptProperties().getProperty(GAS_CONFIG.ADMIN_PASSWORD_PROPERTY);
  if (!value || value.length < 8) throw new Error('ADMIN_PASSWORD is not configured in Script Properties.');
  return value;
}

function adminSessionSecret_() {
  return rpcConfig_().bridgeToken + ':' + adminPassword_();
}

function signAdminPayload_(payload) {
  const bytes = Utilities.computeHmacSha256Signature(
    payload,
    adminSessionSecret_(),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function makeAdminSession_() {
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const payload = String(expires) + '.' + Utilities.getUuid();
  return payload + '.' + signAdminPayload_(payload);
}

function verifyAdminSession_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const expires = Number(parts[0]);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const payload = parts[0] + '.' + parts[1];
  return constantEqual_(parts[2], signAdminPayload_(payload));
}

function requireAdmin_(token) {
  if (!verifyAdminSession_(token)) throw new Error('نشست مدیریت معتبر نیست یا منقضی شده است.');
}

function adminRpc_(token, method, args) {
  requireAdmin_(token);
  const props = PropertiesService.getScriptProperties();
  const relayUrl = props.getProperty(GAS_CONFIG.RELAY_URL_PROPERTY);
  const relaySecret = props.getProperty(GAS_CONFIG.RELAY_SECRET_PROPERTY);
  if (relayUrl || relaySecret) {
    if (!relayUrl || !/^https:\/\//i.test(relayUrl) || !relaySecret || relaySecret.length < 32) {
      throw new Error('Google relay configuration is incomplete.');
    }
    return relayRpc_(relayUrl, relaySecret, 'admin', method, args);
  }
  const cfg = rpcConfig_();
  const configuredUrl = String(cfg.url).replace(/\/+$/, '');
  const url = /\/dashboard-rpc$/i.test(configuredUrl)
    ? configuredUrl.replace(/\/dashboard-rpc$/i, '/admin-rpc')
    : /\/api\/rpc$/i.test(configuredUrl)
      ? configuredUrl.replace(/\/api\/rpc$/i, '/api/admin-rpc')
      : configuredUrl + '/admin-rpc';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-dashboard-token': cfg.bridgeToken,
      'x-request-id': Utilities.getUuid()
    },
    payload: JSON.stringify({method: method, args: Array.isArray(args) ? args : []}),
    muteHttpExceptions: true,
    followRedirects: true
  });
  const status = response.getResponseCode();
  let body = null;
  try { body = JSON.parse(response.getContentText('UTF-8')); } catch (err) {}
  if (status < 200 || status >= 300 || !body || body.ok !== true) {
    throw new Error((body && body.error) || ('Admin RPC HTTP ' + status));
  }
  return body.result;
}

function adminLogin(password) {
  const cache = CacheService.getScriptCache();
  const failures = Number(cache.get('admin:login:failures') || 0);
  if (failures >= 12) throw new Error('تعداد تلاش ورود زیاد است. چند دقیقه بعد دوباره تلاش کن.');
  if (!constantEqual_(String(password || ''), adminPassword_())) {
    cache.put('admin:login:failures', String(failures + 1), 300);
    throw new Error('رمز مدیریت نادرست است.');
  }
  cache.remove('admin:login:failures');
  return {ok: true, token: makeAdminSession_(), expiresInHours: 8};
}

function adminGetOverview(token) {
  return adminRpc_(token, 'getOverview', []);
}
function adminListTeamMembers(token) {
  return adminRpc_(token, 'listTeamMembers', []);
}
function adminAddTeamMember(token, member) {
  const out = adminRpc_(token, 'addTeamMember', [member || {}]);
  clearDashboardCache();
  return out;
}
function adminUpdateTeamMembers(token, members) {
  const out = adminRpc_(token, 'updateTeamMembers', [members || []]);
  clearDashboardCache();
  return out;
}
function adminDeleteTeamMember(token, code) {
  const out = adminRpc_(token, 'deleteTeamMember', [code]);
  clearDashboardCache();
  return out;
}
function adminGetCrmConfig(token) {
  return adminRpc_(token, 'getCrmConfig', []);
}
function adminSaveCrmConfig(token, config) {
  const out = adminRpc_(token, 'saveCrmConfig', [config || {}]);
  clearDashboardCache();
  return out;
}
function adminRequestRecovery(token) {
  return adminRpc_(token, 'requestRecovery', []);
}
function adminRunQa(token) {
  return adminRpc_(token, 'runQa', []);
}


function gasInvoke(action, args) {
  const a = Array.isArray(args) ? args : [];
  switch (String(action || '')) {
    case 'adminLogin': return adminLogin(a[0]);
    case 'adminGetOverview': return adminGetOverview(a[0]);
    case 'adminListTeamMembers': return adminListTeamMembers(a[0]);
    case 'adminAddTeamMember': return adminAddTeamMember(a[0], a[1]);
    case 'adminUpdateTeamMembers': return adminUpdateTeamMembers(a[0], a[1]);
    case 'adminDeleteTeamMember': return adminDeleteTeamMember(a[0], a[1]);
    case 'adminGetCrmConfig': return adminGetCrmConfig(a[0]);
    case 'adminSaveCrmConfig': return adminSaveCrmConfig(a[0], a[1]);
    case 'adminRequestRecovery': return adminRequestRecovery(a[0]);
    case 'adminRunQa': return adminRunQa(a[0]);
    default: throw new Error('Unknown GAS action: ' + action);
  }
}
