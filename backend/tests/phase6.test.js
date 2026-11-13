import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { calendarService } from '../src/services/calendarService.js';
import {
  decryptToken,
  encryptToken,
  integrationService,
  PROVIDER_REGISTRY,
} from '../src/services/integrationService.js';

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

describe('Phase 6 — Integrations Marketplace & Calendar Sync', () => {
  const app = createApp();

  describe('Integration Token Encryption Vault', () => {
    it('encrypts and decrypts OAuth tokens using authenticated AES-256-GCM', () => {
      const secretOAuthToken = 'ya29.a0AfH6SMB_secret_google_oauth_token_1234567890';
      const encrypted = encryptToken(secretOAuthToken);

      assert.ok(encrypted);
      assert.notStrictEqual(encrypted, secretOAuthToken);
      assert.strictEqual(encrypted.split(':').length, 3); // iv:tag:ciphertext

      const decrypted = decryptToken(encrypted);
      assert.strictEqual(decrypted, secretOAuthToken);
    });

    it('returns null on invalid or tampered cipher text', () => {
      assert.strictEqual(decryptToken(''), null);
      assert.strictEqual(decryptToken('invalid-cipher-string'), null);
      assert.strictEqual(decryptToken('deadbeef:badtag:010203'), null);
    });
  });

  describe('Integration Service Registry & Workflows', () => {
    it('registers all required enterprise providers across categories', () => {
      const expectedProviders = [
        'google_calendar',
        'outlook_calendar',
        'zoom',
        'google_meet',
        'microsoft_teams',
        'slack',
        'jira',
        'google_drive',
        'dropbox',
      ];

      for (const key of expectedProviders) {
        assert.ok(PROVIDER_REGISTRY[key], `Provider ${key} must be defined`);
        assert.ok(PROVIDER_REGISTRY[key].displayName);
        assert.ok(PROVIDER_REGISTRY[key].category);
      }
    });

    it('connects, disconnects, and syncs an integration provider', async () => {
      const orgId = '00000000-0000-0000-0000-000000000001';
      const userId = '00000000-0000-0000-0000-000000000002';

      const connectResult = await integrationService.connectIntegration(
        orgId,
        userId,
        'google_calendar',
        {
          config: { email: 'team@voxameet.com' },
          accessToken: 'test-token',
        }
      );
      assert.strictEqual(connectResult.provider, 'google_calendar');
      assert.strictEqual(connectResult.status, 'connected');

      const syncResult = await integrationService.syncIntegration(orgId, userId, 'google_calendar');
      assert.strictEqual(syncResult.success, true);
      assert.strictEqual(syncResult.provider, 'google_calendar');
      assert.ok(Array.isArray(syncResult.events));

      const disconnectResult = await integrationService.disconnectIntegration(orgId, 'google_calendar');
      assert.strictEqual(disconnectResult.success, true);
    });

    it('exports action item to Jira with generated issue key and URL', async () => {
      const res = await integrationService.exportActionItemToJira(
        'org-1',
        '00000000-0000-0000-0000-000000000001',
        { projectKey: 'ENG' }
      );

      assert.strictEqual(res.success, true);
      assert.ok(res.externalIssueKey.startsWith('ENG-'));
      assert.ok(res.externalIssueUrl.includes(res.externalIssueKey));
    });

    it('formats Slack Block Kit payload with executive summary and action items', async () => {
      const res = await integrationService.shareMeetingToSlack(
        'org-1',
        '00000000-0000-0000-0000-000000000001',
        { channel: '#announcements' }
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.channel, '#announcements');
      assert.ok(res.payload.blocks.length >= 2);
    });
  });

  describe('Calendar Service & Event Lifecycle', () => {
    it('creates manual calendar events with start and end times', async () => {
      const event = await calendarService.createEvent(
        'org-1',
        'user-1',
        {
          title: 'Design Review & UX Alignment',
          description: 'Reviewing Phase 6 Integrations UI',
          startTime: '2026-11-20T10:00:00Z',
          endTime: '2026-11-20T11:00:00Z',
        }
      );

      assert.strictEqual(event.title, 'Design Review & UX Alignment');
      assert.strictEqual(event.provider, 'manual');
      assert.ok(event.id);
    });
  });

  describe('Integrations & Calendar Route Guards', () => {
    it('rejects unauthenticated requests to /api/integrations with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/integrations',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/calendar/events with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/calendar/events',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/calendar/sync with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'POST',
        url: '/api/calendar/sync',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/action-items/:id/export-jira with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'POST',
        url: '/api/action-items/00000000-0000-0000-0000-000000000001/export-jira',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/meetings/:id/share-slack with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'POST',
        url: '/api/meetings/00000000-0000-0000-0000-000000000001/share-slack',
      });
      assert.strictEqual(res.status, 401);
    });
  });
});
