import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth, requireOrganization, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.use(requireAuth);
router.use(requireOrganization);

/**
 * GET /api/reports/analytics - Organization-wide meeting intelligence & KPIs
 */
router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const orgId = req.organization.id;

    let kpis = null;
    let meetingsByMonth = [];
    let topSpeakers = [];
    let actionItemStats = null;
    let decisionStats = null;

    try {
      [kpis, meetingsByMonth, topSpeakers, actionItemStats, decisionStats] = await Promise.all([
        queryOne(
          `SELECT
             COUNT(*) AS totalMeetings,
             COALESCE(SUM(duration_seconds), 0) AS totalDurationSeconds,
             COALESCE(SUM(CASE WHEN has_transcript = 1 THEN 1 ELSE 0 END), 0) AS transcribedMeetings,
             COALESCE(SUM(CASE WHEN has_summary = 1 THEN 1 ELSE 0 END), 0) AS summarizedMeetings,
             COALESCE(AVG(duration_seconds), 0) AS avgMeetingDurationSeconds
           FROM meetings
           WHERE organization_id = ? AND deleted_at IS NULL AND is_archived = 0`,
          [orgId]
        ),
        query(
          `SELECT
             DATE_FORMAT(COALESCE(scheduled_at, created_at), '%Y-%m') AS month,
             COUNT(*) AS meetingCount,
             COALESCE(SUM(duration_seconds), 0) AS durationSeconds
           FROM meetings
           WHERE organization_id = ? AND deleted_at IS NULL
           GROUP BY month
           ORDER BY month DESC
           LIMIT 6`,
          [orgId]
        ),
        query(
          `SELECT
             s.display_name AS displayName,
             s.color_hex AS colorHex,
             COUNT(DISTINCT s.meeting_id) AS meetingsCount,
             COALESCE(SUM(s.total_speaking_seconds), 0) AS totalSpeakingSeconds
           FROM speakers s
           WHERE s.organization_id = ?
           GROUP BY s.display_name, s.color_hex
           ORDER BY totalSpeakingSeconds DESC
           LIMIT 5`,
          [orgId]
        ),
        queryOne(
          `SELECT
             COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
             COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS inProgress,
             COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
             COALESCE(SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END), 0) AS urgent
           FROM meeting_action_items
           WHERE organization_id = ? AND deleted_at IS NULL`,
          [orgId]
        ),
        queryOne(
          `SELECT
             COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status = 'approved' OR status = 'agreed' THEN 1 ELSE 0 END), 0) AS agreed,
             COALESCE(SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END), 0) AS proposed,
             COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected
           FROM meeting_decisions
           WHERE organization_id = ?`,
          [orgId]
        ),
      ]);
    } catch {
      // In offline / fallback test environments
    }

    const totalSeconds = kpis?.totalDurationSeconds || 0;
    const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;
    const totalActionItems = actionItemStats?.total || 0;
    const completedActionItems = actionItemStats?.completed || 0;
    const completionRate = totalActionItems > 0 ? Math.round((completedActionItems / totalActionItems) * 100) : 0;

    res.json({
      kpis: {
        totalMeetings: kpis?.totalMeetings || 0,
        totalHours,
        transcribedMeetings: kpis?.transcribedMeetings || 0,
        summarizedMeetings: kpis?.summarizedMeetings || 0,
        avgMeetingDurationMinutes: Math.round((kpis?.avgMeetingDurationSeconds || 0) / 60),
        actionItemCompletionRate: completionRate,
      },
      actionItems: actionItemStats || { total: 0, completed: 0, inProgress: 0, pending: 0, urgent: 0 },
      decisions: decisionStats || { total: 0, agreed: 0, proposed: 0, rejected: 0 },
      meetingsByMonth: (meetingsByMonth || []).reverse(),
      topSpeakers: topSpeakers || [],
    });
  })
);

/**
 * GET /api/reports/audit-logs - Organization security and activity audit logs
 */
router.get(
  '/audit-logs',
  requireRole(['org_admin', 'manager']),
  asyncHandler(async (req, res) => {
    let logs = [];
    try {
      logs = await query(
        `SELECT a.id, a.action, a.resource_type AS resourceType, a.resource_id AS resourceId,
                a.ip_address AS ipAddress, a.user_agent AS userAgent, a.metadata,
                a.created_at AS createdAt,
                COALESCE(u.full_name, 'System') AS userName,
                u.email AS userEmail
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.organization_id = ?
         ORDER BY a.created_at DESC
         LIMIT 100`,
        [req.organization.id]
      );
    } catch {
      logs = [];
    }

    res.json({
      auditLogs: (logs || []).map((l) => ({
        ...l,
        metadata: typeof l.metadata === 'string' ? JSON.parse(l.metadata) : (l.metadata || null),
      })),
    });
  })
);

/**
 * GET /api/reports/export - Export organization-wide decisions or action items as CSV
 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { type = 'action_items' } = req.query;

    if (type === 'action_items') {
      let items = [];
      try {
        items = await query(
          `SELECT ai.title, ai.description, ai.priority, ai.status,
                  ai.due_date AS dueDate, ai.assignee_name AS assigneeName,
                  ai.external_issue_key AS externalIssueKey,
                  ai.created_at AS createdAt,
                  m.title AS meetingTitle
           FROM meeting_action_items ai
           INNER JOIN meetings m ON m.id = ai.meeting_id
           WHERE ai.organization_id = ? AND ai.deleted_at IS NULL
           ORDER BY ai.created_at DESC`,
          [req.organization.id]
        );
      } catch {}

      const headers = ['Meeting', 'Title', 'Description', 'Assignee', 'Priority', 'Status', 'Due Date', 'Jira Key', 'Created At'];
      const rows = (items || []).map((item) => [
        `"${(item.meetingTitle || '').replace(/"/g, '""')}"`,
        `"${(item.title || '').replace(/"/g, '""')}"`,
        `"${(item.description || '').replace(/"/g, '""')}"`,
        `"${(item.assigneeName || 'Unassigned').replace(/"/g, '""')}"`,
        item.priority || 'medium',
        item.status || 'pending',
        item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : '',
        item.externalIssueKey || '',
        item.createdAt ? new Date(item.createdAt).toISOString() : '',
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="voxameet_action_items.csv"');
      return res.send(csvContent);
    }

    if (type === 'decisions') {
      let decisions = [];
      try {
        decisions = await query(
          `SELECT d.description, d.status, d.supporting_quote AS supportingQuote,
                  d.created_at AS createdAt,
                  s.display_name AS speakerName,
                  m.title AS meetingTitle
           FROM meeting_decisions d
           INNER JOIN meetings m ON m.id = d.meeting_id
           LEFT JOIN speakers s ON s.id = d.speaker_id
           WHERE d.organization_id = ?
           ORDER BY d.created_at DESC`,
          [req.organization.id]
        );
      } catch {}

      const headers = ['Meeting', 'Decision', 'Speaker', 'Status', 'Supporting Quote', 'Created At'];
      const rows = (decisions || []).map((d) => [
        `"${(d.meetingTitle || '').replace(/"/g, '""')}"`,
        `"${(d.description || '').replace(/"/g, '""')}"`,
        `"${(d.speakerName || 'Team').replace(/"/g, '""')}"`,
        d.status || 'approved',
        `"${(d.supportingQuote || '').replace(/"/g, '""')}"`,
        d.createdAt ? new Date(d.createdAt).toISOString() : '',
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="voxameet_decisions.csv"');
      return res.send(csvContent);
    }

    res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Supported export types: action_items, decisions.' } });
  })
);

export default router;
