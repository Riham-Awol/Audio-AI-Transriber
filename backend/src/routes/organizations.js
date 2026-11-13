import crypto from 'node:crypto';
import { Router } from 'express';
import { query, queryOne, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, requireOrganization, requireRole } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertEnum, assertValidUuid, isValidEmail } from '../middleware/validate.js';
import { recordAuditLog } from '../services/auditService.js';
import { sendMail } from '../services/mailService.js';
import { createOrganizationSlug, generateOpaqueToken, hashToken } from '../services/tokenService.js';

const router = Router();
const ORG_ROLES = ['org_admin', 'manager', 'member'];

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organizations = await query(
      `SELECT o.id, o.name, o.slug, o.industry, o.plan_tier AS planTier,
              o.default_vocabulary AS defaultVocabulary, om.role, o.created_at AS createdAt
       FROM organizations o
       INNER JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = ? AND om.status = 'active' AND o.deleted_at IS NULL
       ORDER BY om.created_at ASC`,
      [req.user.id]
    );
    res.json({ organizations });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, industry } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw new AppError(400, 'Organization name must be at least 2 characters.', 'VALIDATION_ERROR');
    }

    const orgId = crypto.randomUUID();
    const cleanName = name.trim().slice(0, 150);
    const slug = createOrganizationSlug(cleanName);

    await withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO organizations (id, name, slug, industry, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [orgId, cleanName, slug, industry ? String(industry).trim().slice(0, 100) : null, req.user.id]
      );
      await tx.execute(
        `INSERT INTO organization_members (id, organization_id, user_id, role, status)
         VALUES (?, ?, ?, 'org_admin', 'active')`,
        [crypto.randomUUID(), orgId, req.user.id]
      );
    });

    await recordAuditLog({
      organizationId: orgId,
      userId: req.user.id,
      action: 'organization.create',
      resourceType: 'organization',
      resourceId: orgId,
      ipAddress: req.ip,
    });

    res.status(201).json({
      organization: {
        id: orgId,
        name: cleanName,
        slug,
        industry: industry || null,
        planTier: 'starter',
        role: 'org_admin',
      },
    });
  })
);

router.patch(
  '/current',
  requireAuth,
  requireOrganization,
  requireRole('org_admin'),
  asyncHandler(async (req, res) => {
    const { name, industry, defaultVocabulary } = req.body || {};
    const updates = [];
    const params = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        throw new AppError(400, 'Organization name must be at least 2 characters.', 'VALIDATION_ERROR');
      }
      updates.push('name = ?');
      params.push(name.trim().slice(0, 150));
    }
    if (industry !== undefined) {
      updates.push('industry = ?');
      params.push(industry ? String(industry).trim().slice(0, 100) : null);
    }
    if (defaultVocabulary !== undefined) {
      if (!Array.isArray(defaultVocabulary)) {
        throw new AppError(400, 'defaultVocabulary must be an array of strings.', 'VALIDATION_ERROR');
      }
      updates.push('default_vocabulary = ?');
      params.push(
        JSON.stringify(
          defaultVocabulary
            .map((t) => String(t).trim())
            .filter(Boolean)
            .slice(0, 200)
        )
      );
    }

    if (updates.length > 0) {
      params.push(req.organization.id);
      await query(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne(
      `SELECT id, name, slug, industry, plan_tier AS planTier, default_vocabulary AS defaultVocabulary
       FROM organizations WHERE id = ?`,
      [req.organization.id]
    );
    res.json({ organization: { ...updated, role: req.organization.role } });
  })
);

