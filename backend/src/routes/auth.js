import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { query, queryOne, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertValidUuid, isValidEmail, validatePassword } from '../middleware/validate.js';
import { recordAuditLog } from '../services/auditService.js';
import { sendMail } from '../services/mailService.js';
import {
  createOrganizationSlug,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/tokenService.js';

const router = Router();

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    avatarUrl: user.avatar_url || null,
    jobTitle: user.job_title || '',
    timezone: user.timezone || 'UTC',
    isSuperAdmin: Boolean(user.is_super_admin),
    emailVerified: Boolean(user.email_verified),
    lastLoginAt: user.last_login_at || null,
    createdAt: user.created_at,
  };
}

async function getUserOrganizations(userId) {
  return query(
    `SELECT o.id, o.name, o.slug, o.industry, o.plan_tier AS planTier, om.role
     FROM organizations o
     INNER JOIN organization_members om ON om.organization_id = o.id
     WHERE om.user_id = ? AND om.status = 'active' AND o.deleted_at IS NULL
     ORDER BY om.created_at ASC`,
    [userId]
  );
}

async function createSessionTokens(txOrDb, user, req) {
  const sessionId = crypto.randomUUID();
  const refreshToken = signRefreshToken(user.id, sessionId);
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const exec = txOrDb.execute ? txOrDb.execute : query;
  await exec(
    `INSERT INTO user_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      user.id,
      refreshHash,
      req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null,
      req.ip || null,
      expiresAt,
    ]
  );

  const accessToken = signAccessToken(user);
  return { accessToken, refreshToken, sessionId };
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, fullName, organizationName, jobTitle, timezone } = req.body || {};

    if (!isValidEmail(email)) {
      throw new AppError(400, 'Please enter a valid email address.', 'VALIDATION_ERROR');
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      throw new AppError(400, 'Full name must be at least 2 characters.', 'VALIDATION_ERROR');
    }
    const pwdError = validatePassword(password);
    if (pwdError) {
      throw new AppError(400, pwdError, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      throw new AppError(409, 'An account with this email already exists.', 'EMAIL_EXISTS');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = generateOpaqueToken(24);
    const verificationHash = hashToken(verificationToken);
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const userId = crypto.randomUUID();
    const orgName =
      organizationName && String(organizationName).trim().length >= 2
        ? String(organizationName).trim().slice(0, 150)
        : `${fullName.trim().split(' ')[0]}'s Workspace`;
    const orgId = crypto.randomUUID();

    const { accessToken, refreshToken } = await withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO users (
          id, email, password_hash, full_name, job_title, timezone,
          email_verified, email_verification_token_hash, email_verification_expires_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NOW())`,
        [
          userId,
          normalizedEmail,
          passwordHash,
          fullName.trim().slice(0, 150),
          jobTitle ? String(jobTitle).trim().slice(0, 120) : null,
          timezone ? String(timezone).trim().slice(0, 64) : 'UTC',
          verificationHash,
          verificationExpires,
        ]
      );

      await tx.execute(
        `INSERT INTO organizations (id, name, slug, created_by)
         VALUES (?, ?, ?, ?)`,
        [orgId, orgName, createOrganizationSlug(orgName), userId]
      );

      await tx.execute(
        `INSERT INTO organization_members (id, organization_id, user_id, role, status)
         VALUES (?, ?, ?, 'org_admin', 'active')`,
        [crypto.randomUUID(), orgId, userId]
      );

      return createSessionTokens(
        tx,
        { id: userId, email: normalizedEmail, is_super_admin: 0 },
        req
      );
    });

    const verifyUrl = `${env.frontendUrl}/verify-email?token=${verificationToken}`;
    const mailResult = await sendMail({
      to: normalizedEmail,
      subject: 'Verify your VoxaMeet AI email address',
      text: `Welcome to VoxaMeet AI!\n\nVerify your email by opening: ${verifyUrl}\nThis link expires in 24 hours.`,
      html: `<p>Welcome to <strong>VoxaMeet AI</strong>!</p><p>Verify your email by clicking <a href="${verifyUrl}">Verify Email</a>.</p>`,
    });

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    const organizations = await getUserOrganizations(userId);

    await recordAuditLog({
      organizationId: orgId,
      userId,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
      organizations,
      ...(mailResult.devLogged && !env.isProduction ? { devVerificationToken: verificationToken } : {}),
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
      throw new AppError(400, 'Email and password are required.', 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await queryOne(
      'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL',
      [normalizedEmail]
    );

    if (!user || !user.is_active) {
      throw new AppError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new AppError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    const { accessToken, refreshToken } = await createSessionTokens({}, user, req);
    const organizations = await getUserOrganizations(user.id);

    await recordAuditLog({
      organizationId: organizations[0]?.id || null,
      userId: user.id,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      accessToken,
      refreshToken,
      user: sanitizeUser({ ...user, last_login_at: new Date().toISOString() }),
      organizations,
    });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new AppError(400, 'Refresh token is required.', 'VALIDATION_ERROR');
    }

    const decoded = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const session = await queryOne(
      `SELECT * FROM user_sessions
       WHERE id = ? AND user_id = ? AND refresh_token_hash = ?
         AND revoked_at IS NULL AND expires_at > NOW()`,
      [decoded.sid, decoded.sub, tokenHash]
    );

    if (!session) {
      throw new AppError(401, 'Session expired or revoked. Please sign in again.', 'INVALID_SESSION');
    }

    const user = await queryOne(
      'SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL',
      [decoded.sub]
    );
    if (!user) {
      throw new AppError(401, 'User account not active.', 'UNAUTHORIZED');
    }

    const nextRefreshToken = signRefreshToken(user.id, session.id);
    const nextRefreshHash = hashToken(nextRefreshToken);
    const nextExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      `UPDATE user_sessions
       SET refresh_token_hash = ?, expires_at = ?, last_active_at = NOW()
       WHERE id = ?`,
      [nextRefreshHash, nextExpiry, session.id]
    );

    const accessToken = signAccessToken(user);
    res.json({ accessToken, refreshToken: nextRefreshToken });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (refreshToken && typeof refreshToken === 'string') {
      await query(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE refresh_token_hash = ? AND revoked_at IS NULL',
        [hashToken(refreshToken)]
      );
    }
    res.json({ success: true });
  })
);

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      throw new AppError(400, 'Verification token is required.', 'VALIDATION_ERROR');
    }

    const tokenDigest = hashToken(token.trim());
    const user = await queryOne(
      `SELECT id FROM users
       WHERE email_verification_token_hash = ?
         AND email_verification_expires_at > NOW()
         AND deleted_at IS NULL`,
      [tokenDigest]
    );

    if (!user) {
      throw new AppError(400, 'Verification token is invalid or has expired.', 'INVALID_TOKEN');
    }

    await query(
      `UPDATE users
       SET email_verified = 1,
           email_verification_token_hash = NULL,
           email_verification_expires_at = NULL
       WHERE id = ?`,
      [user.id]
    );

    res.json({ success: true, message: 'Email address verified successfully.' });
  })
);

router.post(
  '/resend-verification',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.email_verified) {
      return res.json({ success: true, message: 'Email is already verified.' });
    }

    const token = generateOpaqueToken(24);
    await query(
      `UPDATE users
       SET email_verification_token_hash = ?,
           email_verification_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR)
       WHERE id = ?`,
      [hashToken(token), req.user.id]
    );

    const verifyUrl = `${env.frontendUrl}/verify-email?token=${token}`;
    const mailResult = await sendMail({
      to: req.user.email,
      subject: 'Verify your VoxaMeet AI email address',
      text: `Verify your email: ${verifyUrl}`,
      html: `<p>Verify your email by clicking <a href="${verifyUrl}">Verify Email</a>.</p>`,
    });

    res.json({
      success: true,
      message: 'Verification email sent.',
      ...(mailResult.devLogged && !env.isProduction ? { devVerificationToken: token } : {}),
    });
  })
);

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    if (!isValidEmail(email)) {
      throw new AppError(400, 'Please provide a valid email address.', 'VALIDATION_ERROR');
    }

    const user = await queryOne(
      'SELECT id, email FROM users WHERE email = ? AND is_active = 1 AND deleted_at IS NULL',
      [email.trim().toLowerCase()]
    );

    let devResetToken = null;
    if (user) {
      const resetToken = generateOpaqueToken(24);
      await query(
        `UPDATE users
         SET password_reset_token_hash = ?,
             password_reset_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR)
         WHERE id = ?`,
        [hashToken(resetToken), user.id]
      );

      const resetUrl = `${env.frontendUrl}/reset-password?token=${resetToken}`;
      const mailResult = await sendMail({
        to: user.email,
        subject: 'VoxaMeet AI Password Reset',
        text: `Reset your password by opening: ${resetUrl}\nThis link expires in 1 hour.`,
        html: `<p>Click <a href="${resetUrl}">Reset Password</a> to set a new password. Link expires in 1 hour.</p>`,
      });
      if (mailResult.devLogged && !env.isProduction) {
        devResetToken = resetToken;
      }
    }

    res.json({
      success: true,
      message: 'If an account matches that email, a password reset link has been sent.',
      ...(devResetToken ? { devResetToken } : {}),
    });
  })
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || typeof token !== 'string') {
      throw new AppError(400, 'Reset token is required.', 'VALIDATION_ERROR');
    }
    const pwdError = validatePassword(newPassword);
    if (pwdError) {
      throw new AppError(400, pwdError, 'VALIDATION_ERROR');
    }

    const user = await queryOne(
      `SELECT id FROM users
       WHERE password_reset_token_hash = ?
         AND password_reset_expires_at > NOW()
         AND deleted_at IS NULL`,
      [hashToken(token.trim())]
    );

    if (!user) {
      throw new AppError(400, 'Reset token is invalid or expired.', 'INVALID_TOKEN');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE users
         SET password_hash = ?,
             password_reset_token_hash = NULL,
             password_reset_expires_at = NULL
         WHERE id = ?`,
        [passwordHash, user.id]
      );
      await tx.execute(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [user.id]
      );
    });

    res.json({ success: true, message: 'Password updated. Please sign in with your new password.' });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const organizations = await getUserOrganizations(req.user.id);
    res.json({
      user: sanitizeUser(req.user),
      organizations,
    });
  })
);

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { fullName, jobTitle, timezone, currentPassword, newPassword } = req.body || {};

    if (newPassword !== undefined) {
      if (!currentPassword) {
        throw new AppError(400, 'Current password is required to change password.', 'VALIDATION_ERROR');
      }
      const pwdRow = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
      const ok = await bcrypt.compare(currentPassword, pwdRow.password_hash);
      if (!ok) {
        throw new AppError(401, 'Current password is incorrect.', 'INVALID_CREDENTIALS');
      }
      const pwdErr = validatePassword(newPassword);
      if (pwdErr) {
        throw new AppError(400, pwdErr, 'VALIDATION_ERROR');
      }
      const nextHash = await bcrypt.hash(newPassword, 12);
      await query('UPDATE users SET password_hash = ? WHERE id = ?', [nextHash, req.user.id]);
    }

    const updates = [];
    const params = [];
    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        throw new AppError(400, 'Full name must be at least 2 characters.', 'VALIDATION_ERROR');
      }
      updates.push('full_name = ?');
      params.push(fullName.trim().slice(0, 150));
    }
    if (jobTitle !== undefined) {
      updates.push('job_title = ?');
      params.push(jobTitle ? String(jobTitle).trim().slice(0, 120) : null);
    }
    if (timezone !== undefined) {
      updates.push('timezone = ?');
      params.push(String(timezone).trim().slice(0, 64) || 'UTC');
    }

    if (updates.length > 0) {
      params.push(req.user.id);
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: sanitizeUser(updated) });
  })
);

router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await query(
      `SELECT id, user_agent AS userAgent, ip_address AS ipAddress,
              last_active_at AS lastActiveAt, expires_at AS expiresAt, created_at AS createdAt
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_active_at DESC`,
      [req.user.id]
    );
    res.json({ sessions });
  })
);

router.delete(
  '/sessions/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = assertValidUuid(req.params.sessionId, 'sessionId');
    const result = await query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      [sessionId, req.user.id]
    );
    if (!result.affectedRows) {
      throw new AppError(404, 'Active session not found.', 'NOT_FOUND');
    }
    res.json({ success: true });
  })
);

export default router;

