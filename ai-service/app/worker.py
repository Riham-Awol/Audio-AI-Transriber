import json
import sys
import time

import redis

from app.config import settings
from app.services.pipeline import run_transcription_job


def main() -> None:
    if not settings.redis_url:
        print("REDIS_URL is not configured. Set REDIS_URL to run standalone Redis worker.", file=sys.stderr)
        sys.exit(1)

    client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    print(f"VoxaMeet AI Redis worker listening on queue '{settings.transcription_queue_key}'...")

    while True:
        try:
            item = client.brpop(settings.transcription_queue_key, timeout=5)
            if not item:
                continue
            _, raw_payload = item
            job = json.loads(raw_payload)
            print(f"Processing meeting {job.get('meetingId')} / recording {job.get('recordingId')}...")
            run_transcription_job(job)
        except KeyboardInterrupt:
            print("Worker shutting down...")
            break
        except Exception as exc:  # noqa: BLE001
            print(f"Worker loop error: {exc}", file=sys.stderr)
            time.sleep(2)


if __name__ == "__main__":
    main()

