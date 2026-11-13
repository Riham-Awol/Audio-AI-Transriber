import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

let s3Client = null;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.storage.s3.region,
      ...(env.storage.s3.endpoint ? { endpoint: env.storage.s3.endpoint } : {}),
      forcePathStyle: env.storage.s3.forcePathStyle,
      credentials: {
        accessKeyId: env.storage.s3.accessKey,
        secretAccessKey: env.storage.s3.secretKey,
      },
    });
  }
  return s3Client;
}

export function isS3Configured() {
  return (
    env.storage.provider === 's3' &&
    Boolean(env.storage.s3.bucket) &&
    Boolean(env.storage.s3.accessKey) &&
    Boolean(env.storage.s3.secretKey)
  );
}

/**
 * Resolves a storage key safely inside the local uploads root (prevents path traversal).
 */
export function resolveLocalStoragePath(storageKey) {
  const cleanKey = String(storageKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(env.storage.localDir, cleanKey);
  const root = path.resolve(env.storage.localDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Invalid storage key path.');
  }
  return resolved;
}

/**
 * Persists an uploaded temporary file into S3-compatible object storage or local disk storage.
 */
export async function saveRecordingFile({ tempFilePath, storageKey, mimeType }) {
  if (isS3Configured()) {
    const stream = fs.createReadStream(tempFilePath);
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.storage.s3.bucket,
        Key: storageKey,
        Body: stream,
        ContentType: mimeType,
      })
    );
    await fsp.unlink(tempFilePath).catch(() => {});
    return { provider: env.storage.s3.endpoint ? 'minio' : 's3', storageKey };
  }

  const destPath = resolveLocalStoragePath(storageKey);
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.rename(tempFilePath, destPath).catch(async () => {
    await fsp.copyFile(tempFilePath, destPath);
    await fsp.unlink(tempFilePath).catch(() => {});
  });
  return { provider: 'local', storageKey };
}

/**
 * Deletes a recording object from S3 or local storage.
 */
export async function deleteRecordingFile(provider, storageKey) {
  if (!storageKey) return;
  if (provider === 's3' || provider === 'minio') {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: env.storage.s3.bucket,
        Key: storageKey,
      })
    );
    return;
  }

  const target = resolveLocalStoragePath(storageKey);
  await fsp.unlink(target).catch(() => {});
}

/**
 * Generates an HMAC-signed short-lived stream URL token so HTML5 <audio>/<video>
 * can stream HTTP Range requests without placing JWTs in URL query strings.
 */
export function createSignedStreamToken({ recordingId, organizationId, ttlSeconds = 1800 }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${recordingId}:${organizationId}:${exp}`;
  const sig = crypto
    .createHmac('sha256', env.jwt.accessSecret)
    .update(payload)
    .digest('hex');
  return { exp, sig };
}

export function verifySignedStreamToken({ recordingId, organizationId, exp, sig }) {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${recordingId}:${organizationId}:${expNum}`;
  const expected = crypto
    .createHmac('sha256', env.jwt.accessSecret)
    .update(payload)
    .digest('hex');
  if (typeof sig !== 'string' || sig.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Returns an S3 presigned URL if stored in S3/MinIO, or null for local streaming.
 */
export async function getS3PresignedUrl(storageKey, expiresInSeconds = 1800) {
  if (!isS3Configured()) return null;
  const command = new GetObjectCommand({
    Bucket: env.storage.s3.bucket,
    Key: storageKey,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
}

/**
 * Streams a local file with full HTTP 206 Partial Content Range support.
 */
export async function streamLocalFileWithRange(req, res, { storageKey, mimeType, fileName, asAttachment = false }) {
  const filePath = resolveLocalStoragePath(storageKey);
  const stat = await fsp.stat(filePath);
  const fileSize = stat.size;

  if (asAttachment) {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileName || 'recording')}"`);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');

  const range = req.headers.range;
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = Number.parseInt(startStr, 10);
    const end = endStr ? Number.parseInt(endStr, 10) : fileSize - 1;

    if (Number.isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.status(200);
  res.setHeader('Content-Length', fileSize);
  fs.createReadStream(filePath).pipe(res);
}

