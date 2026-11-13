import { Router } from 'express';
import { query } from '../config/database.js';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { assertValidUuid } from '../middleware/validate.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const notifications = await query(
      `SELECT id, type, title, message, entity_type AS entityType, entity_id AS entityId,
              is_read AS isRead, read_at AS readAt, created_at AS createdAt
       FROM notifications
       WHERE organization_id = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.organization.id, req.user.id]
    );
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    res.json({ notifications, unreadCount });
  })
);

router.patch(
  '/:id/read',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const id = assertValidUuid(req.params.id, 'notificationId');
    await query(
      `UPDATE notifications
       SET is_read = 1, read_at = NOW()
       WHERE id = ? AND organization_id = ? AND user_id = ?`,
      [id, req.organization.id, req.user.id]
    );
    res.json({ success: true });
  })
);

router.post(
  '/read-all',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    await query(
      `UPDATE notifications
       SET is_read = 1, read_at = NOW()
       WHERE organization_id = ? AND user_id = ? AND is_read = 0`,
      [req.organization.id, req.user.id]
    );
    res.json({ success: true });
  })
);

export default router;

