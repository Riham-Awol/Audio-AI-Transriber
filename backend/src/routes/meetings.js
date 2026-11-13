import crypto from 'node:crypto';
import { Router } from 'express';
import { query, queryOne, withTransaction } from '../config/database.js';
import { requireAuth, requireOrganization, requireRole } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertEnum, assertValidUuid, parsePagination } from '../middleware/validate.js';
import { recordAuditLog } from '../services/auditService.js';
import { generateDocx, generatePdf, generatePlainText } from '../services/exportService.js';

const router = Router();

const MEETING_TYPES = ['in_person', 'online', 'hybrid', 'imported'];
const RECORDING_SOURCES = [
  'microphone',
  'browser_tab',
  'upload',
  'zoom',
  'google_meet',
  'microsoft_teams',
  'scheduled',
];
const MEETING_STATUSES = [
  'scheduled',
  'recording',
  'uploading',
  'queued',
  'processing',
  'completed',
  'failed',
  'archived',
];

function formatMeetingRow(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdBy: row.created_by,
    creatorName: row.creator_name || null,
    title: row.title,
    description: row.description || '',
    meetingType: row.meeting_type,
    recordingSource: row.recording_source,
    status: row.status,
    processingProgress: Number(row.processing_progress || 0),
    processingError: row.processing_error || null,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: Number(row.duration_seconds || 0),
    speakerCount: Number(row.speaker_count || 0),
    hasTranscript: Boolean(row.has_transcript),
    hasSummary: Boolean(row.has_summary),
    languageCode: row.language_code || 'en',
    customVocabulary: row.custom_vocabulary || [],
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emitOrgEvent(req, eventName, payload) {
  const io = req.app.get('io');
  if (io) {
    io.to(`org:${req.organization.id}`).emit(eventName, payload);
  }
}

router.get(
  '/',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const {
      search,
      status,
      meetingType,
      recordingSource,
      dateFrom,
      dateTo,
      includeArchived = 'false',
    } = req.query;

    const conditions = ['m.organization_id = ?', 'm.deleted_at IS NULL'];
    const params = [req.organization.id];

    if (includeArchived !== 'true') {
      conditions.push('m.is_archived = 0');
    }
    if (search && String(search).trim()) {
      conditions.push('(m.title LIKE ? OR m.description LIKE ?)');
      const term = `%${String(search).trim()}%`;
      params.push(term, term);
    }
    if (status && status !== 'all') {
      assertEnum(status, MEETING_STATUSES, 'status');
      conditions.push('m.status = ?');
      params.push(status);
    }
    if (meetingType && meetingType !== 'all') {
      assertEnum(meetingType, MEETING_TYPES, 'meetingType');
      conditions.push('m.meeting_type = ?');
      params.push(meetingType);
    }
    if (recordingSource && recordingSource !== 'all') {
      assertEnum(recordingSource, RECORDING_SOURCES, 'recordingSource');
      conditions.push('m.recording_source = ?');
      params.push(recordingSource);
    }
    if (dateFrom) {
      conditions.push('COALESCE(m.scheduled_at, m.created_at) >= ?');
      params.push(new Date(dateFrom));
    }
    if (dateTo) {
      conditions.push('COALESCE(m.scheduled_at, m.created_at) <= ?');
      params.push(new Date(dateTo));
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await queryOne(
      `SELECT COUNT(*) AS total FROM meetings m WHERE ${whereClause}`,
      params
    );
    const total = Number(countRow?.total || 0);

    const rows = await query(
      `SELECT m.*, u.full_name AS creator_name
       FROM meetings m
       INNER JOIN users u ON u.id = m.created_by
       WHERE ${whereClause}
       ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({
      meetings: rows.map(formatMeetingRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

router.post(
  '/',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const {
      title,
      description = '',
      meetingType = 'online',
      recordingSource = 'scheduled',
      status = 'scheduled',
      scheduledAt = null,
      languageCode = 'en',
      customVocabulary = [],
    } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim().length < 2) {
      throw new AppError(400, 'Meeting title must be at least 2 characters.', 'VALIDATION_ERROR');
    }

    assertEnum(meetingType, MEETING_TYPES, 'meetingType');
    assertEnum(recordingSource, RECORDING_SOURCES, 'recordingSource');
    assertEnum(status, MEETING_STATUSES, 'status');

    const meetingId = crypto.randomUUID();
    const parsedScheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledAt && Number.isNaN(parsedScheduledAt.getTime())) {
      throw new AppError(400, 'Invalid scheduledAt date value.', 'VALIDATION_ERROR');
    }

    await query(
      `INSERT INTO meetings (
        id, organization_id, created_by, title, description,
        meeting_type, recording_source, status, scheduled_at,
        language_code, custom_vocabulary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meetingId,
        req.organization.id,
        req.user.id,
        title.trim().slice(0, 255),
        description ? String(description).trim() : null,
        meetingType,
        recordingSource,
        status,
        parsedScheduledAt,
        String(languageCode || 'en').slice(0, 16),
        Array.isArray(customVocabulary) ? JSON.stringify(customVocabulary.slice(0, 100)) : null,
      ]
    );

    const created = await queryOne(
      `SELECT m.*, u.full_name AS creator_name
       FROM meetings m
       INNER JOIN users u ON u.id = m.created_by
       WHERE m.id = ? AND m.organization_id = ?`,
      [meetingId, req.organization.id]
    );

    const formatted = formatMeetingRow(created);
    emitOrgEvent(req, 'meeting:created', formatted);

    await recordAuditLog({
      organizationId: req.organization.id,
      userId: req.user.id,
      action: 'meeting.create',
      resourceType: 'meeting',
      resourceId: meetingId,
      ipAddress: req.ip,
    });

    res.status(201).json({ meeting: formatted });
  })
);

