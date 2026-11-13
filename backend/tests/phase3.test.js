import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import {
  generateDocx,
  generatePdf,
  generatePlainText,
} from '../src/services/exportService.js';

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
        resolve({ status: this.statusCode, headers: resHeaders, body: json, text: raw, rawBuffer: Buffer.concat(chunks) });
      },
    });

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

describe('Phase 3 — Export Service (Text, DOCX & PDF Generation)', () => {
  const sampleMeeting = {
    title: 'Product Strategy Review',
    scheduledAt: '2026-11-12T10:00:00.000Z',
    durationSeconds: 1850,
    meetingType: 'online',
    recordingSource: 'upload',
  };

  const sampleSummary = {
    executiveSummary: 'Reviewed Q4 product roadmap and finalized AI transcription features.',
    meetingPurpose: 'Align on launch deliverables and responsibilities.',
  };

  const sampleDecisions = [
    { description: 'Ship WhisperX with forced word alignment.', speakerName: 'Sarah Connor' },
  ];

  const sampleActionItems = [
    { title: 'Update HuggingFace token in documentation', assigneeName: 'John Doe', status: 'pending', priority: 'high', dueDate: '2026-11-20' },
  ];

  const sampleSegments = [
    { sequenceIndex: 1, startMs: 0, endMs: 4200, text: 'Welcome everyone to the strategy session.', speakerName: 'Sarah Connor' },
    { sequenceIndex: 2, startMs: 4300, endMs: 8500, text: 'Thanks Sarah. Lets review the roadmap.', speakerName: 'John Doe' },
  ];

  const sampleSpeakers = [
    { speakerKey: 'SPEAKER_00', displayName: 'Sarah Connor', colorHex: '#762F48' },
    { speakerKey: 'SPEAKER_01', displayName: 'John Doe', colorHex: '#17243C' },
  ];

  it('generates well-formatted plain text meeting reports with customizable options', () => {
    const fullText = generatePlainText({
      meeting: sampleMeeting,
      summary: sampleSummary,
      decisions: sampleDecisions,
      actionItems: sampleActionItems,
      segments: sampleSegments,
      speakers: sampleSpeakers,
      includeTimestamps: true,
      includeSpeakers: true,
      exportType: 'full_report',
    });

    assert.ok(fullText.includes('VOXAMEET AI — MEETING REPORT: Product Strategy Review'));
    assert.ok(fullText.includes('EXECUTIVE SUMMARY'));
    assert.ok(fullText.includes('Reviewed Q4 product roadmap'));
    assert.ok(fullText.includes('DECISIONS MADE'));
    assert.ok(fullText.includes('Ship WhisperX with forced word alignment'));
    assert.ok(fullText.includes('ACTION ITEMS & RESPONSIBILITIES'));
    assert.ok(fullText.includes('Update HuggingFace token in documentation'));
    assert.ok(fullText.includes('[00:00 - 00:04] Sarah Connor: Welcome everyone'));
  });

  it('generates binary DOCX documents with valid PK ZIP headers', async () => {
    const docxBuffer = await generateDocx({
      meeting: sampleMeeting,
      summary: sampleSummary,
      decisions: sampleDecisions,
      actionItems: sampleActionItems,
      segments: sampleSegments,
      speakers: sampleSpeakers,
      includeTimestamps: true,
      includeSpeakers: true,
      exportType: 'full_report',
    });

    assert.ok(Buffer.isBuffer(docxBuffer));
    assert.ok(docxBuffer.length > 500);
    // Standard DOCX is a zip archive starting with PK (0x50, 0x4B)
    assert.equal(docxBuffer[0], 0x50);
    assert.equal(docxBuffer[1], 0x4b);
  });

  it('generates binary PDF documents with valid %PDF- magic headers', async () => {
    const pdfBuffer = await generatePdf({
      meeting: sampleMeeting,
      summary: sampleSummary,
      decisions: sampleDecisions,
      actionItems: sampleActionItems,
      segments: sampleSegments,
      speakers: sampleSpeakers,
      includeTimestamps: true,
      includeSpeakers: true,
      exportType: 'full_report',
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 500);
    const header = pdfBuffer.slice(0, 5).toString('ascii');
    assert.equal(header, '%PDF-');
  });
});

describe('Phase 3 — Express Route Guards & Transcript API Endpoints', () => {
  const app = createApp();
  const sampleId = '11111111-1111-1111-1111-111111111111';
  const sampleSegId = '22222222-2222-2222-2222-222222222222';

  it('rejects unauthenticated requests to Phase 3 endpoints with 401', async () => {
    const endpoints = [
      { method: 'GET', url: `/api/meetings/${sampleId}/transcript` },
      { method: 'PATCH', url: `/api/meetings/${sampleId}/transcript/segments/${sampleSegId}` },
      { method: 'POST', url: `/api/meetings/${sampleId}/transcript/segments/${sampleSegId}/split` },
      { method: 'POST', url: `/api/meetings/${sampleId}/transcript/segments/${sampleSegId}/merge-next` },
      { method: 'DELETE', url: `/api/meetings/${sampleId}/transcript/segments/${sampleSegId}` },
      { method: 'PATCH', url: `/api/meetings/${sampleId}/speakers/${sampleId}` },
      { method: 'POST', url: `/api/meetings/${sampleId}/speakers` },
      { method: 'GET', url: `/api/meetings/${sampleId}/export?format=txt` },
    ];

    for (const ep of endpoints) {
      const res = await invokeExpress(app, ep);
      assert.equal(res.status, 401, `Expected 401 on ${ep.method} ${ep.url}`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });

  it('validates UUID parameter shapes on Phase 3 routes', async () => {
    const res = await invokeExpress(app, {
      method: 'GET',
      url: '/api/meetings/not-a-valid-uuid/transcript',
    });
    // Requires auth first
    assert.equal(res.status, 401);
  });
});

