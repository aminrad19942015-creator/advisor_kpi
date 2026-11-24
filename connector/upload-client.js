const { dashboardRequest } = require('./dashboard-http');

// Keep POST bodies small enough for the Windows connector's fallback transports.
// The server may advertise a lower limit, but never raise this client-side cap.
const SAFE_CHUNK_ROWS = 100;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkSizeFor(advertised) {
  const value = Number(advertised);
  if (!Number.isFinite(value) || value < 1) return SAFE_CHUNK_ROWS;
  return Math.max(1, Math.min(SAFE_CHUNK_ROWS, Math.floor(value)));
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function requestJson(url, token, body, label = 'Dashboard API') {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await dashboardRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crm-connector-token': token
        },
        body: JSON.stringify(body),
        timeoutMs: 90000
      });

      if (!response.ok) {
        const error = new Error(`${label} HTTP ${response.status}: ${response.text}`);
        error.retryable = retryableStatus(response.status);
        throw error;
      }

      return JSON.parse(response.text);
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable !== false;
      console.log(
        `${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error?.message || error}`
      );

      if (!retryable || attempt === MAX_ATTEMPTS) break;

      // Exponential backoff with a small jitter prevents synchronized retries
      // when multiple scheduled connector jobs hit the endpoint together.
      const backoff = Math.min(30000, BASE_BACKOFF_MS * (2 ** (attempt - 1)));
      const jitter = Math.floor(Math.random() * 250);
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}

async function uploadDatasets({ url, token, datasets, finalize, label = 'Dashboard API', request = requestJson }) {
  const start = await request(url, token, { action: 'start' }, `${label} start`);
  const batchId = start.batchId;
  if (!batchId) throw new Error(`${label} start did not return a batch id.`);

  const chunkSize = chunkSizeFor(start.maxChunkRows);
  for (const [dataset, rows] of Object.entries(datasets)) {
    let seq = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await request(
        url,
        token,
        { action: 'chunk', batchId, dataset, seq, rows: chunk },
        `${label} ${dataset} chunk ${seq + 1}`
      );
      console.log(`Uploaded ${dataset} chunk ${seq + 1}: ${chunk.length}`);
      seq++;
    }
  }

  // This is intentionally the final request. Callers only write their local
  // last-sync success marker after this promise resolves successfully.
  return request(
    url,
    token,
    { ...finalize, action: 'finalize', batchId },
    `${label} finalize`
  );
}

module.exports = {
  SAFE_CHUNK_ROWS,
  chunkSizeFor,
  requestJson,
  uploadDatasets
};
