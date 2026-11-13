import crypto from 'node:crypto';
import { Router } from 'express';
import { query, queryOne, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertValidUuid } from '../middleware/validate.js';
import { getS3PresignedUrl, streamLocalFileWithRange } from '../services/storageService.js';

const router = Router();

const SPEAKER_COLORS = ['#762F48', '#17243C', '#2B6CB0', '#2F855A', '#975A16', '#6B46C1'];

function requireAiServiceKey(req, _res, next) {
  const provided = String(req.headers['x-api-key'] || '');
  const expected = env.ai.apiKey;
  if (
    !provided ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return next(new AppError(401, 'Invalid internal AI service API key.', 'UNAUTHORIZED'));
  }
  return next();
}

router.use(requireAiServiceKey);

router.get(
  '/recordings/:id/file',
  asyncHandler(async (req, res) => {
    const recordingId = assertValidUuid(req.params.id, 'recordingId');
    const recording = await queryOne(
      'SELECT * FROM recordings WHERE id = ? AND deleted_at IS NULL',
      [recordingId]
    );
    if (!recording) {
      throw new AppError(404, 'Recording not found.', 'NOT_FOUND');
    }

    if (recording.storage_provider === 's3' || recording.storage_provider === 'minio') {
      const presigned = await getS3PresignedUrl(recording.storage_key, 900);
      if (presigned) {
        return res.redirect(presigned);
      }
    }

    await streamLocalFileWithRange(req, res, {
      storageKey: recording.storage_key,
      mimeType: recording.mime_type,
      fileName: recording.file_name,
      asAttachment: false,
    });
  })
);

