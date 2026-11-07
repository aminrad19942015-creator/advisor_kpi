'use strict';

const crypto = require('node:crypto');

function canonicalRequest(timestamp, nonce, body) {
  return `${String(timestamp)}\n${String(nonce)}\n${JSON.stringify(body)}`;
}

function signRequest(secret, timestamp, nonce, body) {
  return crypto.createHmac('sha256', secret).update(canonicalRequest(timestamp, nonce, body), 'utf8').digest('base64url');
}

function verifyRequest(secret, envelope, now = Date.now(), maxSkewMs = 120000) {
  const timestamp = Number(envelope && envelope.timestamp);
  const nonce = String(envelope && envelope.nonce || '');
  const signature = String(envelope && envelope.signature || '');
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxSkewMs) return false;
  if (!/^[a-f0-9-]{20,80}$/i.test(nonce) || !signature) return false;
  const expected = Buffer.from(signRequest(secret, timestamp, nonce, envelope.body || {}));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function makeEnvelope(secret, body, now = Date.now(), nonce = crypto.randomUUID()) {
  const timestamp = String(now);
  return {timestamp, nonce, signature: signRequest(secret, timestamp, nonce, body), body};
}

module.exports = {canonicalRequest, signRequest, verifyRequest, makeEnvelope};
