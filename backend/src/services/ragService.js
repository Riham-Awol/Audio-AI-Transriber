import crypto from 'node:crypto';
import { query, queryOne } from '../config/database.js';
import { env } from '../config/env.js';

function formatMsToTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const ragService = {
  /**
   * Index meeting transcript segments into the organization's vector store
   */
  async indexMeetingTranscript(organizationId, meetingId) {
    const segments = await query(
      `SELECT ts.id, ts.sequence_index AS sequenceIndex, ts.start_ms AS startMs, ts.end_ms AS endMs,
              ts.text, COALESCE(s.display_name, 'Speaker') AS speakerName,
              m.title AS meetingTitle
       FROM transcript_segments ts
       INNER JOIN meetings m ON m.id = ts.meeting_id
       LEFT JOIN speakers s ON s.id = ts.speaker_id
       WHERE ts.organization_id = ? AND ts.meeting_id = ?
       ORDER BY ts.sequence_index ASC`,
      [organizationId, meetingId]
    );

    if (!segments || segments.length === 0) {
      return { indexed: false, chunkCount: 0, reason: 'No transcript segments found.' };
    }

    const meetingTitle = segments[0]?.meetingTitle || '';

    // 1. Try sending to Python AI service vector store
    let aiServiceIndexed = false;
    try {
      const response = await fetch(`${env.ai.serviceUrl}/rag/index`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.ai.apiKey,
        },
        body: JSON.stringify({
          organizationId,
          meetingId,
          meetingTitle,
          segments,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        aiServiceIndexed = true;
      }
    } catch {
      // AI service offline; local SQL search acts as fallback
      aiServiceIndexed = false;
    }

    // 2. Mark transcript as indexed in database
    await query(
      `UPDATE transcripts
       SET vector_indexed = 1, vector_indexed_at = NOW()
       WHERE organization_id = ? AND meeting_id = ?`,
      [organizationId, meetingId]
    );

    return {
      indexed: true,
      chunkCount: segments.length,
      aiServiceIndexed,
    };
  },

  /**
   * Semantic / keyword search across transcript segments
   */
  async searchTranscriptChunks(
    organizationId,
    queryStr,
    { meetingId = null, meetingIds = null, dateFrom = null, dateTo = null, limit = 5 } = {}
  ) {
    const cleanQuery = String(queryStr || '').trim();
    if (!cleanQuery) return [];

    // 1. Try AI service similarity search first
    if (!meetingIds && !dateFrom && !dateTo) {
      try {
        const response = await fetch(`${env.ai.serviceUrl}/rag/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.ai.apiKey,
          },
          body: JSON.stringify({
            organizationId,
            meetingId: meetingId || null,
            query: cleanQuery,
            topK: limit,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.results) && data.results.length > 0) {
            return data.results;
          }
        }
      } catch {
        // Fall back to database query
      }
    }

    // 2. Resilient Database Fulltext & Pattern Search Fallback
    const sqlParams = [organizationId];
    const whereConditions = [
      'ts.organization_id = ?',
      'm.deleted_at IS NULL',
    ];

    if (meetingId) {
      whereConditions.push('ts.meeting_id = ?');
      sqlParams.push(meetingId);
    } else if (Array.isArray(meetingIds) && meetingIds.length > 0) {
      const placeholders = meetingIds.map(() => '?').join(',');
      whereConditions.push(`ts.meeting_id IN (${placeholders})`);
      sqlParams.push(...meetingIds);
    }

    if (dateFrom) {
      whereConditions.push('COALESCE(m.scheduled_at, m.created_at) >= ?');
      sqlParams.push(dateFrom);
    }
    if (dateTo) {
      whereConditions.push('COALESCE(m.scheduled_at, m.created_at) <= ?');
      sqlParams.push(dateTo);
    }

    // Text matching
    const searchPattern = `%${cleanQuery}%`;
    whereConditions.push('(ts.text LIKE ? OR MATCH(ts.text) AGAINST(? IN NATURAL LANGUAGE MODE))');
    sqlParams.push(searchPattern, cleanQuery);

    sqlParams.push(Math.min(limit, 20));

    let rows = [];
    try {
      rows = await query(
        `SELECT ts.id, ts.meeting_id AS meetingId, ts.start_ms AS startMs, ts.end_ms AS endMs,
                ts.text, m.title AS meetingTitle,
                COALESCE(s.display_name, 'Speaker') AS speakerName
         FROM transcript_segments ts
         INNER JOIN meetings m ON m.id = ts.meeting_id
         LEFT JOIN speakers s ON s.id = ts.speaker_id
         WHERE ${whereConditions.join(' AND ')}
         ORDER BY ts.start_ms ASC
         LIMIT ?`,
        sqlParams
      );
    } catch {
      // Database connection error (e.g., offline or sandbox test environment)
      rows = [];
    }

    return (rows || []).map((r, idx) => ({
      id: r.id,
      text: r.text,
      score: Math.max(0.6, 0.95 - idx * 0.05),
      metadata: {
        segmentId: r.id,
        meetingId: r.meetingId,
        meetingTitle: r.meetingTitle,
        speakerName: r.speakerName,
        startMs: Number(r.startMs || 0),
        endMs: Number(r.endMs || 0),
      },
    }));
  },

  /**
   * Generate grounded chat response with citations & audio timestamps
   */
  async generateChatResponse({
    organizationId,
    meetingId = null,
    query: userQuery,
    history = [],
    meetingContext = null,
    meetingIds = null,
    dateFrom = null,
    dateTo = null,
  }) {
    const cleanQuery = String(userQuery || '').trim();
    if (!cleanQuery) {
      return {
        answer: 'Please provide a question about your meeting or topics discussed.',
        citations: [],
        modelName: 'voxameet-rag',
      };
    }

    // 1. Attempt AI Microservice RAG call
    try {
      const response = await fetch(`${env.ai.serviceUrl}/rag/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.ai.apiKey,
        },
        body: JSON.stringify({
          organizationId,
          meetingId: meetingId || null,
          query: cleanQuery,
          history: history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
          meetingContext,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.answer) {
          return {
            answer: data.answer,
            citations: data.citations || [],
            modelName: data.modelName || 'qwen2.5:7b',
          };
        }
      }
    } catch {
      // Offline or error: fallback to local deterministic grounded synthesis
    }

    // 2. Fetch relevant chunks from database / local search
    const chunks = await this.searchTranscriptChunks(organizationId, cleanQuery, {
      meetingId,
      meetingIds,
      dateFrom,
      dateTo,
      limit: 5,
    });

    const citations = chunks.map((c) => {
      const meta = c.metadata || {};
      return {
        segmentId: meta.segmentId || c.id,
        meetingId: meta.meetingId || meetingId || '',
        meetingTitle: meta.meetingTitle || '',
        speakerName: meta.speakerName || 'Speaker',
        startMs: Number(meta.startMs || 0),
        endMs: Number(meta.endMs || 0),
        quote: (c.text || '').slice(0, 300),
      };
    });

    // 3. Fallback grounded synthesizer
    const qLower = cleanQuery.toLowerCase();

    // Decisions inquiry
    if (qLower.includes('decision') || qLower.includes('agreed') || qLower.includes('conclude')) {
      if (meetingContext?.decisions?.length > 0) {
        let ans = 'Here are the key decisions recorded for this meeting:\n\n';
        for (const d of meetingContext.decisions) {
          ans += `- **${d.description}** (Status: *${d.status || 'approved'}*)\n`;
        }
        return {
          answer: ans,
          citations,
          modelName: 'voxameet-rag-local',
        };
      }
    }

    // Action items inquiry
    if (
      qLower.includes('action') ||
      qLower.includes('task') ||
      (qLower.includes('who') && qLower.includes('assigned'))
    ) {
      if (meetingContext?.actionItems?.length > 0) {
        let ans = 'Here are the assigned action items:\n\n';
        for (const a of meetingContext.actionItems) {
          const assignee = a.assigneeName || 'Unassigned';
          ans += `- **${a.title}** — assigned to *${assignee}* (Priority: ${a.priority || 'medium'})\n`;
        }
        return {
          answer: ans,
          citations,
          modelName: 'voxameet-rag-local',
        };
      }
    }

    // Summary inquiry
    if (qLower.includes('summary') || qLower.includes('overview') || qLower.includes('recap')) {
      if (meetingContext?.executiveSummary) {
        return {
          answer: `**Executive Summary:**\n\n${meetingContext.executiveSummary}`,
          citations,
          modelName: 'voxameet-rag-local',
        };
      }
    }

    // If no matching transcript chunks found
    if (chunks.length === 0) {
      return {
        answer:
          `Based on the meeting transcript(s), no discussions or statements regarding **"${cleanQuery}"** were found. ` +
          `Please check that the audio has been transcribed or try searching with alternative keywords.`,
        citations: [],
        modelName: 'voxameet-rag-local',
      };
    }

    // Format transcript excerpt response
    const lines = [
      `Based on the meeting transcript excerpts regarding **"${cleanQuery}"**:\n`,
    ];

    for (const chunk of chunks.slice(0, 4)) {
      const meta = chunk.metadata || {};
      const speaker = meta.speakerName || 'Speaker';
      const ts = formatMsToTime(meta.startMs || 0);
      const meet = meta.meetingTitle ? ` in *${meta.meetingTitle}*` : '';
      lines.push(`• **${speaker}** (${ts}${meet}): "${(chunk.text || '').trim()}"`);
    }

    lines.push('\n*Click on any citation pill below to seek the recording directly to that timestamp.*');

    return {
      answer: lines.join('\n'),
      citations,
      modelName: 'voxameet-rag-local',
    };
  },
};
