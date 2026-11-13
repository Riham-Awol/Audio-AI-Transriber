import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function requireSecret(name, devFallback) {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value.trim();
  }
  if (isProduction) {
    throw new Error(`Missing required environment variable in production: ${name}`);
  }
  return devFallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  backendPublicUrl:
    process.env.BACKEND_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 4000}`,
  allowedOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'meeting_intelligence',
    user: process.env.DB_USER || 'meeting_app',
    password: process.env.DB_PASSWORD ?? 'meeting_app_password',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 15),
  },

  jwt: {
    accessSecret: requireSecret(
      'JWT_ACCESS_SECRET',
      'dev-only-access-secret-do-not-use-in-production-32bytes'
    ),
    refreshSecret: requireSecret(
      'JWT_REFRESH_SECRET',
      'dev-only-refresh-secret-do-not-use-in-production-32bytes'
    ),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    localDir: path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || 'uploads'),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024,
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || 'meeting-recordings',
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    },
  },

  redis: {
    url: process.env.REDIS_URL || '',
  },

  ai: {
    serviceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
    apiKey: requireSecret('AI_SERVICE_API_KEY', 'dev-ai-service-secret-change-me'),
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'VoxaMeet AI <no-reply@voxameet.local>',
  },
};
