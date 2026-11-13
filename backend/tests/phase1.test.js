import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import {
  assertEnum,
  assertValidUuid,
  isValidEmail,
  parsePagination,
  validatePassword,
} from '../src/middleware/validate.js';
import {
  createOrganizationSlug,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/services/tokenService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 1 — Token & Security Services', () => {
  it('generates opaque tokens and deterministic SHA-256 digests', () => {
    const tokenA = generateOpaqueToken(16);
    const tokenB = generateOpaqueToken(16);
    assert.equal(tokenA.length, 32);
    assert.notEqual(tokenA, tokenB);
    assert.equal(hashToken(tokenA), hashToken(tokenA));
    assert.equal(hashToken(tokenA).length, 64);
  });

  it('signs and verifies access and refresh JWTs', () => {
    const access = signAccessToken({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'alex@acme.test',
      is_super_admin: 0,
    });
    const decodedAccess = verifyAccessToken(access);
    assert.equal(decodedAccess.sub, '11111111-1111-1111-1111-111111111111');
    assert.equal(decodedAccess.email, 'alex@acme.test');
    assert.equal(decodedAccess.isSuperAdmin, false);

    const refresh = signRefreshToken(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222'
    );
    const decodedRefresh = verifyRefreshToken(refresh);
    assert.equal(decodedRefresh.sid, '22222222-2222-2222-2222-222222222222');
    assert.equal(decodedRefresh.type, 'refresh');
  });

  it('creates clean URL-safe organization slugs', () => {
    const slug = createOrganizationSlug('Acme Global & AI Lab!');
    assert.match(slug, /^acme-global-ai-lab-[a-f0-9]{6}$/);
  });
});

describe('Phase 1 — Validation Middleware Helpers', () => {
  it('validates email formats and password complexity', () => {
    assert.equal(isValidEmail('user@example.com'), true);
    assert.equal(isValidEmail('invalid-email'), false);

    assert.ok(validatePassword('short'));
    assert.ok(validatePassword('alllowercase1'));
    assert.ok(validatePassword('NoNumbersHere'));
    assert.equal(validatePassword('StrongPass123!'), null);
  });

  it('validates UUIDs, enums, and pagination clamping', () => {
    assert.equal(
      assertValidUuid('123e4567-e89b-12d3-a456-426614174000'),
      '123e4567-e89b-12d3-a456-426614174000'
    );
    assert.throws(() => assertValidUuid('not-a-uuid'));
    assert.equal(assertEnum('online', ['in_person', 'online'], 'meetingType'), 'online');
    assert.throws(() => assertEnum('invalid', ['in_person', 'online'], 'meetingType'));

    const pageInfo = parsePagination({ page: '2', limit: '250' });
    assert.equal(pageInfo.page, 2);
    assert.equal(pageInfo.limit, 100);
    assert.equal(pageInfo.offset, 100);
  });
});

describe('Phase 1 — MySQL Schema Completeness', () => {
  it('includes all 19 required domain tables plus session/invite/share tables', async () => {
    const schemaPath = path.resolve(__dirname, '../src/db/migrations/001_initial_schema.sql');
    const sql = await fs.readFile(schemaPath, 'utf8');

    const requiredTables = [
      'users',
      'user_sessions',
      'organizations',
      'organization_members',
      'organization_invitations',
      'meetings',
      'meeting_shares',
      'recordings',
      'speakers',
      'transcripts',
      'transcript_segments',
      'meeting_summaries',
      'meeting_decisions',
      'meeting_action_items',
      'meeting_notes',
      'chat_sessions',
      'chat_messages',
      'integrations',
      'integration_tokens',
      'calendar_events',
      'notifications',
      'audit_logs',
    ];

    for (const table of requiredTables) {
      assert.match(
        sql,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
        `Missing required table: ${table}`
      );
    }
  });
});

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

describe('Phase 1 — Express HTTP Security & Route Guards', () => {
  const app = createApp();

  it('rejects unauthenticated access to protected endpoints with 401', async () => {
    for (const endpoint of ['/api/dashboard/overview', '/api/meetings', '/api/organizations', '/api/auth/me']) {
      const res = await invokeExpress(app, { method: 'GET', url: endpoint });
      assert.equal(res.status, 401, `Expected 401 on ${endpoint}`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });

  it('rejects malformed registration requests with 400 validation errors', async () => {
    const res = await invokeExpress(app, {
      method: 'POST',
      url: '/api/auth/register',
      body: { email: 'bad', password: '123', fullName: 'A' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('returns structured 404 JSON on unknown routes', async () => {
    const res = await invokeExpress(app, { method: 'GET', url: '/api/non-existent-endpoint' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