router.get(
  '/:id',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const row = await queryOne(
      `SELECT m.*, u.full_name AS creator_name
       FROM meetings m
       INNER JOIN users u ON u.id = m.created_by
       WHERE m.id = ? AND m.organization_id = ? AND m.deleted_at IS NULL`,
      [meetingId, req.organization.id]
    );

    if (!row) {
      throw new AppError(404, 'Meeting not found in this organization.', 'NOT_FOUND');
    }

    const [speakers, summary, decisions, actionItems, notes, shares, segments, recordings] = await Promise.all([
      query(
        `SELECT id, speaker_key AS speakerKey, display_name AS displayName,
                color_hex AS colorHex, total_speaking_seconds AS totalSpeakingSeconds
         FROM speakers
         WHERE meeting_id = ? AND organization_id = ?
         ORDER BY speaker_key ASC`,
        [meetingId, req.organization.id]
      ),
      queryOne(
        `SELECT id, detail_level AS detailLevel, model_name AS modelName,
                executive_summary AS executiveSummary, meeting_purpose AS meetingPurpose,
                main_topics AS mainTopics, discussion_points AS discussionPoints,
                challenges_concerns AS challengesConcerns, risks_identified AS risksIdentified,
                next_steps AS nextSteps, minutes_markdown AS minutesMarkdown, updated_at AS updatedAt
         FROM meeting_summaries
         WHERE meeting_id = ? AND organization_id = ?
         ORDER BY FIELD(detail_level, 'standard', 'detailed', 'short')
         LIMIT 1`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT d.id, d.description, d.supporting_quote AS supportingQuote,
                d.timestamp_ms AS timestampMs, d.status, s.display_name AS speakerName
         FROM meeting_decisions d
         LEFT JOIN speakers s ON s.id = d.speaker_id
         WHERE d.meeting_id = ? AND d.organization_id = ?
         ORDER BY d.timestamp_ms ASC, d.created_at ASC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT id, title, description, assignee_user_id AS assigneeUserId,
                assignee_name AS assigneeName, due_date AS dueDate, priority,
                status, source_timestamp_ms AS sourceTimestampMs, created_at AS createdAt
         FROM meeting_action_items
         WHERE meeting_id = ? AND organization_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT n.id, n.title, n.content, n.is_shared AS isShared,
                n.created_at AS createdAt, n.updated_at AS updatedAt,
                u.full_name AS authorName, n.author_id AS authorId
         FROM meeting_notes n
         INNER JOIN users u ON u.id = n.author_id
         WHERE n.meeting_id = ? AND n.organization_id = ? AND n.deleted_at IS NULL
           AND (n.is_shared = 1 OR n.author_id = ?)
         ORDER BY n.updated_at DESC`,
        [meetingId, req.organization.id, req.user.id]
      ),
      query(
        `SELECT ms.id, ms.shared_with_user_id AS userId, ms.permission,
                u.full_name AS fullName, u.email
         FROM meeting_shares ms
         INNER JOIN users u ON u.id = ms.shared_with_user_id
         WHERE ms.meeting_id = ? AND ms.organization_id = ?`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT ts.id, ts.sequence_index AS sequenceIndex, ts.start_ms AS startMs,
                ts.end_ms AS endMs, ts.text, ts.confidence,
                ts.speaker_id AS speakerId, s.speaker_key AS speakerKey,
                ts.is_edited AS isEdited, ts.words_json AS wordsJson,
                COALESCE(s.display_name, 'Speaker') AS speakerName,
                COALESCE(s.color_hex, '#762F48') AS speakerColor
         FROM transcript_segments ts
         LEFT JOIN speakers s ON s.id = ts.speaker_id
         WHERE ts.meeting_id = ? AND ts.organization_id = ?
         ORDER BY ts.sequence_index ASC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT id, file_name AS fileName, mime_type AS mimeType,
                file_size_bytes AS fileSizeBytes, duration_seconds AS durationSeconds,
                storage_provider AS storageProvider, status, created_at AS createdAt
         FROM recordings
         WHERE meeting_id = ? AND organization_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [meetingId, req.organization.id]
      ),
    ]);

    const formattedSegments = (segments || []).map((seg) => {
      let parsedWords = [];
      if (typeof seg.wordsJson === 'string') {
        try {
          parsedWords = JSON.parse(seg.wordsJson);
        } catch {
          parsedWords = [];
        }
      } else if (Array.isArray(seg.wordsJson)) {
        parsedWords = seg.wordsJson;
      }
      return {
        ...seg,
        isEdited: Boolean(seg.isEdited),
        wordsJson: parsedWords,
      };
    });

    res.json({
      meeting: formatMeetingRow(row),
      speakers,
      summary,
      decisions,
      actionItems,
      notes,
      shares,
      segments: formattedSegments,
      recordings,
    });
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const existing = await queryOne(
      'SELECT * FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!existing) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    const {
      title,
      description,
      meetingType,
      recordingSource,
      status,
      scheduledAt,
      languageCode,
      customVocabulary,
    } = req.body || {};

    const updates = [];
    const params = [];

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 2) {
        throw new AppError(400, 'Meeting title must be at least 2 characters.', 'VALIDATION_ERROR');
      }
      updates.push('title = ?');
      params.push(title.trim().slice(0, 255));
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? String(description).trim() : null);
    }
    if (meetingType !== undefined) {
      assertEnum(meetingType, MEETING_TYPES, 'meetingType');
      updates.push('meeting_type = ?');
      params.push(meetingType);
    }
    if (recordingSource !== undefined) {
      assertEnum(recordingSource, RECORDING_SOURCES, 'recordingSource');
      updates.push('recording_source = ?');
      params.push(recordingSource);
    }
    if (status !== undefined) {
      assertEnum(status, MEETING_STATUSES, 'status');
      updates.push('status = ?');
      params.push(status);
    }
    if (scheduledAt !== undefined) {
      const dt = scheduledAt ? new Date(scheduledAt) : null;
      if (scheduledAt && Number.isNaN(dt.getTime())) {
        throw new AppError(400, 'Invalid scheduledAt date.', 'VALIDATION_ERROR');
      }
      updates.push('scheduled_at = ?');
      params.push(dt);
    }
    if (languageCode !== undefined) {
      updates.push('language_code = ?');
      params.push(String(languageCode).slice(0, 16) || 'en');
    }
    if (customVocabulary !== undefined) {
      updates.push('custom_vocabulary = ?');
      params.push(Array.isArray(customVocabulary) ? JSON.stringify(customVocabulary) : null);
    }

    if (updates.length > 0) {
      params.push(meetingId, req.organization.id);
      await query(
        `UPDATE meetings SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`,
        params
      );
    }

    const updated = await queryOne(
      `SELECT m.*, u.full_name AS creator_name
       FROM meetings m
       INNER JOIN users u ON u.id = m.created_by
       WHERE m.id = ? AND m.organization_id = ?`,
      [meetingId, req.organization.id]
    );

    const formatted = formatMeetingRow(updated);
    emitOrgEvent(req, 'meeting:updated', formatted);

    res.json({ meeting: formatted });
  })
);

router.post(
  '/:id/archive',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const { archived = true } = req.body || {};

    const result = await query(
      `UPDATE meetings
       SET is_archived = ?, status = CASE WHEN ? = 1 THEN 'archived' ELSE IF(status = 'archived', 'completed', status) END
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [archived ? 1 : 0, archived ? 1 : 0, meetingId, req.organization.id]
    );

    if (!result.affectedRows) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    emitOrgEvent(req, 'meeting:updated', { id: meetingId, isArchived: Boolean(archived) });
    res.json({ success: true, isArchived: Boolean(archived) });
  })
);

