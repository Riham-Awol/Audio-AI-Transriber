import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';

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

describe('Phase 7 — Advanced Reports, Analytics & Audit Logging', () => {
  const app = createApp();

  describe('Reports & Analytics Route Guards', () => {
    it('rejects unauthenticated requests to /api/reports/analytics with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/reports/analytics',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/reports/audit-logs with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/reports/audit-logs',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/reports/export with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/reports/export?type=action_items',
      });
      assert.strictEqual(res.status, 401);
    });
  });
});
