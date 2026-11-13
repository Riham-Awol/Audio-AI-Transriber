import { query, queryOne } from '../config/database.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { AppError } from './errorHandler.js';
import { isValidUuid } from './validate.js';

export const ROLE_PRIORITY = {
  member: 1,
  manager: 2,
  org_admin: 3,
  super_admin: 4,
};

/**
 * Verifies Bearer JWT access token and loads the active user record.
 */
export async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing authorization token.', 'UNAUTHORIZED');
    }

    const token = authHeader.slice(7).trim();
    const decoded = verifyAccessToken(token);

    const user = await queryOne(
      `SELECT id, email, full_name, avatar_url, job_title, timezone,
              is_super_admin, email_verified, is_active, last_login_at, created_at
       FROM users
       WHERE id = ? AND deleted_at IS NULL`,
      [decoded.sub]
    );

    if (!user || !user.is_active) {
      throw new AppError(401, 'Account is inactive or no longer exists.', 'UNAUTHORIZED');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Resolves and verifies the active organization context from X-Organization-Id
 * (or falls back to the user's primary organization) to guarantee strict tenant isolation.
 */
export async function requireOrganization(req, _res, next) {
  try {
    const requestedOrgId = req.headers['x-organization-id'];
    let membership = null;

    if (requestedOrgId) {
      if (!isValidUuid(String(requestedOrgId))) {
        throw new AppError(400, 'Invalid X-Organization-Id header.', 'VALIDATION_ERROR');
      }
      membership = await queryOne(
        `SELECT o.id, o.name, o.slug, o.industry, o.plan_tier, o.default_vocabulary,
                om.role, om.status
         FROM organizations o
         INNER JOIN organization_members om ON om.organization_id = o.id
         WHERE o.id = ? AND om.user_id = ? AND om.status = 'active' AND o.deleted_at IS NULL`,
        [String(requestedOrgId).trim(), req.user.id]
      );
      if (!membership) {
        throw new AppError(
          403,
          'You do not have access to the requested organization.',
          'ORG_ACCESS_DENIED'
        );
      }
    } else {
      const memberships = await query(
        `SELECT o.id, o.name, o.slug, o.industry, o.plan_tier, o.default_vocabulary,
                om.role, om.status
         FROM organizations o
         INNER JOIN organization_members om ON om.organization_id = o.id
         WHERE om.user_id = ? AND om.status = 'active' AND o.deleted_at IS NULL
         ORDER BY om.created_at ASC
         LIMIT 1`,
        [req.user.id]
      );
      membership = memberships[0] || null;
      if (!membership) {
        throw new AppError(
          403,
          'No active organization membership found. Create or join an organization first.',
          'NO_ORGANIZATION'
        );
      }
    }

    req.organization = {
      id: membership.id,
      name: membership.name,
      slug: membership.slug,
      industry: membership.industry,
      planTier: membership.plan_tier,
      defaultVocabulary: membership.default_vocabulary || [],
      role: req.user.is_super_admin ? 'super_admin' : membership.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Enforces role-based access control for the active organization.
 */
export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (req.user?.is_super_admin) {
      return next();
    }
    const currentRole = req.organization?.role;
    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return next(
        new AppError(
          403,
          'You do not have sufficient permissions for this operation.',
          'FORBIDDEN'
        )
      );
    }
    return next();
  };
}

