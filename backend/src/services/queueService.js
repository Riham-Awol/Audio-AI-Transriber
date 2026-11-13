import Redis from 'ioredis';
import { query } from '../config/database.js';
import { env } from '../config/env.js';

export const TRANSCRIPTION_QUEUE_KEY = 'voxameet:transcription:jobs';

let redisClient = null;

function getRedisClient() {
  if (!env.redis.url) return null;
  if (!redisClient) {
    redisClient = new Redis(env.redis.url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
    redisClient.on('error', (err) => {
      console.error('Redis queue error:', err.message);
    });
  }
  return redisClient;
}

/**
 * Enqueues an asynchronous transcription & diarization job without blocking HTTP requests.
 * Uses Redis queue when REDIS_URL is configured; otherwise dispatches directly to the
 * FastAPI AI service background worker endpoint.
 */
export async function enqueueTranscriptionJob(jobPayload) {
  const payload = {
    ...jobPayload,
    enqueuedAt: new Date().toISOString(),
    callbackUrl: `${env.backendPublicUrl}/api/internal/transcription-callback`,
    fileDownloadUrl: `${env.backendPublicUrl}/api/internal/recordings/${jobPayload.recordingId}/file`,
  };

  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.status === 'wait') {
        await redis.connect();
      }
      await redis.lpush(TRANSCRIPTION_QUEUE_KEY, JSON.stringify(payload));
      return { dispatchedVia: 'redis', queued: true };
    } catch (err) {
      console.warn('Redis enqueue failed, falling back to direct AI service dispatch:', err.message);
    }
  }

  // Non-blocking async dispatch to Python FastAPI AI service
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${env.ai.serviceUrl}/jobs/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.ai.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return { dispatchedVia: 'http_async', queued: true };
    }

    const errText = await response.text().catch(() => '');
    throw new Error(`AI service responded with ${response.status}: ${errText}`);
  } catch (err) {
    // Keep job as 'queued' with actionable status message so user can retry once AI worker is online
    await query(
      `UPDATE meetings
       SET status = 'queued',
           processing_error = ?
       WHERE id = ? AND organization_id = ?`,
      [
        `Queued for AI worker (${err.message}). Start the Python AI service and click Retry if needed.`,
        jobPayload.meetingId,
        jobPayload.organizationId,
      ]
    );
    return { dispatchedVia: 'deferred_queue', queued: false, reason: err.message };
  }
}

export async function closeQueue() {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
  }
}

