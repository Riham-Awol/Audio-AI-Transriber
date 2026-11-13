import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generates a cryptographically strong random hex token.
 */
export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Computes a deterministic SHA-256 hex digest for storing tokens safely at rest.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Signs a short-lived JWT access token.
 */
export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      isSuperAdmin: Boolean(user.is_super_admin),
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn }
  );
}

/**
 * Signs a JWT refresh token bound to a session ID.
 */
export function signRefreshToken(userId, sessionId) {
  return jwt.sign(
    {
      sub: userId,
      sid: sessionId,
      type: 'refresh',
    },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiresIn }
  );
}

/**
 * Verifies an access token and returns decoded claims.
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

/**
 * Verifies a refresh token and returns decoded claims.
 */
export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

/**
 * Converts an organization name into a clean URL-safe slug with a short random suffix.
 */
export function createOrganizationSlug(name) {
  const base = String(name || 'organization')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'organization';
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

