import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { generateHeuristicSummary } from '../src/services/summaryService.js';

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

describe('Phase 4 — Summarization & Intelligence Service', () => {
  const sampleTranscript = `
Sarah Connor: Welcome to our Q4 Architecture Review.
John Doe: We agreed to ship the WhisperX forced alignment next week.
Sarah Connor: Great. That is an action item. John will handle deployment by Friday.
Alex Vance: We decided to deploy the Python worker on dedicated compute.
  `;

  const sampleSegments = [
    { startMs: 0, endMs: 3000, text: 'Welcome to our Q4 Architecture Review.', speakerName: 'Sarah Connor' },
    { startMs: 3200, endMs: 7000, text: 'We agreed to ship the WhisperX forced alignment next week.', speakerName: 'John Doe' },
    { startMs: 7200, endMs: 12000, text: 'Great. That is an action item. John will handle deployment by Friday.', speakerName: 'Sarah Connor' },
    { startMs: 12500, endMs: 16000, text: 'We decided to deploy the Python worker on dedicated compute.', speakerName: 'Alex Vance' },
  ];

  it('generates multi-section standard summaries with extracted decisions and action items', () => {
    const summary = generateHeuristicSummary({
      meetingTitle: 'Q4 Architecture Review',
      transcriptText: sampleTranscript,
      detailLevel: 'standard',
      speakers: [{ displayName: 'Sarah Connor' }, { displayName: 'John Doe' }, { displayName: 'Alex Vance' }],
      segments: sampleSegments,
    });

    assert.ok(summary.executiveSummary.includes('Q4 Architecture Review'));
    assert.ok(summary.meetingPurpose.length > 5);
    assert.ok(Array.isArray(summary.mainTopics) && summary.mainTopics.length > 0);
    assert.ok(Array.isArray(summary.discussionPoints) && summary.discussionPoints.length > 0);
    assert.ok(Array.isArray(summary.decisions) && summary.decisions.length >= 2);
    assert.ok(Array.isArray(summary.actionItems) && summary.actionItems.length >= 1);
    assert.ok(summary.minutesMarkdown.includes('# Meeting Minutes'));
  });

  it('adapts executive summary length to short, standard, and detailed modes', () => {
    const shortSummary = generateHeuristicSummary({
      meetingTitle: 'Short Standup',
      transcriptText: sampleTranscript,
      detailLevel: 'short',
      speakers: [],
      segments: sampleSegments,
    });
    const detailedSummary = generateHeuristicSummary({
      meetingTitle: 'Detailed Strategy',
      transcriptText: sampleTranscript,
      detailLevel: 'detailed',
      speakers: [],
      segments: sampleSegments,
    });

    assert.ok(shortSummary.executiveSummary.length < detailedSummary.executiveSummary.length);
  });
});

describe('Phase 4 — Summary, Decisions & Action Items Route Guards', () => {
  const app = createApp();
  const sampleId = '11111111-1111-1111-1111-111111111111';
  const sampleItemId = '22222222-2222-2222-2222-222222222222';

  it('rejects unauthenticated requests to summary and decisions endpoints with 401', async () => {
    const endpoints = [
      { method: 'GET', url: `/api/meetings/${sampleId}/summary` },
      { method: 'POST', url: `/api/meetings/${sampleId}/summary/generate` },
      { method: 'PATCH', url: `/api/meetings/${sampleId}/summary` },
      { method: 'GET', url: `/api/meetings/${sampleId}/decisions` },
      { method: 'POST', url: `/api/meetings/${sampleId}/decisions` },
      { method: 'PATCH', url: `/api/meetings/${sampleId}/decisions/${sampleItemId}` },
      { method: 'DELETE', url: `/api/meetings/${sampleId}/decisions/${sampleItemId}` },
      { method: 'GET', url: `/api/meetings/${sampleId}/action-items` },
      { method: 'POST', url: `/api/meetings/${sampleId}/action-items` },
      { method: 'PATCH', url: `/api/meetings/${sampleId}/action-items/${sampleItemId}` },
      { method: 'DELETE', url: `/api/meetings/${sampleId}/action-items/${sampleItemId}` },
    ];

    for (const ep of endpoints) {
      const res = await invokeExpress(app, ep);
      assert.equal(res.status, 401, `Expected 401 on ${ep.method} ${ep.url}`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });

  it('protects internal summary callback with timing-safe X-API-Key', async () => {
    const missingKey = await invokeExpress(app, {
      method: 'POST',
      url: '/api/internal/summary-callback',
      body: { meetingId: sampleId, organizationId: sampleId },
    });
    assert.equal(missingKey.status, 401);

    const wrongKey = await invokeExpress(app, {
      method: 'POST',
      url: '/api/internal/summary-callback',
      headers: { 'x-api-key': 'bad-key' },
      body: { meetingId: sampleId, organizationId: sampleId },
    });
    assert.equal(wrongKey.status, 401);
  });
});