router.post(
  '/transcription-callback',
  asyncHandler(async (req, res) => {
    const {
      meetingId,
      recordingId,
      organizationId,
      userId,
      status,
      progress = 0,
      error = null,
      durationSeconds = 0,
      languageCode = 'en',
      modelName = 'whisper-large-v3',
      diarizationModel = 'pyannote/speaker-diarization-3.1',
      averageConfidence = null,
      fullText = '',
      speakers = [],
      segments = [],
    } = req.body || {};

    assertValidUuid(meetingId, 'meetingId');
    assertValidUuid(organizationId, 'organizationId');

    const meeting = await queryOne(
      'SELECT id, title, created_by FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, organizationId]
    );
    if (!meeting) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    const io = req.app.get('io');

    if (status === 'processing' || status === 'queued') {
      const safeProgress = Math.min(99, Math.max(0, Number(progress || 0)));
      await query(
        `UPDATE meetings
         SET status = ?, processing_progress = ?, processing_error = NULL
         WHERE id = ? AND organization_id = ?`,
        [status, safeProgress, meetingId, organizationId]
      );

      if (io) {
        io.to(`org:${organizationId}`).emit('transcription:progress', {
          meetingId,
          status,
          progress: safeProgress,
        });
      }
      return res.json({ ok: true });
    }

    if (status === 'failed') {
      const errMsg = String(error || 'Transcription pipeline failed.');
      await query(
        `UPDATE meetings
         SET status = 'failed', processing_error = ?
         WHERE id = ? AND organization_id = ?`,
        [errMsg, meetingId, organizationId]
      );

      await query(
        `INSERT INTO notifications (id, organization_id, user_id, type, title, message, entity_type, entity_id)
         VALUES (?, ?, ?, 'transcription_failed', 'Transcription failed', ?, 'meeting', ?)`,
        [
          crypto.randomUUID(),
          organizationId,
          userId || meeting.created_by,
          `Transcription failed for "${meeting.title}": ${errMsg}`,
          meetingId,
        ]
      );

      if (io) {
        io.to(`org:${organizationId}`).emit('meeting:updated', {
          id: meetingId,
          status: 'failed',
          processingError: errMsg,
        });
        io.to(`org:${organizationId}`).emit('notification:new', { meetingId });
      }
      return res.json({ ok: true });
    }

    if (status === 'completed') {
      const safeDuration = Math.max(0, Math.round(Number(durationSeconds || 0)));
      const wordCount = fullText ? fullText.trim().split(/\s+/).filter(Boolean).length : 0;

      await withTransaction(async (tx) => {
        // Clear old transcript/speakers for idempotent retry support
        await tx.execute('DELETE FROM transcript_segments WHERE meeting_id = ? AND organization_id = ?', [
          meetingId,
          organizationId,
        ]);
        await tx.execute('DELETE FROM transcripts WHERE meeting_id = ? AND organization_id = ?', [
          meetingId,
          organizationId,
        ]);
        await tx.execute('DELETE FROM speakers WHERE meeting_id = ? AND organization_id = ?', [
          meetingId,
          organizationId,
        ]);

        const speakerIdMap = new Map();
        const uniqueSpeakers =
          Array.isArray(speakers) && speakers.length > 0
            ? speakers
            : [{ speakerKey: 'SPEAKER_00', displayName: 'Speaker 1', totalSpeakingSeconds: safeDuration }];

        for (let i = 0; i < uniqueSpeakers.length; i++) {
          const sp = uniqueSpeakers[i];
          const speakerKey = String(sp.speakerKey || `SPEAKER_${String(i).padStart(2, '0')}`);
          const speakerId = crypto.randomUUID();
          speakerIdMap.set(speakerKey, speakerId);
          await tx.execute(
            `INSERT INTO speakers (
              id, organization_id, meeting_id, speaker_key, display_name, color_hex, total_speaking_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              speakerId,
              organizationId,
              meetingId,
              speakerKey.slice(0, 64),
              String(sp.displayName || `Speaker ${i + 1}`).slice(0, 150),
              SPEAKER_COLORS[i % SPEAKER_COLORS.length],
              Math.max(0, Math.round(Number(sp.totalSpeakingSeconds || 0))),
            ]
          );
        }

        const transcriptId = crypto.randomUUID();
        await tx.execute(
          `INSERT INTO transcripts (
            id, organization_id, meeting_id, recording_id, model_name, diarization_model,
            language_code, full_text, word_count, average_confidence, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
          [
            transcriptId,
            organizationId,
            meetingId,
            recordingId || null,
            modelName,
            diarizationModel,
            languageCode,
            fullText || '',
            wordCount,
            averageConfidence,
          ]
        );

        for (let idx = 0; idx < segments.length; idx++) {
          const seg = segments[idx];
          const speakerKey = String(seg.speakerKey || 'SPEAKER_00');
          let speakerId = speakerIdMap.get(speakerKey);
          if (!speakerId) {
            speakerId = crypto.randomUUID();
            speakerIdMap.set(speakerKey, speakerId);
            await tx.execute(
              `INSERT INTO speakers (id, organization_id, meeting_id, speaker_key, display_name, color_hex)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                speakerId,
                organizationId,
                meetingId,
                speakerKey.slice(0, 64),
                speakerKey,
                SPEAKER_COLORS[speakerIdMap.size % SPEAKER_COLORS.length],
              ]
            );
          }

          await tx.execute(
            `INSERT INTO transcript_segments (
              id, organization_id, meeting_id, transcript_id, speaker_id,
              sequence_index, start_ms, end_ms, text, words_json, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              organizationId,
              meetingId,
              transcriptId,
              speakerId,
              idx,
              Math.max(0, Math.round(Number(seg.startMs || 0))),
              Math.max(0, Math.round(Number(seg.endMs || 0))),
              String(seg.text || ''),
              seg.words ? JSON.stringify(seg.words) : null,
              seg.confidence ?? null,
            ]
          );
        }

        if (recordingId) {
          await tx.execute(
            `UPDATE recordings SET status = 'ready', duration_seconds = ? WHERE id = ? AND organization_id = ?`,
            [safeDuration, recordingId, organizationId]
          );
        }

        await tx.execute(
          `UPDATE meetings
           SET status = 'completed',
               processing_progress = 100,
               processing_error = NULL,
               duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
               speaker_count = ?,
               has_transcript = 1,
               language_code = ?
           WHERE id = ? AND organization_id = ?`,
          [safeDuration, safeDuration, speakerIdMap.size, languageCode, meetingId, organizationId]
        );

        await tx.execute(
          `INSERT INTO notifications (id, organization_id, user_id, type, title, message, entity_type, entity_id)
           VALUES (?, ?, ?, 'transcription_completed', 'Transcription ready', ?, 'meeting', ?)`,
          [
            crypto.randomUUID(),
            organizationId,
            userId || meeting.created_by,
            `Transcription and speaker diarization completed for "${meeting.title}".`,
            meetingId,
          ]
        );
      });

      if (io) {
        io.to(`org:${organizationId}`).emit('meeting:updated', {
          id: meetingId,
          status: 'completed',
          processingProgress: 100,
          hasTranscript: true,
        });
        io.to(`org:${organizationId}`).emit('transcription:progress', {
          meetingId,
          status: 'completed',
          progress: 100,
        });
        io.to(`org:${organizationId}`).emit('notification:new', { meetingId });
      }
    }

    res.json({ ok: true });
  })
);

export default router;

