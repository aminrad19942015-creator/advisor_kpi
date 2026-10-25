'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {makeEnvelope, verifyRequest, signRequest} = require('./google-relay-protocol');

const secret = 'test-secret-that-is-long-enough-for-hmac';

test('signed envelope validates and uses URL-safe HMAC', () => {
  const body = {action: 'claim', nested: {value: 4}};
  const envelope = makeEnvelope(secret, body, 1700000000000, 'a'.repeat(36));
  assert.match(envelope.signature, /^[A-Za-z0-9_-]+$/);
  assert.equal(verifyRequest(secret, envelope, 1700000000000), true);
});

test('tampering, replay age, and invalid nonce are rejected', () => {
  const envelope = makeEnvelope(secret, {action: 'claim'}, 1700000000000, 'b'.repeat(36));
  assert.equal(verifyRequest(secret, {...envelope, body: {action: 'complete'}}, 1700000000000), false);
  assert.equal(verifyRequest(secret, envelope, 1700000300000), false);
  assert.equal(verifyRequest(secret, {...envelope, nonce: 'bad'}, 1700000000000), false);
});

test('signature is deterministic for the exact canonical body', () => {
  const body = {action: 'wait', jobId: 'id', waitMs: 1000};
  assert.equal(signRequest(secret, '1234', 'nonce-12345678901234567890', body),
    signRequest(secret, '1234', 'nonce-12345678901234567890', body));
});
