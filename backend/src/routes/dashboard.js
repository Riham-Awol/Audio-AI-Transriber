import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get(
  '/overview',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const orgId = req.organization.id;

    const [
      meetingStats,
      actionStats,
      recentMeetings,
      upcomingMeetings,
      recentSummaries,
      outstandingActionItems,
      processingMeetings,
      activityRows,
      durationByType,
    ] = await Promise.all([
      queryOne(
        `SELECT
           COUNT(*) AS totalMeetings,
           COALESCE(SUM(duration_seconds), 0) AS totalRecordedSeconds,
           COALESCE(SUM(CASE WHEN has_transcript = 1 THEN 1 ELSE 0 END), 0) AS totalTranscripts,
           COALESCE(SUM(
             CASE
               WHEN COALESCE(scheduled_at, created_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
               THEN 1 ELSE 0
             END
           ), 0) AS meetingsThisWeek
         FROM meetings
         WHERE organization_id = ? AND deleted_at IS NULL AND is_archived = 0`,
        [orgId]
      ),
      queryOne(
        `SELECT
           COUNT(*) AS totalActionItems,
           COALESCE(SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END), 0) AS pendingTasks
         FROM meeting_action_items
         WHERE organization_id = ? AND deleted_at IS NULL`,
        [orgId]
      ),
      query(
        `SELECT m.id, m.title, m.meeting_type AS meetingType, m.recording_source AS recordingSource,
                m.status, m.duration_seconds AS durationSeconds, m.speaker_count AS speakerCount,
                m.has_transcript AS hasTranscript, m.has_summary AS hasSummary,
                m.scheduled_at AS scheduledAt, m.created_at AS createdAt,
                u.full_name AS creatorName
         FROM meetings m
         INNER JOIN users u ON u.id = m.created_by
         WHERE m.organization_id = ? AND m.deleted_at IS NULL AND m.is_archived = 0
         ORDER BY COALESCE(m.started_at, m.scheduled_at, m.created_at) DESC
         LIMIT 5`,
        [orgId]
      ),
      query(
        `SELECT id, title, meeting_type AS meetingType, status, scheduled_at AS scheduledAt, description
         FROM meetings
         WHERE organization_id = ? AND deleted_at IS NULL AND is_archived = 0
           AND status = 'scheduled' AND scheduled_at >= UTC_TIMESTAMP()
         ORDER BY scheduled_at ASC
         LIMIT 5`,
        [orgId]
      ),
      query(
        `SELECT ms.id, ms.meeting_id AS meetingId, ms.detail_level AS detailLevel,
                ms.executive_summary AS executiveSummary, ms.created_at AS createdAt,
                m.title AS meetingTitle
         FROM meeting_summaries ms
         INNER JOIN meetings m ON m.id = ms.meeting_id
         WHERE ms.organization_id = ? AND m.deleted_at IS NULL
         ORDER BY ms.created_at DESC
         LIMIT 4`,
        [orgId]
      ),
      query(
        `SELECT ai.id, ai.meeting_id AS meetingId, ai.title, ai.assignee_name AS assigneeName,
                ai.due_date AS dueDate, ai.priority, ai.status, m.title AS meetingTitle
         FROM meeting_action_items ai
         INNER JOIN meetings m ON m.id = ai.meeting_id
         WHERE ai.organization_id = ? AND ai.deleted_at IS NULL AND m.deleted_at IS NULL
           AND ai.status IN ('pending', 'in_progress')
         ORDER BY FIELD(ai.priority, 'urgent', 'high', 'medium', 'low'), ai.due_date IS NULL, ai.due_date ASC
         LIMIT 6`,
        [orgId]
      ),
      query(
        `SELECT id, title, status, processing_progress AS processingProgress, updated_at AS updatedAt
         FROM meetings
         WHERE organization_id = ? AND deleted_at IS NULL
           AND status IN ('recording', 'uploading', 'queued', 'processing', 'failed')
         ORDER BY updated_at DESC
         LIMIT 5`,
        [orgId]
      ),
      query(
        `SELECT DATE(COALESCE(started_at, scheduled_at, created_at)) AS day,
                COUNT(*) AS meetingCount,
                ROUND(COALESCE(SUM(duration_seconds), 0) / 60, 1) AS totalMinutes
         FROM meetings
         WHERE organization_id = ? AND deleted_at IS NULL
           AND COALESCE(started_at, scheduled_at, created_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
         GROUP BY DATE(COALESCE(started_at, scheduled_at, created_at))
         ORDER BY day ASC`,
        [orgId]
      ),
      query(
        `SELECT meeting_type AS meetingType,
                COUNT(*) AS count,
                ROUND(COALESCE(SUM(duration_seconds), 0) / 60, 1) AS totalMinutes
         FROM meetings
         WHERE organization_id = ? AND deleted_at IS NULL AND is_archived = 0
         GROUP BY meeting_type`,
        [orgId]
      ),
    ]);

    res.json({
      stats: {
        totalMeetings: Number(meetingStats?.totalMeetings || 0),
        totalRecordedSeconds: Number(meetingStats?.totalRecordedSeconds || 0),
        totalTranscripts: Number(meetingStats?.totalTranscripts || 0),
        totalActionItems: Number(actionStats?.totalActionItems || 0),
        pendingTasks: Number(actionStats?.pendingTasks || 0),
        meetingsThisWeek: Number(meetingStats?.meetingsThisWeek || 0),
      },
      recentMeetings,
      upcomingMeetings,
      recentSummaries,
      outstandingActionItems,
      processingMeetings,
      charts: {
        activityLast14Days: activityRows,
        durationByType,
      },
    });
  })
);

export default router;

