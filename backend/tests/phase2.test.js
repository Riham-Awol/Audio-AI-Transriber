import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  createSignedStreamToken,
  resolveLocalStoragePath,
  verifySignedStreamToken,
} from '../src/services/storageService.js';

function invokeExpress(app, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough({ autoDestroy: false });
    req.method = method;
    req.url = url;
    req.originalUrl = url;
    req.headers = { host: 'localhost', ...headers };
    req.socket = Object.assign(new EventEmitter(), { remoteAddress: '127.0.0.1' });
    req.connection = req.socket;

    if (body !== null) {
      const payload = JSON.stringify(body);
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(Buffer.byteLength(payload));
      req.end(Buffer.from(payload));
    } else {
      req.end();
    }

    const resHeaders = {};
    const chunks = [];
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
      locals: {},
      setHeader(name, value) {
        resHeaders[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return resHeaders[name.toLowerCase()];
      },
      removeHeader(name) {
        delete resHeaders[name.toLowerCase()];
      },
      writeHead(code, hdrs) {
        this.statusCode = code;
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) resHeaders[k.toLowerCase()] = v;
        }
        return this;
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        this.headersSent = true;
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        resolve({ status: this.statusCode, headers: resHeaders, body: json, text: raw });
      },
    });

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

describe('Phase 2 — Storage & Signed Stream Security', () => {
  it('resolves safe local storage keys inside storage directory and blocks path traversal', () => {
    const safe = resolveLocalStoragePath('org-123/meeting-456/audio.mp3');
    const expectedPrefix = path.resolve(env.storage.localDir);
    assert.ok(safe.startsWith(expectedPrefix + path.sep));

    assert.throws(() => resolveLocalStoragePath('../../etc/passwd'), /Invalid storage key path/);
    assert.throws(() => resolveLocalStoragePath('../secrets.env'), /Invalid storage key path/);
  });

  it('signs and verifies HMAC playback stream URLs while rejecting tampering, expiry, or org mismatch', () => {
    const recordingId = '11111111-1111-1111-1111-111111111111';
    const organizationId = '22222222-2222-2222-2222-222222222222';
    const { exp, sig } = createSignedStreamToken({ recordingId, organizationId, ttlSeconds: 600 });

    assert.equal(verifySignedStreamToken({ recordingId, organizationId, exp, sig }), true);

    const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
    assert.equal(verifySignedStreamToken({ recordingId, organizationId, exp, sig: tamperedSig }), false);

    assert.equal(
      verifySignedStreamToken({
        recordingId,
        organizationId: '33333333-3333-3333-3333-333333333333',
        exp,
        sig,
      }),
      false
    );

    assert.equal(
      verifySignedStreamToken({
        recordingId: '44444444-4444-4444-4444-444444444444',
        organizationId,
        exp,
        sig,
      }),
      false
    );

    assert.equal(
      verifySignedStreamToken({
        recordingId,
        organizationId,
        exp: Math.floor(Date.now() / 1000) - 60,
        sig,
      }),
      false
    );
  });
});

describe('Phase 2 — Recordings & Internal AI Route Guards', () => {
  const app = createApp();
  const sampleId = '11111111-1111-1111-1111-111111111111';
  const sampleOrgId = '22222222-2222-2222-2222-222222222222';

  it('rejects unauthenticated access to protected recording endpoints with 401', async () => {
    const cases = [
      { method: 'POST', url: '/api/recordings/upload' },
      { method: 'GET', url: `/api/recordings/meeting/${sampleId}` },
      { method: 'GET', url: `/api/recordings/${sampleId}/playback-url` },
      { method: 'GET', url: `/api/recordings/${sampleId}/download` },
      { method: 'POST', url: `/api/recordings/${sampleId}/retry` },
      { method: 'DELETE', url: `/api/recordings/${sampleId}` },
    ];

    for (const c of cases) {
      const res = await invokeExpress(app, c);
      assert.equal(res.status, 401, `Expected 401 on ${c.method} ${c.url}`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });

  it('rejects missing, malformed, or invalid signatures on /api/recordings/:id/stream', async () => {
    const missingParams = await invokeExpress(app, {
      method: 'GET',
      url: `/api/recordings/${sampleId}/stream`,
    });
    assert.equal(missingParams.status, 401);
    assert.equal(missingParams.body.error.code, 'UNAUTHORIZED');

    const badOrgUuid = await invokeExpress(app, {
      method: 'GET',
      url: `/api/recordings/${sampleId}/stream?org=not-a-uuid&exp=9999999999&sig=deadbeef`,
    });
    assert.equal(badOrgUuid.status, 400);
    assert.equal(badOrgUuid.body.error.code, 'VALIDATION_ERROR');

    const invalidSig = await invokeExpress(app, {
      method: 'GET',
      url: `/api/recordings/${sampleId}/stream?org=${sampleOrgId}&exp=9999999999&sig=${'a'.repeat(64)}`,
    });
    assert.equal(invalidSig.status, 401);
    assert.equal(invalidSig.body.error.code, 'UNAUTHORIZED');
  });

  it('protects /api/internal/* endpoints with X-API-Key and validates callback payloads', async () => {
    const missingKeyFile = await invokeExpress(app, {
      method: 'GET',
      url: `/api/internal/recordings/${sampleId}/file`,
    });
    assert.equal(missingKeyFile.status, 401);
    assert.equal(missingKeyFile.body.error.code, 'UNAUTHORIZED');

    const wrongKeyCallback = await invokeExpress(app, {
      method: 'POST',
      url: '/api/internal/transcription-callback',
      headers: { 'x-api-key': 'wrong-internal-key' },
      body: { meetingId: sampleId, organizationId: sampleOrgId, status: 'processing' },
    });
    assert.equal(wrongKeyCallback.status, 401);
    assert.equal(wrongKeyCallback.body.error.code, 'UNAUTHORIZED');

    const validKeyBadPayload = await invokeExpress(app, {
      method: 'POST',
      url: '/api/internal/transcription-callback',
      headers: { 'x-api-key': env.ai.apiKey },
      body: { meetingId: 'bad-uuid', organizationId: sampleOrgId, status: 'processing' },
    });
    assert.equal(validKeyBadPayload.status, 400);
    assert.equal(validKeyBadPayload.body.error.code, 'VALIDATION_ERROR');
  });
});

