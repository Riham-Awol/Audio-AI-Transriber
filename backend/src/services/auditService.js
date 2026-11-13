import crypto from 'node:crypto';
import { query } from '../config/database.js';

/**
 * Records an immutable security/activity audit event.
 */
export async function recordAuditLog({
  organizationId = null,
  userId = null,
  action,
  resourceType,
  resourceId = null,
  ipAddress = null,
  userAgent = null,
  metadata = null,
}) {
  try {
    await query(
      `INSERT INTO audit_logs (
        id, organization_id, user_id, action, resource_type,
        resource_id, ip_address, user_agent, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        organizationId,
        userId,
        action,
        resourceType,
        resourceId,
        ipAddress,
        userAgent ? String(userAgent).slice(0, 500) : null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    // Audit failures must not crash the request pipeline, but should be logged server-side.
    console.error('Audit log insert failed:', err.message);
  }
}