router.get(
  '/current/members',
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const members = await query(
      `SELECT om.id AS memberId, om.user_id AS userId, om.role, om.status, om.joined_at AS joinedAt,
              u.email, u.full_name AS fullName, u.job_title AS jobTitle, u.avatar_url AS avatarUrl
       FROM organization_members om
       INNER JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = ? AND u.deleted_at IS NULL
       ORDER BY FIELD(om.role, 'org_admin', 'manager', 'member'), u.full_name ASC`,
      [req.organization.id]
    );

    const invitations = await query(
      `SELECT i.id, i.email, i.role, i.status, i.expires_at AS expiresAt, i.created_at AS createdAt,
              u.full_name AS invitedByName
       FROM organization_invitations i
       INNER JOIN users u ON u.id = i.invited_by
       WHERE i.organization_id = ? AND i.status = 'pending' AND i.expires_at > NOW()
       ORDER BY i.created_at DESC`,
      [req.organization.id]
    );

    res.json({ members, invitations });
  })
);

router.post(
  '/current/invitations',
  requireAuth,
  requireOrganization,
  requireRole('org_admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { email, role = 'member' } = req.body || {};
    if (!isValidEmail(email)) {
      throw new AppError(400, 'Valid email address is required.', 'VALIDATION_ERROR');
    }
    assertEnum(role, ORG_ROLES, 'role');

    if (role === 'org_admin' && req.organization.role !== 'org_admin' && !req.user.is_super_admin) {
      throw new AppError(403, 'Only organization admins can invite another admin.', 'FORBIDDEN');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingMember = await queryOne(
      `SELECT om.id FROM organization_members om
       INNER JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = ? AND u.email = ? AND om.status = 'active'`,
      [req.organization.id, normalizedEmail]
    );
    if (existingMember) {
      throw new AppError(409, 'This user is already an active member of your organization.', 'ALREADY_MEMBER');
    }

    const inviteToken = generateOpaqueToken(24);
    const inviteId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [inviteId, req.organization.id, normalizedEmail, role, hashToken(inviteToken), req.user.id, expiresAt]
    );

    const inviteUrl = `${env.frontendUrl}/invite/accept?token=${inviteToken}`;
    const mailResult = await sendMail({
      to: normalizedEmail,
      subject: `You're invited to ${req.organization.name} on VoxaMeet AI`,
      text: `${req.user.full_name} invited you to join ${req.organization.name} as ${role}.\nAccept invitation: ${inviteUrl}`,
      html: `<p><strong>${req.user.full_name}</strong> invited you to join <strong>${req.organization.name}</strong> as <em>${role}</em>.</p><p><a href="${inviteUrl}">Accept Invitation</a></p>`,
    });

    await recordAuditLog({
      organizationId: req.organization.id,
      userId: req.user.id,
      action: 'organization.invite',
      resourceType: 'organization_invitation',
      resourceId: inviteId,
      metadata: { email: normalizedEmail, role },
    });

    res.status(201).json({
      invitation: {
        id: inviteId,
        email: normalizedEmail,
        role,
        status: 'pending',
        expiresAt,
      },
      ...(mailResult.devLogged && !env.isProduction ? { devInviteToken: inviteToken } : {}),
    });
  })
);

router.post(
  '/invitations/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      throw new AppError(400, 'Invitation token is required.', 'VALIDATION_ERROR');
    }

    const invitation = await queryOne(
      `SELECT i.*, o.name AS organization_name
       FROM organization_invitations i
       INNER JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = ? AND i.status = 'pending' AND i.expires_at > NOW() AND o.deleted_at IS NULL`,
      [hashToken(token.trim())]
    );

    if (!invitation) {
      throw new AppError(400, 'Invitation token is invalid or has expired.', 'INVALID_TOKEN');
    }

    if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
      throw new AppError(
        403,
        `This invitation was sent to ${invitation.email}. Please sign in with that email address.`,
        'EMAIL_MISMATCH'
      );
    }

    await withTransaction(async (tx) => {
      const existing = await tx.queryOne(
        'SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ?',
        [invitation.organization_id, req.user.id]
      );

      if (existing) {
        await tx.execute(
          `UPDATE organization_members SET role = ?, status = 'active' WHERE id = ?`,
          [invitation.role, existing.id]
        );
      } else {
        await tx.execute(
          `INSERT INTO organization_members (id, organization_id, user_id, role, status)
           VALUES (?, ?, ?, ?, 'active')`,
          [crypto.randomUUID(), invitation.organization_id, req.user.id, invitation.role]
        );
      }

      await tx.execute(
        `UPDATE organization_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = ?`,
        [invitation.id]
      );
    });

    res.json({
      success: true,
      organizationId: invitation.organization_id,
      organizationName: invitation.organization_name,
      role: invitation.role,
    });
  })
);

