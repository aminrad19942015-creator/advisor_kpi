const GAS_CONFIG = {
  FUNCTION_URL_PROPERTY: 'SUPABASE_DASHBOARD_RPC_URL',
  BRIDGE_TOKEN_PROPERTY: 'DASHBOARD_RPC_TOKEN',
  CACHE_CHUNK_CHARS: 28000,
  CACHE_DEFAULT_TTL_SECONDS: 45,
  MAX_RETRIES: 3
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('داشبورد عملکرد مشاوران')
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
    throw new Error('Supabase Function URL is invalid.');
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
    throw new Error('GAS is not configured. Set SUPABASE_DASHBOARD_RPC_URL and DASHBOARD_RPC_TOKEN in Script Properties.');
  }
  return {
    url: url,
    bridgeToken: bridgeToken
  };
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
  const hit = cacheGetJson_(cacheKey);
  if (hit != null) return hit;

  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    locked = lock.tryLock(1200);
    if (locked) {
      const secondHit = cacheGetJson_(cacheKey);
      if (secondHit != null) return secondHit;
    }

    const result = fetchDashboardRpc_(method, args);

    if (cacheKey) cachePutJson_(cacheKey, result, ttlSeconds);
    return result;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function getDashboardInitialPayload(openFilters) {
  return cachedRpc_(
    'getDashboardInitialPayload',
    [openFilters || {}],
    'dashboard:initial:v2:' + Utilities.base64EncodeWebSafe(
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

function getOpenLeadDetails(field, value) {
  return fetchDashboardRpc_('getOpenLeadDetails', [field, value]);
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
  [
    'dashboard:bootstrap:v2',
    'dashboard:team-filter-options:v2',
    'dashboard:open-filter-options:v2',
    'dashboard:campaign-options:v2:daily',
    'dashboard:campaign-options:v2:weekly',
    'dashboard:campaign-options:v2:monthly',
    'dashboard:meta:v2'
  ].forEach(cacheRemoveJson_);

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
