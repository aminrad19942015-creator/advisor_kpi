const GAS_CONFIG = {
  FUNCTION_URL_PROPERTY: 'SUPABASE_DASHBOARD_RPC_URL',
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
  const cache = CacheService.getScriptCache();
  const rawManifest = cache.get(cacheManifestKey_(key));
  if (!rawManifest) return null;

  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch (err) {
    return null;
  }

  const count = Number(manifest && manifest.count || 0);
  if (!count || count > 40) return null;

  const keys = [];
  for (let i = 0; i < count; i++) keys.push(key + ':chunk:' + i);
  const chunks = cache.getAll(keys);
  let json = '';

  for (let i = 0; i < count; i++) {
    const part = chunks[key + ':chunk:' + i];
    if (part == null) return null;
    json += part;
  }

  try {
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

function cachePutJson_(key, value, ttlSeconds) {
  if (!key) return;
  const json = JSON.stringify(value);
  const size = GAS_CONFIG.CACHE_CHUNK_CHARS;
  const count = Math.ceil(json.length / size);
  if (count < 1 || count > 40) return;

  const ttl = Math.max(1, Math.min(Number(ttlSeconds || GAS_CONFIG.CACHE_DEFAULT_TTL_SECONDS), 21600));
  const cache = CacheService.getScriptCache();
  const chunks = {};

  for (let i = 0; i < count; i++) {
    chunks[key + ':chunk:' + i] = json.slice(i * size, (i + 1) * size);
  }

  cache.putAll(chunks, ttl);
  cache.put(cacheManifestKey_(key), JSON.stringify({ count: count }), ttl);
}

function cacheRemoveJson_(key) {
  if (!key) return;
  const cache = CacheService.getScriptCache();
  const rawManifest = cache.get(cacheManifestKey_(key));
  const keys = [cacheManifestKey_(key)];

  if (rawManifest) {
    try {
      const count = Number(JSON.parse(rawManifest).count || 0);
      for (let i = 0; i < Math.min(count, 40); i++) keys.push(key + ':chunk:' + i);
    } catch (err) {}
  }

  cache.removeAll(keys);
}

function fetchDashboardRpc_(method, args) {
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

function cachedRpc_(method, args, cacheKey, ttlSeconds) {
  const resolvedKey = activeCacheKey_(cacheKey);
  const hit = cacheGetJson_(resolvedKey);
  if (hit != null) return hit;

  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    locked = lock.tryLock(1200);
    if (locked) {
      const secondHit = cacheGetJson_(resolvedKey);
      if (secondHit != null) return secondHit;
    }

    const result = fetchDashboardRpc_(method, args);

    if (resolvedKey) cachePutJson_(resolvedKey, result, ttlSeconds);
    return result;
  } finally {
    if (locked) lock.releaseLock();
  }
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
  return fetchDashboardRpc_('getPeriodInitialPayload', [p, filters || {}]);
}

function getDashboardBootstrap() {
  return cachedRpc_('getDashboardBootstrap', [], 'dashboard:bootstrap:v2', 45);
}

function getTeamFilteredSummary(filters) {
  return fetchDashboardRpc_('getTeamFilteredSummary', [filters || {}]);
}

function getTeamFilterOptions() {
  return cachedRpc_('getTeamFilterOptions', [], 'dashboard:team-filter-options:v2', 300);
}

function getOpenFilteredSummary(filters) {
  return fetchDashboardRpc_('getOpenFilteredSummary', [filters || {}]);
}

function getOpenFilterOptions() {
  return cachedRpc_('getOpenFilterOptions', [], 'dashboard:open-filter-options:v2', 180);
}

function getOpenLeadDetails(field, value, filters) {
  return fetchDashboardRpc_('getOpenLeadDetails', [field, value, filters || {}]);
}

function getOpenNearDeadlineDetails(leadType, owner, filters) {
  return fetchDashboardRpc_('getOpenNearDeadlineDetails', [leadType, owner || '', filters || {}]);
}

function getFilteredPeriodSummary(period, filters) {
  return fetchDashboardRpc_('getFilteredPeriodSummary', [period, filters || {}]);
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
  return fetchDashboardRpc_('getActivityDetails', [period, type, user, filters || {}]);
}

function getPeriodKpiDetails(period, type, filters) {
  return fetchDashboardRpc_('getPeriodKpiDetails', [period, type, filters || {}]);
}

function getLeadStatusKpiDetails(period, type, filters) {
  return fetchDashboardRpc_('getLeadStatusKpiDetails', [period, type, filters || {}]);
}

function getDimensionDetails(period, source, field, value, filters) {
  return fetchDashboardRpc_('getDimensionDetails', [period, source, field, value, filters || {}]);
}

function getRepeatedCallDetails(period, filters) {
  return fetchDashboardRpc_('getRepeatedCallDetails', [period, filters || {}]);
}

function getAdvisorTrend(period, advisor) {
  return fetchDashboardRpc_('getAdvisorTrend', [period, advisor]);
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