router.post(
  '/:id/duplicate',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const source = await queryOne(
      'SELECT * FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!source) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    const duplicateId = crypto.randomUUID();
    await query(
      `INSERT INTO meetings (
        id, organization_id, created_by, title, description,
        meeting_type, recording_source, status, scheduled_at, language_code, custom_vocabulary
      ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'scheduled', ?, ?, ?)`,
      [
        duplicateId,
        req.organization.id,
        req.user.id,
        `${source.title} (Copy)`.slice(0, 255),
        source.description,
        source.meeting_type,
        source.scheduled_at,
        source.language_code,
        source.custom_vocabulary ? JSON.stringify(source.custom_vocabulary) : null,
      ]
    );

    const created = await queryOne(
      `SELECT m.*, u.full_name AS creator_name
       FROM meetings m
       INNER JOIN users u ON u.id = m.created_by
       WHERE m.id = ?`,
      [duplicateId]
    );

    const formatted = formatMeetingRow(created);
    emitOrgEvent(req, 'meeting:created', formatted);
    res.status(201).json({ meeting: formatted });
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireOrganization,
  requireRole('org_admin', 'manager', 'member'),
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const existing = await queryOne(
      'SELECT id, created_by FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!existing) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    if (
      req.organization.role === 'member' &&
      existing.created_by !== req.user.id &&
      !req.user.is_super_admin
    ) {
      throw new AppError(403, 'Members can only delete meetings they created.', 'FORBIDDEN');
    }

    await query(
      'UPDATE meetings SET deleted_at = NOW() WHERE id = ? AND organization_id = ?',
      [meetingId, req.organization.id]
    );

    emitOrgEvent(req, 'meeting:deleted', { id: meetingId });
    await recordAuditLog({
      organizationId: req.organization.id,
      userId: req.user.id,
      action: 'meeting.delete',
      resourceType: 'meeting',
      resourceId: meetingId,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  })
);

router.post(
  '/:id/share',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const { userId, permission = 'view' } = req.body || {};
    const targetUserId = assertValidUuid(userId, 'userId');
    assertEnum(permission, ['view', 'comment', 'edit'], 'permission');

    const meeting = await queryOne(
      'SELECT id FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!meeting) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    // Strict org isolation: target user MUST belong to the same organization
    const targetMember = await queryOne(
      `SELECT user_id FROM organization_members
       WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
      [req.organization.id, targetUserId]
    );
    if (!targetMember) {
      throw new AppError(
        403,
        'Cannot share meeting with a user outside your organization.',
        'ORG_ACCESS_DENIED'
      );
    }

    await query(
      `INSERT INTO meeting_shares (id, organization_id, meeting_id, shared_with_user_id, shared_by_user_id, permission)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE permission = VALUES(permission), shared_by_user_id = VALUES(shared_by_user_id)`,
      [crypto.randomUUID(), req.organization.id, meetingId, targetUserId, req.user.id, permission]
    );

    res.status(201).json({ success: true });
  })
);

router.delete(
  '/:id/share/:userId',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const targetUserId = assertValidUuid(req.params.userId, 'userId');

    await query(
      `DELETE FROM meeting_shares
       WHERE meeting_id = ? AND organization_id = ? AND shared_with_user_id = ?`,
      [meetingId, req.organization.id, targetUserId]
    );
    res.json({ success: true });
  })
);

router.post(
  '/:id/notes',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const { title = '', content, isShared = true } = req.body || {};

    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new AppError(400, 'Note content is required.', 'VALIDATION_ERROR');
    }

    const meeting = await queryOne(
      'SELECT id FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!meeting) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    const noteId = crypto.randomUUID();
    await query(
      `INSERT INTO meeting_notes (id, organization_id, meeting_id, author_id, title, content, is_shared)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        noteId,
        req.organization.id,
        meetingId,
        req.user.id,
        title ? String(title).trim().slice(0, 200) : null,
        content.trim(),
        isShared ? 1 : 0,
      ]
    );

    res.status(201).json({
      note: {
        id: noteId,
        title: title ? String(title).trim() : null,
        content: content.trim(),
        isShared: Boolean(isShared),
        authorName: req.user.full_name,
        authorId: req.user.id,
        createdAt: new Date().toISOString(),
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Phase 3: Interactive Transcript Viewer, Editor & Export Services
// ---------------------------------------------------------------------------

async function syncMeetingTranscript(meetingId, organizationId) {
  const segments = await query(
    `SELECT text FROM transcript_segments
     WHERE meeting_id = ? AND organization_id = ?
     ORDER BY sequence_index ASC`,
    [meetingId, organizationId]
  );
  const fullText = segments.map((s) => s.text).join(' ');
  const wordCount = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
  await query(
    `UPDATE transcripts
     SET full_text = ?, word_count = ?
     WHERE meeting_id = ? AND organization_id = ?`,
    [fullText, wordCount, meetingId, organizationId]
  );
}

router.get(
  '/:id/transcript',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const meeting = await queryOne(
      'SELECT id, title, status FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!meeting) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    const [transcript, segments, speakers] = await Promise.all([
      queryOne(
        `SELECT id, model_name AS modelName, diarization_model AS diarizationModel,
                language_code AS languageCode, full_text AS fullText, word_count AS wordCount,
                average_confidence AS averageConfidence, status, updated_at AS updatedAt
         FROM transcripts
         WHERE meeting_id = ? AND organization_id = ?`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT ts.id, ts.sequence_index AS sequenceIndex, ts.start_ms AS startMs,
                ts.end_ms AS endMs, ts.text, ts.confidence,
                ts.speaker_id AS speakerId, s.speaker_key AS speakerKey,
                ts.is_edited AS isEdited, ts.words_json AS wordsJson,
                COALESCE(s.display_name, 'Speaker') AS speakerName,
                COALESCE(s.color_hex, '#762F48') AS speakerColor
         FROM transcript_segments ts
         LEFT JOIN speakers s ON s.id = ts.speaker_id
         WHERE ts.meeting_id = ? AND ts.organization_id = ?
         ORDER BY ts.sequence_index ASC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT id, speaker_key AS speakerKey, display_name AS displayName,
                color_hex AS colorHex, total_speaking_seconds AS totalSpeakingSeconds
         FROM speakers
         WHERE meeting_id = ? AND organization_id = ?
         ORDER BY speaker_key ASC`,
        [meetingId, req.organization.id]
      ),
    ]);

    const formattedSegments = (segments || []).map((seg) => {
      let parsedWords = [];
      if (typeof seg.wordsJson === 'string') {
        try {
          parsedWords = JSON.parse(seg.wordsJson);
        } catch {
          parsedWords = [];
        }
      } else if (Array.isArray(seg.wordsJson)) {
        parsedWords = seg.wordsJson;
      }
      return {
        ...seg,
        isEdited: Boolean(seg.isEdited),
        wordsJson: parsedWords,
      };
    });

    res.json({
      transcript: transcript || null,
      segments: formattedSegments,
      speakers: speakers || [],
    });
  })
);

router.patch(
  '/:id/transcript/segments/:segmentId',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const segmentId = assertValidUuid(req.params.segmentId, 'segmentId');
    const { text, speakerId } = req.body || {};

    const existing = await queryOne(
      `SELECT * FROM transcript_segments
       WHERE id = ? AND meeting_id = ? AND organization_id = ?`,
      [segmentId, meetingId, req.organization.id]
    );
    if (!existing) {
      throw new AppError(404, 'Transcript segment not found.', 'NOT_FOUND');
    }

    const updates = ['is_edited = 1', 'edited_by = ?'];
    const params = [req.user.id];

    if (text !== undefined) {
      if (typeof text !== 'string' || !text.trim()) {
        throw new AppError(400, 'Segment text cannot be empty.', 'VALIDATION_ERROR');
      }
      updates.push('text = ?');
      params.push(text.trim());
    }

    if (speakerId !== undefined) {
      if (speakerId !== null) {
        assertValidUuid(speakerId, 'speakerId');
        const speaker = await queryOne(
          'SELECT id FROM speakers WHERE id = ? AND meeting_id = ? AND organization_id = ?',
          [speakerId, meetingId, req.organization.id]
        );
        if (!speaker) {
          throw new AppError(404, 'Speaker not found for this meeting.', 'NOT_FOUND');
        }
      }
      updates.push('speaker_id = ?');
      params.push(speakerId);
    }

    params.push(segmentId, meetingId, req.organization.id);
    await query(
      `UPDATE transcript_segments
       SET ${updates.join(', ')}
       WHERE id = ? AND meeting_id = ? AND organization_id = ?`,
      params
    );

    await syncMeetingTranscript(meetingId, req.organization.id);

    const updated = await queryOne(
      `SELECT ts.id, ts.sequence_index AS sequenceIndex, ts.start_ms AS startMs,
              ts.end_ms AS endMs, ts.text, ts.confidence,
              ts.speaker_id AS speakerId, s.speaker_key AS speakerKey,
              ts.is_edited AS isEdited, ts.words_json AS wordsJson,
              COALESCE(s.display_name, 'Speaker') AS speakerName,
              COALESCE(s.color_hex, '#762F48') AS speakerColor
       FROM transcript_segments ts
       LEFT JOIN speakers s ON s.id = ts.speaker_id
       WHERE ts.id = ? AND ts.meeting_id = ? AND ts.organization_id = ?`,
      [segmentId, meetingId, req.organization.id]
    );

    emitOrgEvent(req, 'transcript:segment-updated', { meetingId, segment: updated });

    res.json({ segment: updated });
  })
);

router.post(
  '/:id/transcript/segments/:segmentId/split',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const segmentId = assertValidUuid(req.params.segmentId, 'segmentId');
    const { splitTimestampMs, splitTextFirst, splitTextSecond } = req.body || {};

    if (!splitTextFirst || !splitTextSecond) {
      throw new AppError(400, 'Both splitTextFirst and splitTextSecond are required.', 'VALIDATION_ERROR');
    }

    const seg = await queryOne(
      `SELECT * FROM transcript_segments
       WHERE id = ? AND meeting_id = ? AND organization_id = ?`,
      [segmentId, meetingId, req.organization.id]
    );
    if (!seg) {
      throw new AppError(404, 'Segment not found.', 'NOT_FOUND');
    }

    const splitMs = Number(splitTimestampMs || Math.floor((seg.start_ms + seg.end_ms) / 2));
    const newSegmentId = crypto.randomUUID();

    await withTransaction(async (conn) => {
      // 1. Update first segment
      await conn.query(
        `UPDATE transcript_segments
         SET end_ms = ?, text = ?, is_edited = 1, edited_by = ?
         WHERE id = ?`,
        [splitMs, splitTextFirst.trim(), req.user.id, segmentId]
      );

      // 2. Increment sequence_index for subsequent segments
      await conn.query(
        `UPDATE transcript_segments
         SET sequence_index = sequence_index + 1
         WHERE meeting_id = ? AND organization_id = ? AND sequence_index > ?`,
        [meetingId, req.organization.id, seg.sequence_index]
      );

      // 3. Insert second segment
      await conn.query(
        `INSERT INTO transcript_segments (
           id, organization_id, meeting_id, transcript_id, speaker_id,
           sequence_index, start_ms, end_ms, text, is_edited, edited_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          newSegmentId,
          req.organization.id,
          meetingId,
          seg.transcript_id,
          seg.speaker_id,
          seg.sequence_index + 1,
          splitMs,
          seg.end_ms,
          splitTextSecond.trim(),
          req.user.id,
        ]
      );
    });

    await syncMeetingTranscript(meetingId, req.organization.id);
    emitOrgEvent(req, 'transcript:updated', { meetingId });

    res.json({ success: true, newSegmentId });
  })
);

router.post(
  '/:id/transcript/segments/:segmentId/merge-next',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const segmentId = assertValidUuid(req.params.segmentId, 'segmentId');

    const seg1 = await queryOne(
      `SELECT * FROM transcript_segments
       WHERE id = ? AND meeting_id = ? AND organization_id = ?`,
      [segmentId, meetingId, req.organization.id]
    );
    if (!seg1) {
      throw new AppError(404, 'Segment not found.', 'NOT_FOUND');
    }

    const seg2 = await queryOne(
      `SELECT * FROM transcript_segments
       WHERE meeting_id = ? AND organization_id = ? AND sequence_index = ?`,
      [meetingId, req.organization.id, seg1.sequence_index + 1]
    );
    if (!seg2) {
      throw new AppError(400, 'No subsequent segment to merge with.', 'VALIDATION_ERROR');
    }

    const combinedText = `${seg1.text} ${seg2.text}`.trim();

    await withTransaction(async (conn) => {
      // 1. Update seg1 to span through seg2 end_ms with combined text
      await conn.query(
        `UPDATE transcript_segments
         SET end_ms = ?, text = ?, is_edited = 1, edited_by = ?
         WHERE id = ?`,
        [seg2.end_ms, combinedText, req.user.id, seg1.id]
      );

      // 2. Delete seg2
      await conn.query('DELETE FROM transcript_segments WHERE id = ?', [seg2.id]);

      // 3. Shift subsequent sequence indices down
      await conn.query(
        `UPDATE transcript_segments
         SET sequence_index = sequence_index - 1
         WHERE meeting_id = ? AND organization_id = ? AND sequence_index > ?`,
        [meetingId, req.organization.id, seg2.sequence_index]
      );
    });

    await syncMeetingTranscript(meetingId, req.organization.id);
    emitOrgEvent(req, 'transcript:updated', { meetingId });

    res.json({ success: true });
  })
);

