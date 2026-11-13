# VoxaMeet AI — REST API & Socket.IO Reference (Phases 1–4)

Base URL: `http://localhost:4000/api`

All authenticated endpoints require:
- `Authorization: Bearer <accessToken>`
- `X-Organization-Id: <organizationUuid>` (optional; defaults to user's primary organization)

---

## 1. Health
- `GET /health` — Server & MySQL connectivity status.

## 2. Authentication (`/auth`)
- `POST /auth/register` — Register user (and optionally create first organization). Returns `accessToken`, `refreshToken`, `user`, `organizations`.
- `POST /auth/login` — Authenticate with email/password. Creates `user_sessions` record.
- `POST /auth/refresh` — Rotate refresh token and issue new access token.
- `POST /auth/logout` — Revoke current refresh session.
- `POST /auth/verify-email` — Verify user email via token.
- `POST /auth/resend-verification` — Re-issue verification link.
- `POST /auth/forgot-password` — Generate time-limited password reset token.
- `POST /auth/reset-password` — Reset password using token.
- `GET /auth/me` — Get current user profile, memberships, and active organization.
- `PATCH /auth/me` — Update profile (`fullName`, `jobTitle`, `timezone`) or change password.
- `GET /auth/sessions` — List active sessions for current user.
- `DELETE /auth/sessions/:sessionId` — Revoke a specific session.

## 3. Organizations & Team (`/organizations`)
- `GET /organizations` — List organizations the authenticated user belongs to.
- `POST /organizations` — Create a new organization (creator becomes `org_admin`).
- `PATCH /organizations/current` — Update active organization name/industry/vocabulary (`org_admin`).
- `GET /organizations/current/members` — List members and pending invitations.
- `POST /organizations/current/invitations` — Invite member by email & role (`org_admin`, `manager`).
- `POST /organizations/invitations/accept` — Accept an invitation token.
- `DELETE /organizations/current/invitations/:invitationId` — Revoke pending invitation.
- `PATCH /organizations/current/members/:memberId` — Update member role or status (`org_admin`).
- `DELETE /organizations/current/members/:memberId` — Remove member (`org_admin`).

## 4. Dashboard (`/dashboard`)
- `GET /dashboard/overview` — Returns real MySQL counts & series for the active organization:
  - `stats`: `totalMeetings`, `totalRecordedSeconds`, `totalTranscripts`, `totalActionItems`, `pendingTasks`, `meetingsThisWeek`
  - `recentMeetings`, `upcomingMeetings`, `recentSummaries`, `outstandingActionItems`, `processingMeetings`
  - `charts`: `activityLast14Days`, `durationByType`

## 5. Meetings (`/meetings`)
- `GET /meetings` — Paginated, searchable, filterable list (`search`, `status`, `meetingType`, `recordingSource`, `dateFrom`, `dateTo`, `includeArchived`, `page`, `limit`).
- `POST /meetings` — Create meeting metadata.
- `GET /meetings/:id` — Detailed meeting payload (meeting, creator, speakers, summary, decisions, action items, notes, shares). Strictly scoped to active organization.
- `PATCH /meetings/:id` — Update meeting metadata.
- `POST /meetings/:id/archive` — Archive/unarchive meeting.
- `POST /meetings/:id/duplicate` — Duplicate meeting metadata into a new scheduled meeting.
- `DELETE /meetings/:id` — Soft-delete meeting (`deleted_at`).
- `POST /meetings/:id/share` — Share meeting with another active member of the same organization.
- `DELETE /meetings/:id/share/:userId` — Revoke share.

## 6. Notifications & Global Search
- `GET /notifications` — List notifications for current user in active organization.
- `PATCH /notifications/:id/read` — Mark single notification read.
- `POST /notifications/read-all` — Mark all notifications read.
- `GET /search?q=...` — Global search across organization meetings and action items.

## 7. Recordings & Transcription Pipeline (`/recordings`) — Phase 2
- `POST /recordings/upload` (`multipart/form-data`) — Upload audio/video (`file` up to `MAX_UPLOAD_SIZE_BYTES`), optional `meetingId` or new meeting metadata (`title`, `meetingType`, `recordingSource`, `speakerHints`, `vocabulary`, `consentConfirmed=true`). Returns `202 Accepted` with `meeting`, `recording`, and `job`.
- `GET /recordings/meeting/:meetingId` — List non-deleted recordings for a meeting in the active organization.
- `GET /recordings/:id/playback-url` — Returns a signed HMAC stream URL (`/api/recordings/:id/stream?org=...&exp=...&sig=...`) or S3/MinIO presigned URL.
- `GET /recordings/:id/stream` — Streams audio/video with HTTP `206 Partial Content` `Range` support after verifying the HMAC signature (`org`, `exp`, `sig`).
- `GET /recordings/:id/download` — Downloads the original recording file (`Content-Disposition: attachment`).
- `POST /recordings/:id/retry` — Re-queues failed/stalled transcription jobs for the recording (`202 Accepted`).
- `DELETE /recordings/:id` — Soft-deletes the recording metadata and removes the stored media file.

## 8. Internal AI Worker Endpoints (`/internal`) — Phase 2
Protected by `X-API-Key: <AI_SERVICE_API_KEY>`:
- `GET /internal/recordings/:id/file` — Streams original media file (or redirects to S3 presigned URL) for Python AI worker ingestion.
- `POST /internal/transcription-callback` — Idempotent callback invoked by the AI microservice to report `queued`/`processing` progress, `failed` status, or `completed` diarized speakers and timestamped `transcript_segments` inside a MySQL transaction.

## 9. Transcript Management & Editing (`/meetings/:id/transcript`) — Phase 3
- `GET /meetings/:id/transcript` — Returns full meeting transcript, word count, confidence, ordered segments (with word-level timestamps), and speaker list.
- `PATCH /meetings/:id/transcript/segments/:segmentId` — Edit segment text or reassign speaker (`{ text, speakerId }`). Sets `is_edited = 1` and synchronizes total transcript word count and full text. Emits `transcript:segment-updated`.
- `POST /meetings/:id/transcript/segments/:segmentId/split` — Splits a segment into two contiguous segments at a given timestamp (`{ splitTimestampMs, splitTextFirst, splitTextSecond }`). Re-sequences following segments inside a MySQL transaction. Emits `transcript:updated`.
- `POST /meetings/:id/transcript/segments/:segmentId/merge-next` — Merges a segment with its immediate successor (`sequence_index + 1`), combining text and end timestamps. Emits `transcript:updated`.
- `DELETE /meetings/:id/transcript/segments/:segmentId` — Deletes an unnecessary or empty segment and shifts subsequent sequence indices down. Emits `transcript:updated`.
- `PATCH /meetings/:id/speakers/:speakerId` — Renames a speaker (`displayName`, `colorHex`) globally across all meeting segments. Emits `transcript:speaker-updated`.
- `POST /meetings/:id/speakers` — Adds a new custom speaker label for the meeting.

## 10. Document Export & Printing (`/meetings/:id/export`) — Phase 3
- `GET /meetings/:id/export` — Generates and downloads meeting documents based on query parameters:
  - `format`: `pdf` (via PDFKit with header & corporate branding), `docx` (via DOCX library with tables & headings), `txt` (UTF-8 plain text), or `markdown` (`.md`).
  - `type`: `full_report` (metadata, executive summary, decisions, action items, transcript), `transcript` (transcript only), or `summary` (summary and decisions only).
  - `includeTimestamps`: `1` / `true` (default) or `0` / `false`.
  - `includeSpeakers`: `1` / `true` (default) or `0` / `false`.

## 11. AI Summarization, Decisions & Action Items — Phase 4
- `GET /meetings/:id/summary?level=short|standard|detailed` — Returns meeting summary for specified detail level, along with decisions and action items.
- `POST /meetings/:id/summary/generate` — Triggers hierarchical AI summarization (`{ detailLevel: 'short' | 'standard' | 'detailed' }`) using Ollama Qwen3.5/Qwen2.5 or local NLP engine, saving executive summary, purpose, topics, discussion points, challenges, risks, next steps, decisions, and action items. Emits `summary:generated`.
- `PATCH /meetings/:id/summary` — Updates executive summary, purpose, topics, minutes markdown, etc. Emits `summary:updated`.
- `GET /meetings/:id/decisions` — List decisions for the meeting.
- `POST /meetings/:id/decisions` — Add manual decision (`{ description, speakerId, status, timestampMs, supportingQuote }`).
- `PATCH /meetings/:id/decisions/:decisionId` — Edit decision description, status (`agreed`, `proposed`, `deferred`, `rejected`), speaker, or quote.
- `DELETE /meetings/:id/decisions/:decisionId` — Delete decision.
- `GET /meetings/:id/action-items` — List action items for the meeting.
- `POST /meetings/:id/action-items` — Create action item (`{ title, description, assigneeUserId, assigneeName, dueDate, priority, status }`).
- `PATCH /meetings/:id/action-items/:actionItemId` — Update action item title, assignee, due date, priority, or status.
- `DELETE /meetings/:id/action-items/:actionItemId` — Soft-delete action item.
- `POST /internal/summary-callback` (Internal, `X-API-Key`) — Callback endpoint invoked by Python AI microservice to deliver summary results.

## 12. Socket.IO Events
- Client connects with `{ auth: { token, organizationId } }`.
- Server joins socket to `org:<organizationId>` and `user:<userId>` rooms after verifying JWT & membership.
- Emitted events: `meeting:created`, `meeting:updated`, `meeting:deleted`, `notification:new`, `transcription:progress`, `transcript:updated`, `transcript:segment-updated`, `transcript:speaker-updated`, `summary:generated`, `summary:updated`, `decisions:updated`, `action-items:updated`.

