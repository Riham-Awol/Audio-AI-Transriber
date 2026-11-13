import { AppError } from './errorHandler.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim()) && email.trim().length <= 255;
}

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function assertValidUuid(value, fieldName = 'id') {
  if (!isValidUuid(value)) {
    throw new AppError(400, `Invalid ${fieldName} format.`, 'VALIDATION_ERROR');
  }
  return value.trim();
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password must be between 8 and 128 characters.';
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, and numeric characters.';
  }
  return null;
}

export function assertEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new AppError(
      400,
      `Invalid ${fieldName}. Allowed values: ${allowed.join(', ')}.`,
      'VALIDATION_ERROR'
    );
  }
  return value;
}

export function parsePagination(queryObj) {
  const page = Math.max(1, Number.parseInt(queryObj.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(queryObj.limit || '20', 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

