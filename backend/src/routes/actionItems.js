import crypto from 'node:crypto';
import { Router } from 'express';
import { query, queryOne } from '../config/database.js';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertEnum, assertValidUuid } from '../middleware/validate.js';
import { integrationService } from '../services/integrationService.js';

const router = Router();
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

router.get(
  '/',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const { status, priority, meetingId } = req.query;
    const conditions = ['ai.organization_id = ?', 'ai.deleted_at IS NULL', 'm.deleted_at IS NULL'];
    const params = [req.organization.id];

    if (status && status !== 'all') {
      assertEnum(status, STATUSES, 'status');
      conditions.push('ai.status = ?');
      params.push(status);
    }
    if (priority && priority !== 'all') {
      assertEnum(priority, PRIORITIES, 'priority');
      conditions.push('ai.priority = ?');
      params.push(priority);
    }
    if (meetingId) {
      assertValidUuid(meetingId, 'meetingId');
      conditions.push('ai.meeting_id = ?');
      params.push(meetingId);
    }

    const items = await query(
      `SELECT ai.id, ai.meeting_id AS meetingId, ai.title, ai.description,
              ai.assignee_user_id AS assigneeUserId, ai.assignee_name AS assigneeName,
              ai.due_date AS dueDate, ai.priority, ai.status,
              ai.source_timestamp_ms AS sourceTimestampMs, ai.created_at AS createdAt,
              m.title AS meetingTitle
       FROM meeting_action_items ai
       INNER JOIN meetings m ON m.id = ai.meeting_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY FIELD(ai.status, 'in_progress', 'pending', 'completed', 'cancelled'),
                FIELD(ai.priority, 'urgent', 'high', 'medium', 'low'),
                ai.created_at DESC
       LIMIT 100`,
      params
    );

    res.json({ actionItems: items });
  })
);

router.post(
  '/',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const {
      meetingId,
      title,
      description = '',
      assigneeName = null,
      assigneeUserId = null,
      dueDate = null,
      priority = 'medium',
    } = req.body || {};

    assertValidUuid(meetingId, 'meetingId');
    if (!title || typeof title !== 'string' || title.trim().length < 2) {
      throw new AppError(400, 'Action item title must be at least 2 characters.', 'VALIDATION_ERROR');
    }
    assertEnum(priority, PRIORITIES, 'priority');

    const meeting = await queryOne(
      'SELECT id FROM meetings WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [meetingId, req.organization.id]
    );
    if (!meeting) {
      throw new AppError(404, 'Meeting not found.', 'NOT_FOUND');
    }

    if (assigneeUserId) {
      assertValidUuid(assigneeUserId, 'assigneeUserId');
    }

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO meeting_action_items (
        id, organization_id, meeting_id, assignee_user_id, assignee_name,
        title, description, due_date, priority, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        id,
        req.organization.id,
        meetingId,
        assigneeUserId || null,
        assigneeName ? String(assigneeName).trim().slice(0, 150) : null,
        title.trim().slice(0, 255),
        description ? String(description).trim() : null,
        dueDate || null,
        priority,
      ]
    );

    const created = await queryOne(
      `SELECT id, meeting_id AS meetingId, title, description,
              assignee_user_id AS assigneeUserId, assignee_name AS assigneeName,
              due_date AS dueDate, priority, status, created_at AS createdAt
       FROM meeting_action_items WHERE id = ?`,
      [id]
    );

    res.status(201).json({ actionItem: created });
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const id = assertValidUuid(req.params.id, 'actionItemId');
    const existing = await queryOne(
      'SELECT id FROM meeting_action_items WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, req.organization.id]
    );
    if (!existing) {
      throw new AppError(404, 'Action item not found.', 'NOT_FOUND');
    }

    const { title, description, assigneeName, dueDate, priority, status } = req.body || {};
    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(String(title).trim().slice(0, 255));
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? String(description).trim() : null);
    }
    if (assigneeName !== undefined) {
      updates.push('assignee_name = ?');
      params.push(assigneeName ? String(assigneeName).trim().slice(0, 150) : null);
    }
    if (dueDate !== undefined) {
      updates.push('due_date = ?');
      params.push(dueDate || null);
    }
    if (priority !== undefined) {
      assertEnum(priority, PRIORITIES, 'priority');
      updates.push('priority = ?');
      params.push(priority);
    }
    if (status !== undefined) {
      assertEnum(status, STATUSES, 'status');
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length > 0) {
      params.push(id, req.organization.id);
      await query(
        `UPDATE meeting_action_items SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`,
        params
      );
    }

    const updated = await queryOne(
      `SELECT id, meeting_id AS meetingId, title, description,
              assignee_user_id AS assigneeUserId, assignee_name AS assigneeName,
              due_date AS dueDate, priority, status, created_at AS createdAt
       FROM meeting_action_items WHERE id = ?`,
      [id]
    );
    res.json({ actionItem: updated });
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const id = assertValidUuid(req.params.id, 'actionItemId');
    const result = await query(
      'UPDATE meeting_action_items SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, req.organization.id]
    );
    if (!result.affectedRows) {
      throw new AppError(404, 'Action item not found.', 'NOT_FOUND');
    }
    res.json({ success: true });
  })
);

router.post(
  '/:id/export-jira',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const id = assertValidUuid(req.params.id, 'actionItemId');
    const { projectKey = 'VOXA', issueType = 'Task' } = req.body || {};

    const result = await integrationService.exportActionItemToJira(
      req.organization.id,
      id,
      { projectKey, issueType }
    );

    res.json(result);
  })
);

export default router;

