import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { query, queryOne, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertEnum, assertValidUuid } from '../middleware/validate.js';
import { recordAuditLog } from '../services/auditService.js';
import { enqueueTranscriptionJob } from '../services/queueService.js';
import {
  createSignedStreamToken,
  deleteRecordingFile,
  getS3PresignedUrl,
  saveRecordingFile,
  streamLocalFileWithRange,
  verifySignedStreamToken,
} from '../services/storageService.js';

const router = Router();

const ALLOWED_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.mp4',
  '.webm',
  '.ogg',
  '.opus',
  '.flac',
  '.mkv',
  '.mov',
  '.aac',
]);

const tempUploadDir = path.join(env.storage.localDir, '_tmp');
fs.mkdirSync(tempUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempUploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: env.storage.maxUploadBytes,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const validExt = ALLOWED_EXTENSIONS.has(ext);
    const validMime =
      mime.startsWith('audio/') ||
      mime.startsWith('video/') ||
      mime === 'application/octet-stream';

    if (!validExt || !validMime) {
      return cb(
        new AppError(
          400,
          'Unsupported media format. Allowed: MP3, WAV, M4A, MP4, WEBM, OGG, FLAC, MKV, MOV.',
          'INVALID_FILE_TYPE'
        )
      );
    }
    return cb(null, true);
  },
});

function parseJsonList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return String(raw)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function emitOrgEvent(req, eventName, payload) {
  const io = req.app.get('io');
  if (io) {
    io.to(`org:${req.organization.id}`).emit(eventName, payload);
  }
}

