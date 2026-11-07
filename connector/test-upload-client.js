const assert = require('assert/strict');
const { chunkSizeFor, uploadDatasets } = require('./upload-client');

async function main() {
  assert.equal(chunkSizeFor(400), 100);
  assert.equal(chunkSizeFor(50), 50);
  assert.equal(chunkSizeFor(undefined), 100);

  const calls = [];
  const rows = Array.from({ length: 205 }, (_, id) => ({ id }));
  const request = async (_url, _token, body) => {
    calls.push(body);
    if (body.action === 'start') return { batchId: 'test-batch', maxChunkRows: 400 };
    if (body.action === 'finalize') return { ok: true };
    return { ok: true };
  };

  await uploadDatasets({
    url: 'https://example.invalid',
    token: 'test-token',
    datasets: { open_leads: rows },
    finalize: { expectedRows: rows.length },
    request
  });

  assert.deepEqual(calls.map(call => call.action), ['start', 'chunk', 'chunk', 'chunk', 'finalize']);
  assert.deepEqual(calls.slice(1, 4).map(call => call.rows.length), [100, 100, 5]);
  assert.equal(calls.at(-1).expectedRows, rows.length);
  console.log('upload-client tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
