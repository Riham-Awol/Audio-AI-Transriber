import { Router } from 'express';
import { query } from '../config/database.js';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const raw = String(req.query.q || '').trim();
    if (raw.length < 2) {
      return res.json({ meetings: [], actionItems: [] });
    }
    const pattern = `%${raw}%`;

    const [meetings, actionItems] = await Promise.all([
      query(
        `SELECT id, title, status, meeting_type AS meetingType,
                scheduled_at AS scheduledAt, created_at AS createdAt
         FROM meetings
         WHERE organization_id = ? AND deleted_at IS NULL
           AND (title LIKE ? OR description LIKE ?)
         ORDER BY COALESCE(scheduled_at, created_at) DESC
         LIMIT 8`,
        [req.organization.id, pattern, pattern]
      ),
      query(
        `SELECT ai.id, ai.meeting_id AS meetingId, ai.title, ai.status, ai.priority,
                m.title AS meetingTitle
         FROM meeting_action_items ai
         INNER JOIN meetings m ON m.id = ai.meeting_id
         WHERE ai.organization_id = ? AND ai.deleted_at IS NULL AND m.deleted_at IS NULL
           AND (ai.title LIKE ? OR ai.description LIKE ?)
         ORDER BY ai.created_at DESC
         LIMIT 6`,
        [req.organization.id, pattern, pattern]
      ),
    ]);

    res.json({ meetings, actionItems });
  })
);

export default router;