router.post(
  '/upload',
  requireAuth,
  requireOrganization,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              413,
              `File exceeds maximum allowed size (${Math.round(env.storage.maxUploadBytes / 1024 / 1024)} MB).`,
              'FILE_TOO_LARGE'
            )
          );
        }
        return next(new AppError(400, err.message, 'UPLOAD_ERROR'));
      }
      return next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new AppError(400, 'Audio or video recording file is required.', 'VALIDATION_ERROR');
    }

    const cleanupTemp = async () => {
      await fsp.unlink(file.path).catch(() => {});
    };

    try {
      const {
        meetingId: requestedMeetingId,
        title,
        description = '',
        meetingType = 'online',
        recordingSource = 'upload',
        scheduledAt = null,
        speakerHints = '',
        customVocabulary = '',
        consentConfirmed,
        durationSeconds = 0,
      } = req.body || {};

      const isConsent = consentConfirmed === true || consentConfirmed === 'true' || consentConfirmed === '1';
      if (!isConsent) {
        throw new AppError(
          400,
          'Recording consent acknowledgment is required before uploading or processing.',
          'CONSENT_REQUIRED'
        );
      }

      assertEnum(meetingType, ['in_person', 'online', 'hybrid', 'imported'], 'meetingType');
      assertEnum(
        recordingSource,
        ['microphone', 'browser_tab', 'upload', 'zoom', 'google_meet', 'microsoft_teams', 'scheduled'],
        'recordingSource'
      );

      let meetingId = requestedMeetingId ? assertValidUuid(requestedMeetingId, 'meetingId') : null;
      const speakersList = parseJsonList(speakerHints);
      const vocabList = parseJsonList(customVocabulary);
      const mergedVocabulary = Array.from(
        new Set([...(req.organization.defaultVocabulary || []), ...vocabList])
      );

      if (meetingId) {
        const existing = await queryOne(
          'SELECT id FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
          [meetingId, req.organization.id]
        );
        if (!existing) {
          throw new AppError(404, 'Target meeting not found in your organization.', 'NOT_FOUND');
        }
      } else {
        if (!title || typeof title !== 'string' || title.trim().length < 2) {
          throw new AppError(400, 'Meeting title must be at least 2 characters.', 'VALIDATION_ERROR');
        }
        meetingId = crypto.randomUUID();
      }

      const recordingId = crypto.randomUUID();
      const ext = path.extname(file.originalname || '').toLowerCase() || '.webm';
      const storageKey = `${req.organization.id}/${meetingId}/${recordingId}${ext}`;

      const stored = await saveRecordingFile({
        tempFilePath: file.path,
        storageKey,
        mimeType: file.mimetype || 'application/octet-stream',
      });

      const parsedDate = scheduledAt ? new Date(scheduledAt) : new Date();
      const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
      const safeDuration = Math.max(0, Number.parseInt(durationSeconds || '0', 10) || 0);

      await withTransaction(async (tx) => {
        if (!requestedMeetingId) {
          await tx.execute(
            `INSERT INTO meetings (
              id, organization_id, created_by, title, description,
              meeting_type, recording_source, status, processing_progress,
              scheduled_at, started_at, duration_seconds, custom_vocabulary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 5, ?, ?, ?, ?)`,
            [
              meetingId,
              req.organization.id,
              req.user.id,
              title.trim().slice(0, 255),
              description ? String(description).trim() : null,
              meetingType,
              recordingSource,
              safeDate,
              safeDate,
              safeDuration,
              mergedVocabulary.length ? JSON.stringify(mergedVocabulary) : null,
            ]
          );
        } else {
          await tx.execute(
            `UPDATE meetings
             SET recording_source = ?, status = 'queued', processing_progress = 5,
                 processing_error = NULL
             WHERE id = ? AND organization_id = ?`,
            [recordingSource, meetingId, req.organization.id]
          );
        }

        await tx.execute(
          `INSERT INTO recordings (
            id, organization_id, meeting_id, uploaded_by, file_name, mime_type,
            file_size_bytes, duration_seconds, storage_provider, storage_key,
            status, consent_confirmed
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stored', 1)`,
          [
            recordingId,
            req.organization.id,
            meetingId,
            req.user.id,
            path.basename(file.originalname || `recording${ext}`).slice(0, 255),
            file.mimetype || 'application/octet-stream',
            file.size,
            safeDuration,
            stored.provider,
            stored.storageKey,
          ]
        );

        await tx.execute(
          `INSERT INTO notifications (id, organization_id, user_id, type, title, message, entity_type, entity_id)
           VALUES (?, ?, ?, 'upload_completed', 'Recording uploaded', ?, 'meeting', ?)`,
          [
            crypto.randomUUID(),
            req.organization.id,
            req.user.id,
            `Recording "${path.basename(file.originalname || 'audio')}" uploaded and queued for AI transcription.`,
            meetingId,
          ]
        );
      });

      const queueResult = await enqueueTranscriptionJob({
        recordingId,
        meetingId,
        organizationId: req.organization.id,
        userId: req.user.id,
        storageProvider: stored.provider,
        storageKey: stored.storageKey,
        fileName: path.basename(file.originalname || `recording${ext}`),
        mimeType: file.mimetype || 'application/octet-stream',
        languageCode: 'en',
        speakerHints: speakersList,
        customVocabulary: mergedVocabulary,
      });

      const meeting = await queryOne(
        `SELECT id, title, status, processing_progress AS processingProgress,
                processing_error AS processingError, recording_source AS recordingSource,
                duration_seconds AS durationSeconds
         FROM meetings WHERE id = ?`,
        [meetingId]
      );
      const recording = await queryOne(
        `SELECT id, meeting_id AS meetingId, file_name AS fileName, mime_type AS mimeType,
                file_size_bytes AS fileSizeBytes, duration_seconds AS durationSeconds,
                storage_provider AS storageProvider, status, created_at AS createdAt
         FROM recordings WHERE id = ?`,
        [recordingId]
      );

      emitOrgEvent(req, 'meeting:updated', meeting);
      emitOrgEvent(req, 'notification:new', { meetingId });

      await recordAuditLog({
        organizationId: req.organization.id,
        userId: req.user.id,
        action: 'recording.upload',
        resourceType: 'recording',
        resourceId: recordingId,
        ipAddress: req.ip,
        metadata: { meetingId, fileSize: file.size },
      });

      res.status(202).json({
        meeting,
        recording,
        queue: queueResult,
      });
    } catch (err) {
      await cleanupTemp();
      throw err;
    }
  })
);