router.delete(
  '/:id/transcript/segments/:segmentId',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const segmentId = assertValidUuid(req.params.segmentId, 'segmentId');

    const seg = await queryOne(
      `SELECT * FROM transcript_segments
       WHERE id = ? AND meeting_id = ? AND organization_id = ?`,
      [segmentId, meetingId, req.organization.id]
    );
    if (!seg) {
      throw new AppError(404, 'Segment not found.', 'NOT_FOUND');
    }

    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM transcript_segments WHERE id = ?', [segmentId]);
      await conn.query(
        `UPDATE transcript_segments
         SET sequence_index = sequence_index - 1
         WHERE meeting_id = ? AND organization_id = ? AND sequence_index > ?`,
        [meetingId, req.organization.id, seg.sequence_index]
      );
    });

    await syncMeetingTranscript(meetingId, req.organization.id);
    emitOrgEvent(req, 'transcript:updated', { meetingId });

    res.json({ success: true });
  })
);

router.patch(
  '/:id/speakers/:speakerId',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const speakerId = assertValidUuid(req.params.speakerId, 'speakerId');
    const { displayName, colorHex } = req.body || {};

    const speaker = await queryOne(
      'SELECT * FROM speakers WHERE id = ? AND meeting_id = ? AND organization_id = ?',
      [speakerId, meetingId, req.organization.id]
    );
    if (!speaker) {
      throw new AppError(404, 'Speaker not found for this meeting.', 'NOT_FOUND');
    }

    const updates = [];
    const params = [];

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || !displayName.trim()) {
        throw new AppError(400, 'Display name cannot be empty.', 'VALIDATION_ERROR');
      }
      updates.push('display_name = ?');
      params.push(displayName.trim().slice(0, 150));
    }

    if (colorHex !== undefined) {
      const hex = String(colorHex).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        throw new AppError(400, 'Invalid color hex format (#RRGGBB).', 'VALIDATION_ERROR');
      }
      updates.push('color_hex = ?');
      params.push(hex);
    }

    if (updates.length > 0) {
      params.push(speakerId, meetingId, req.organization.id);
      await query(
        `UPDATE speakers SET ${updates.join(', ')} WHERE id = ? AND meeting_id = ? AND organization_id = ?`,
        params
      );
    }

    const updated = await queryOne('SELECT * FROM speakers WHERE id = ?', [speakerId]);
    emitOrgEvent(req, 'transcript:speaker-updated', { meetingId, speaker: updated });

    res.json({ speaker: updated });
  })
);

