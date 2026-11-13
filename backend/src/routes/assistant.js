import crypto from 'node:crypto';
import { Router } from 'express';
import { query, queryOne, withTransaction } from '../config/database.js';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ragService } from '../services/ragService.js';

const router = Router();

router.use(requireAuth);
router.use(requireOrganization);

/**
 * GET /api/assistant/sessions - List global assistant sessions
 */
router.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const sessions = await query(
      `SELECT id, title, scope_type AS scopeType, scope_meeting_ids AS scopeMeetingIds,
              created_at AS createdAt, updated_at AS updatedAt
       FROM chat_sessions
       WHERE organization_id = ? AND user_id = ? AND scope_type IN ('organization', 'multi_meeting')
       ORDER BY updated_at DESC`,
      [req.organization.id, req.user.id]
    );

    res.json({
      sessions: sessions.map((s) => ({
        ...s,
        scopeMeetingIds: typeof s.scopeMeetingIds === 'string' ? JSON.parse(s.scopeMeetingIds) : (s.scopeMeetingIds || []),
      })),
    });
  })
);

/**
 * POST /api/assistant/sessions - Create a new chat session
 */
router.post(
  '/sessions',
  asyncHandler(async (req, res) => {
    const title = String(req.body.title || 'New AI Assistant Chat').trim().slice(0, 255);
    const scopeType = req.body.scopeType === 'multi_meeting' ? 'multi_meeting' : 'organization';
    const scopeMeetingIds = Array.isArray(req.body.scopeMeetingIds) ? req.body.scopeMeetingIds : [];

    const sessionId = crypto.randomUUID();

    await query(
      `INSERT INTO chat_sessions (id, organization_id, user_id, meeting_id, scope_type, scope_meeting_ids, title)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      [
        sessionId,
        req.organization.id,
        req.user.id,
        scopeType,
        JSON.stringify(scopeMeetingIds),
        title,
      ]
    );

    res.status(201).json({
      session: {
        id: sessionId,
        title,
        scopeType,
        scopeMeetingIds,
      },
    });
  })
);

/**
 * GET /api/assistant/sessions/:sessionId - Get chat session & message history
 */
router.get(
  '/sessions/:sessionId',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await queryOne(
      `SELECT id, title, scope_type AS scopeType, scope_meeting_ids AS scopeMeetingIds,
              created_at AS createdAt, updated_at AS updatedAt
       FROM chat_sessions
       WHERE id = ? AND organization_id = ? AND user_id = ?`,
      [sessionId, req.organization.id, req.user.id]
    );

    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chat session not found.' } });
    }

    const messages = await query(
      `SELECT id, role, content, citations, model_name AS modelName, created_at AS createdAt
       FROM chat_messages
       WHERE session_id = ? AND organization_id = ?
       ORDER BY created_at ASC`,
      [sessionId, req.organization.id]
    );

    res.json({
      session: {
        ...session,
        scopeMeetingIds: typeof session.scopeMeetingIds === 'string' ? JSON.parse(session.scopeMeetingIds) : (session.scopeMeetingIds || []),
      },
      messages: messages.map((m) => ({
        ...m,
        citations: typeof m.citations === 'string' ? JSON.parse(m.citations) : (m.citations || []),
      })),
    });
  })
);

/**
 * DELETE /api/assistant/sessions/:sessionId - Delete chat session
 */
router.delete(
  '/sessions/:sessionId',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const result = await query(
      `DELETE FROM chat_sessions
       WHERE id = ? AND organization_id = ? AND user_id = ?`,
      [sessionId, req.organization.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Chat session not found.' } });
    }

    res.json({ success: true, sessionId });
  })
);

/**
 * POST /api/assistant/chat - Cross-meeting Global AI Assistant conversation
 */
router.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const messageText = String(req.body.message || '').trim();
    if (!messageText) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Message cannot be empty.' } });
    }

    let sessionId = req.body.sessionId;
    const meetingIds = Array.isArray(req.body.meetingIds) ? req.body.meetingIds : null;
    const dateFrom = req.body.dateFrom || null;
    const dateTo = req.body.dateTo || null;

    let session = null;
    if (sessionId) {
      session = await queryOne(
        `SELECT id, title, scope_type AS scopeType
         FROM chat_sessions
         WHERE id = ? AND organization_id = ? AND user_id = ?`,
        [sessionId, req.organization.id, req.user.id]
      );
    }

    // Auto-create session if not provided or not found
    if (!session) {
      sessionId = crypto.randomUUID();
      const generatedTitle = messageText.slice(0, 50) + (messageText.length > 50 ? '...' : '');
      const scopeType = meetingIds && meetingIds.length ? 'multi_meeting' : 'organization';

      await query(
        `INSERT INTO chat_sessions (id, organization_id, user_id, meeting_id, scope_type, scope_meeting_ids, title)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        [
          sessionId,
          req.organization.id,
          req.user.id,
          scopeType,
          JSON.stringify(meetingIds || []),
          generatedTitle,
        ]
      );
    }

    // Insert user message
    const userMsgId = crypto.randomUUID();
    await query(
      `INSERT INTO chat_messages (id, organization_id, session_id, role, content)
       VALUES (?, ?, ?, 'user', ?)`,
      [userMsgId, req.organization.id, sessionId, messageText]
    );

    // Retrieve recent conversation history
    const pastMessages = await query(
      `SELECT role, content
       FROM chat_messages
       WHERE session_id = ? AND organization_id = ?
       ORDER BY created_at ASC
       LIMIT 10`,
      [sessionId, req.organization.id]
    );

    // Generate grounded RAG response across organization meetings
    const ragResponse = await ragService.generateChatResponse({
      organizationId: req.organization.id,
      query: messageText,
      history: pastMessages,
      meetingIds,
      dateFrom,
      dateTo,
    });

    // Insert assistant message
    const assistantMsgId = crypto.randomUUID();
    await query(
      `INSERT INTO chat_messages (id, organization_id, session_id, role, content, citations, model_name)
       VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
      [
        assistantMsgId,
        req.organization.id,
        sessionId,
        ragResponse.answer,
        JSON.stringify(ragResponse.citations || []),
        ragResponse.modelName || 'qwen2.5:7b',
      ]
    );

    // Update session timestamp
    await query(
      `UPDATE chat_sessions SET updated_at = NOW() WHERE id = ? AND organization_id = ?`,
      [sessionId, req.organization.id]
    );

    res.json({
      sessionId,
      message: {
        id: assistantMsgId,
        role: 'assistant',
        content: ragResponse.answer,
        citations: ragResponse.citations || [],
        modelName: ragResponse.modelName,
        createdAt: new Date().toISOString(),
      },
      citations: ragResponse.citations || [],
    });
  })
);

/**
 * GET /api/assistant/search - Cross-meeting semantic search across transcripts
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const rawQuery = String(req.query.q || '').trim();
    if (rawQuery.length < 2) {
      return res.json({ results: [] });
    }

    const meetingId = req.query.meetingId || null;
    const limit = Math.min(Number(req.query.limit) || 10, 30);

    const results = await ragService.searchTranscriptChunks(req.organization.id, rawQuery, {
      meetingId,
      limit,
    });

    res.json({
      query: rawQuery,
      results,
    });
  })
);

export default router;