router.delete(
  '/current/invitations/:invitationId',
  requireAuth,
  requireOrganization,
  requireRole('org_admin', 'manager'),
  asyncHandler(async (req, res) => {
    const invitationId = assertValidUuid(req.params.invitationId, 'invitationId');
    const result = await query(
      `UPDATE organization_invitations SET status = 'revoked'
       WHERE id = ? AND organization_id = ? AND status = 'pending'`,
      [invitationId, req.organization.id]
    );
    if (!result.affectedRows) {
      throw new AppError(404, 'Pending invitation not found.', 'NOT_FOUND');
    }
    res.json({ success: true });
  })
);

router.patch(
  '/current/members/:memberId',
  requireAuth,
  requireOrganization,
  requireRole('org_admin'),
  asyncHandler(async (req, res) => {
    const memberId = assertValidUuid(req.params.memberId, 'memberId');
    const { role, status } = req.body || {};

    const member = await queryOne(
      'SELECT * FROM organization_members WHERE id = ? AND organization_id = ?',
      [memberId, req.organization.id]
    );
    if (!member) {
      throw new AppError(404, 'Team member not found.', 'NOT_FOUND');
    }

    if (role !== undefined) {
      assertEnum(role, ORG_ROLES, 'role');
    }
    if (status !== undefined) {
      assertEnum(status, ['active', 'suspended'], 'status');
    }

    // Prevent removing/demoting the last active org_admin
    const demotingAdmin =
      member.role === 'org_admin' &&
      ((role && role !== 'org_admin') || status === 'suspended');
    if (demotingAdmin) {
      const adminCountRow = await queryOne(
        `SELECT COUNT(*) AS count FROM organization_members
         WHERE organization_id = ? AND role = 'org_admin' AND status = 'active'`,
        [req.organization.id]
      );
      if (Number(adminCountRow.count) <= 1) {
        throw new AppError(
          400,
          'Cannot demote or suspend the last active organization admin.',
          'LAST_ADMIN_GUARD'
        );
      }
    }

    await query(
      `UPDATE organization_members
       SET role = COALESCE(?, role), status = COALESCE(?, status)
       WHERE id = ? AND organization_id = ?`,
      [role || null, status || null, memberId, req.organization.id]
    );

    res.json({ success: true });
  })
);

router.delete(
  '/current/members/:memberId',
  requireAuth,
  requireOrganization,
  requireRole('org_admin'),
  asyncHandler(async (req, res) => {
    const memberId = assertValidUuid(req.params.memberId, 'memberId');
    const member = await queryOne(
      'SELECT * FROM organization_members WHERE id = ? AND organization_id = ?',
      [memberId, req.organization.id]
    );
    if (!member) {
      throw new AppError(404, 'Team member not found.', 'NOT_FOUND');
    }

    if (member.role === 'org_admin') {
      const adminCountRow = await queryOne(
        `SELECT COUNT(*) AS count FROM organization_members
         WHERE organization_id = ? AND role = 'org_admin' AND status = 'active'`,
        [req.organization.id]
      );
      if (Number(adminCountRow.count) <= 1) {
        throw new AppError(400, 'Cannot remove the last active organization admin.', 'LAST_ADMIN_GUARD');
      }
    }

    await query('DELETE FROM organization_members WHERE id = ? AND organization_id = ?', [
      memberId,
      req.organization.id,
    ]);

    res.json({ success: true });
  })
);

export default router;