router.post(
  '/:id/speakers',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const { displayName, colorHex } = req.body || {};

    if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
      throw new AppError(400, 'Speaker display name is required.', 'VALIDATION_ERROR');
    }

    const existingCount = await queryOne(
      'SELECT COUNT(*) AS total FROM speakers WHERE meeting_id = ? AND organization_id = ?',
      [meetingId, req.organization.id]
    );
    const speakerKey = `SPEAKER_${String(existingCount.total).padStart(2, '0')}`;
    const speakerId = crypto.randomUUID();
    const color =
      colorHex && /^#[0-9a-fA-F]{6}$/.test(colorHex)
        ? colorHex
        : '#762F48';

    await query(
      `INSERT INTO speakers (id, organization_id, meeting_id, speaker_key, display_name, color_hex)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [speakerId, req.organization.id, meetingId, speakerKey, displayName.trim().slice(0, 150), color]
    );

    const created = await queryOne('SELECT * FROM speakers WHERE id = ?', [speakerId]);
    res.status(201).json({ speaker: created });
  })
);

router.get(
  '/:id/export',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.id, 'meetingId');
    const format = String(req.query.format || 'txt').toLowerCase();
    const exportType = String(req.query.type || 'full_report').toLowerCase();
    const includeTimestamps = req.query.includeTimestamps !== '0' && req.query.includeTimestamps !== 'false';
    const includeSpeakers = req.query.includeSpeakers !== '0' && req.query.includeSpeakers !== 'false';

    assertEnum(format, ['txt', 'docx', 'pdf', 'markdown'], 'format');
    assertEnum(exportType, ['full_report', 'transcript', 'summary'], 'exportType');

    const meeting = await queryOne(
      `SELECT m.*, u.full_name AS creator_name
       FROM meetings m
       INNER JOIN users u ON u.id = m.created_by
       WHERE m.id = ? AND m.organization_id = ? AND m.deleted_at IS NULL`,
      [meetingId, req.organization.id]
    );
    if (!meeting) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    const [summary, decisions, actionItems, segments, speakers] = await Promise.all([
      queryOne(
        `SELECT * FROM meeting_summaries
         WHERE meeting_id = ? AND organization_id = ?
         ORDER BY FIELD(detail_level, 'standard', 'detailed', 'short') LIMIT 1`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT d.*, s.display_name AS speakerName
         FROM meeting_decisions d
         LEFT JOIN speakers s ON s.id = d.speaker_id
         WHERE d.meeting_id = ? AND d.organization_id = ?
         ORDER BY d.timestamp_ms ASC, d.created_at ASC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT * FROM meeting_action_items
         WHERE meeting_id = ? AND organization_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT ts.*, COALESCE(s.display_name, 'Speaker') AS speakerName
         FROM transcript_segments ts
         LEFT JOIN speakers s ON s.id = ts.speaker_id
         WHERE ts.meeting_id = ? AND ts.organization_id = ?
         ORDER BY ts.sequence_index ASC`,
        [meetingId, req.organization.id]
      ),
      query(
        `SELECT * FROM speakers
         WHERE meeting_id = ? AND organization_id = ?
         ORDER BY speaker_key ASC`,
        [meetingId, req.organization.id]
      ),
    ]);

    const sanitizedTitle = (meeting.title || 'Meeting-Report')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);

    const payload = {
      meeting,
      summary,
      decisions,
      actionItems,
      segments,
      speakers,
      includeTimestamps,
      includeSpeakers,
      exportType,
    };

    if (format === 'txt' || format === 'markdown') {
      const text = generatePlainText(payload);
      res.setHeader('Content-Type', format === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.${format === 'markdown' ? 'md' : 'txt'}"`);
      return res.send(text);
    }

    if (format === 'docx') {
      const buffer = await generateDocx(payload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.docx"`);
      return res.send(buffer);
    }

    if (format === 'pdf') {
      const buffer = await generatePdf(payload);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.pdf"`);
      return res.send(buffer);
    }
  })
);

export default router;

