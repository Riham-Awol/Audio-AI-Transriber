import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { ragService } from '../src/services/ragService.js';

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

describe('Phase 5 — Semantic Knowledge & AI Assistant (RAG Pipeline)', () => {
  const app = createApp();

  describe('ragService Grounded Assistant', () => {
    it('answers queries grounded in meeting decisions when decisions context is present', async () => {
      const response = await ragService.generateChatResponse({
        organizationId: 'org-test-1',
        meetingId: 'meet-test-1',
        query: 'What were the decisions agreed upon in this meeting?',
        meetingContext: {
          title: 'Product Roadmap Q3',
          decisions: [
            { description: 'We will migrate to ChromaDB for vector retrieval', status: 'approved' },
            { description: 'WhisperX large-v3 will run on batch size 8', status: 'approved' },
          ],
        },
      });

      assert.ok(response.answer.includes('ChromaDB'));
      assert.ok(response.answer.includes('WhisperX'));
      assert.strictEqual(response.modelName, 'voxameet-rag-local');
    });

    it('answers queries grounded in action items with assignee details', async () => {
      const response = await ragService.generateChatResponse({
        organizationId: 'org-test-1',
        meetingId: 'meet-test-1',
        query: 'What are the action items and tasks assigned to people?',
        meetingContext: {
          title: 'Sprint Planning',
          actionItems: [
            { title: 'Provision Redis queue server', assigneeName: 'Sarah', priority: 'high' },
            { title: 'Review PR for Next.js transcript sync', assigneeName: 'Alex', priority: 'medium' },
          ],
        },
      });

      assert.ok(response.answer.includes('Provision Redis queue server'));
      assert.ok(response.answer.includes('Sarah'));
      assert.ok(response.answer.includes('Alex'));
    });

    it('returns grounded refusal when information is completely absent from transcript', async () => {
      const response = await ragService.generateChatResponse({
        organizationId: 'org-empty',
        meetingId: 'meet-empty',
        query: 'What was the discussion about quantum computer manufacturing in Antarctica?',
        meetingContext: null,
      });

      assert.ok(
        response.answer.includes('no discussions or statements') ||
          response.answer.includes('not discussed')
      );
      assert.strictEqual(response.citations.length, 0);
    });

    it('validates empty query handling gracefully', async () => {
      const response = await ragService.generateChatResponse({
        organizationId: 'org-test',
        meetingId: 'meet-test',
        query: '   ',
      });

      assert.ok(response.answer.length > 0);
      assert.strictEqual(response.citations.length, 0);
    });
  });

  describe('Assistant & Meeting Chat Route Guards', () => {
    it('rejects unauthenticated requests to /api/assistant/sessions with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/assistant/sessions',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/assistant/chat with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'POST',
        url: '/api/assistant/chat',
        body: { message: 'Hello AI' },
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated requests to /api/assistant/search with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/assistant/search?q=roadmap',
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects unauthenticated meeting chat requests to /api/meetings/:id/chat with 401', async () => {
      const res = await invokeExpress(app, {
        method: 'POST',
        url: '/api/meetings/00000000-0000-0000-0000-000000000001/chat',
        body: { message: 'What was discussed?' },
      });
      assert.strictEqual(res.status, 401);
    });

    it('rejects invalid meeting UUID on chat endpoints with 400', async () => {
      const res = await invokeExpress(app, {
        method: 'GET',
        url: '/api/meetings/not-a-valid-uuid/chat/history',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });
      assert.strictEqual(res.status, 401);
    });
  });
});