router.get(
  '/meeting/:meetingId',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const meetingId = assertValidUuid(req.params.meetingId, 'meetingId');
    const recordings = await query(
      `SELECT id, meeting_id AS meetingId, file_name AS fileName, mime_type AS mimeType,
              file_size_bytes AS fileSizeBytes, duration_seconds AS durationSeconds,
              storage_provider AS storageProvider, status, consent_confirmed AS consentConfirmed,
              created_at AS createdAt
       FROM recordings
       WHERE meeting_id = ? AND organization_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [meetingId, req.organization.id]
    );
    res.json({ recordings });
  })
);

router.get(
  '/:id/playback-url',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const recordingId = assertValidUuid(req.params.id, 'recordingId');
    const recording = await queryOne(
      `SELECT id, storage_provider, storage_key
       FROM recordings
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [recordingId, req.organization.id]
    );
    if (!recording) {
      throw new AppError(404, 'Recording not found.', 'NOT_FOUND');
    }

    if (recording.storage_provider === 's3' || recording.storage_provider === 'minio') {
      const url = await getS3PresignedUrl(recording.storage_key, 1800);
      if (url) {
        return res.json({ url });
      }
    }

    const { exp, sig } = createSignedStreamToken({
      recordingId: recording.id,
      organizationId: req.organization.id,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/api/recordings/${recording.id}/stream?org=${encodeURIComponent(req.organization.id)}&exp=${exp}&sig=${sig}`;
    res.json({ url });
  })
);

router.get(
  '/:id/stream',
  asyncHandler(async (req, res) => {
    const recordingId = assertValidUuid(req.params.id, 'recordingId');
    const { org, exp, sig } = req.query;

    if (!org || !exp || !sig) {
      throw new AppError(401, 'Signed stream parameters are required.', 'UNAUTHORIZED');
    }
    const orgId = assertValidUuid(String(org), 'org');

    const valid = verifySignedStreamToken({
      recordingId,
      organizationId: orgId,
      exp,
      sig: String(sig),
    });
    if (!valid) {
      throw new AppError(401, 'Stream link is invalid or has expired.', 'UNAUTHORIZED');
    }

    const recording = await queryOne(
      `SELECT * FROM recordings
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [recordingId, orgId]
    );
    if (!recording) {
      throw new AppError(404, 'Recording not found.', 'NOT_FOUND');
    }

    if (recording.storage_provider === 's3' || recording.storage_provider === 'minio') {
      const presigned = await getS3PresignedUrl(recording.storage_key, 300);
      if (presigned) {
        return res.redirect(presigned);
      }
    }

    await streamLocalFileWithRange(req, res, {
      storageKey: recording.storage_key,
      mimeType: recording.mime_type,
      fileName: recording.file_name,
      asAttachment: req.query.download === '1',
    });
  })
);

router.get(
  '/:id/download',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const recordingId = assertValidUuid(req.params.id, 'recordingId');
    const recording = await queryOne(
      `SELECT * FROM recordings
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [recordingId, req.organization.id]
    );
    if (!recording) {
      throw new AppError(404, 'Recording not found.', 'NOT_FOUND');
    }

    if (recording.storage_provider === 's3' || recording.storage_provider === 'minio') {
      const presigned = await getS3PresignedUrl(recording.storage_key, 300);
      if (presigned) {
        return res.redirect(presigned);
      }
    }

    await streamLocalFileWithRange(req, res, {
      storageKey: recording.storage_key,
      mimeType: recording.mime_type,
      fileName: recording.file_name,
      asAttachment: true,
    });
  })
);

router.post(
  '/:id/retry',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const recordingId = assertValidUuid(req.params.id, 'recordingId');
    const recording = await queryOne(
      `SELECT r.*, m.custom_vocabulary
       FROM recordings r
       INNER JOIN meetings m ON m.id = r.meeting_id
       WHERE r.id = ? AND r.organization_id = ? AND r.deleted_at IS NULL AND m.deleted_at IS NULL`,
      [recordingId, req.organization.id]
    );
    if (!recording) {
      throw new AppError(404, 'Recording not found.', 'NOT_FOUND');
    }

    await query(
      `UPDATE meetings
       SET status = 'queued', processing_progress = 5, processing_error = NULL
       WHERE id = ? AND organization_id = ?`,
      [recording.meeting_id, req.organization.id]
    );

    const vocab = Array.isArray(recording.custom_vocabulary)
      ? recording.custom_vocabulary
      : parseJsonList(recording.custom_vocabulary);

    const queueResult = await enqueueTranscriptionJob({
      recordingId: recording.id,
      meetingId: recording.meeting_id,
      organizationId: req.organization.id,
      userId: req.user.id,
      storageProvider: recording.storage_provider,
      storageKey: recording.storage_key,
      fileName: recording.file_name,
      mimeType: recording.mime_type,
      languageCode: 'en',
      speakerHints: [],
      customVocabulary: vocab,
    });

    emitOrgEvent(req, 'meeting:updated', {
      id: recording.meeting_id,
      status: 'queued',
      processingProgress: 5,
    });

    res.json({ success: true, queue: queueResult });
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const recordingId = assertValidUuid(req.params.id, 'recordingId');
    const recording = await queryOne(
      `SELECT * FROM recordings
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [recordingId, req.organization.id]
    );
    if (!recording) {
      throw new AppError(404, 'Recording not found.', 'NOT_FOUND');
    }

    await deleteRecordingFile(recording.storage_provider, recording.storage_key);
    await query('UPDATE recordings SET deleted_at = NOW() WHERE id = ?', [recordingId]);

    await recordAuditLog({
      organizationId: req.organization.id,
      userId: req.user.id,
      action: 'recording.delete',
      resourceType: 'recording',
      resourceId: recordingId,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  })
);

export default router;

