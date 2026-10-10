const GAS_CONFIG = {
  FUNCTION_URL_PROPERTY: 'SUPABASE_DASHBOARD_RPC_URL',
  ANON_KEY_PROPERTY: 'SUPABASE_ANON_KEY',
  CACHE_TTL_SECONDS: 60
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
    anonKeyConfigured: !!props.getProperty(GAS_CONFIG.ANON_KEY_PROPERTY),
    now: new Date().toISOString()
  };
}

function setInitialConfig(functionUrl, anonKey) {
  if (!functionUrl || !/^https:\/\//i.test(String(functionUrl))) {
    throw new Error('Supabase Function URL is invalid.');
  }
  if (!anonKey || String(anonKey).length < 20) {
    throw new Error('Supabase anon key is invalid.');
  }

  PropertiesService.getScriptProperties().setProperties({
    [GAS_CONFIG.FUNCTION_URL_PROPERTY]: String(functionUrl).trim(),
    [GAS_CONFIG.ANON_KEY_PROPERTY]: String(anonKey).trim()
  }, true);

  return getGasHealth();
}

function callDashboardRpc_(method, args, cacheKey, ttlSeconds) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty(GAS_CONFIG.FUNCTION_URL_PROPERTY);
  const anonKey = props.getProperty(GAS_CONFIG.ANON_KEY_PROPERTY);

  if (!url || !anonKey) {
    throw new Error('GAS is not configured. Set SUPABASE_DASHBOARD_RPC_URL and SUPABASE_ANON_KEY in Script Properties.');
  }

  const cache = CacheService.getScriptCache();
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + anonKey,
      apikey: anonKey
    },
    payload: JSON.stringify({
      method: method,
      args: Array.isArray(args) ? args : []
    }),
    muteHttpExceptions: true,
    followRedirects: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText('UTF-8');

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error('Invalid dashboard RPC response. HTTP ' + status);
  }

  if (status < 200 || status >= 300 || !payload || payload.ok !== true) {
    throw new Error((payload && payload.error) || ('Dashboard RPC HTTP ' + status));
  }

  const result = payload.result;

  if (cacheKey) {
    const ttl = Math.max(1, Math.min(Number(ttlSeconds || GAS_CONFIG.CACHE_TTL_SECONDS), 21600));
    cache.put(cacheKey, JSON.stringify(result), ttl);
  }

  return result;
}

function getDashboardBootstrap() {
  return callDashboardRpc_('getDashboardBootstrap', [], 'dashboard:bootstrap', 45);
}

function getTeamFilteredSummary(filters) {
  return callDashboardRpc_('getTeamFilteredSummary', [filters || {}]);
}

function getTeamFilterOptions() {
  return callDashboardRpc_('getTeamFilterOptions', [], 'dashboard:team-filter-options', 300);
}

function getOpenFilteredSummary(filters) {
  return callDashboardRpc_('getOpenFilteredSummary', [filters || {}]);
}

function getOpenFilterOptions() {
  return callDashboardRpc_('getOpenFilterOptions', [], 'dashboard:open-filter-options', 180);
}

function getOpenLeadDetails(field, value) {
  return callDashboardRpc_('getOpenLeadDetails', [field, value]);
}

function getOpenNearDeadlineDetails(leadType, owner, filters) {
  return callDashboardRpc_('getOpenNearDeadlineDetails', [leadType, owner || '', filters || {}]);
}

function getFilteredPeriodSummary(period, filters) {
  return callDashboardRpc_('getFilteredPeriodSummary', [period, filters || {}]);
}

function getPeriodCampaignOptions(period) {
  return callDashboardRpc_('getPeriodCampaignOptions', [period], 'dashboard:campaign-options:' + String(period || ''), 180);
}

function getActivityDetails(period, type, user, filters) {
  return callDashboardRpc_('getActivityDetails', [period, type, user, filters || {}]);
}

function getPeriodKpiDetails(period, type, filters) {
  return callDashboardRpc_('getPeriodKpiDetails', [period, type, filters || {}]);
}

function getLeadStatusKpiDetails(period, type, filters) {
  return callDashboardRpc_('getLeadStatusKpiDetails', [period, type, filters || {}]);
}

function getDimensionDetails(period, source, field, value, filters) {
  return callDashboardRpc_('getDimensionDetails', [period, source, field, value, filters || {}]);
}

function getRepeatedCallDetails(period, filters) {
  return callDashboardRpc_('getRepeatedCallDetails', [period, filters || {}]);
}

function getAdvisorTrend(period, advisor) {
  return callDashboardRpc_('getAdvisorTrend', [period, advisor]);
}

function getDashboardMeta() {
  return callDashboardRpc_('getDashboardMeta', [], 'dashboard:meta', 45);
}

function clearDashboardCache() {
  CacheService.getScriptCache().removeAll([
    'dashboard:bootstrap',
    'dashboard:team-filter-options',
    'dashboard:open-filter-options',
    'dashboard:campaign-options:daily',
    'dashboard:campaign-options:weekly',
    'dashboard:campaign-options:monthly',
    'dashboard:meta'
  ]);
  return { ok: true };
}
