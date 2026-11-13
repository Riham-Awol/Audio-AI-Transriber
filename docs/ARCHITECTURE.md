# VoxaMeet AI — System Architecture

## 1. Architectural Overview

VoxaMeet AI is a multi-tenant, organization-isolated Meeting Intelligence & Management SaaS platform designed with strict separation between:

1. **Frontend (`frontend/`)**: Next.js (App Router, JavaScript), React, Tailwind CSS, Shadcn-style UI components, Lucide React icons, and Socket.IO client. Deployed on **Vercel**.
2. **Backend API & Real-Time Gateway (`backend/`)**: Node.js + Express.js + Socket.IO + MySQL2 + Redis job producer. Handles authentication, RBAC, organization isolation, meeting lifecycle CRUD, signed S3 URLs, integrations, and real-time notifications. Deployed on **Render**.
3. **AI Microservice & Worker (`ai-service/`)**: Python + FastAPI + Redis worker running open-source self-hosted AI models:
   - **FFmpeg**: Media extraction & normalization (16 kHz mono WAV).
   - **WhisperX + OpenAI Whisper `large-v3`**: Chunked English transcription with word-level timestamps.
   - **pyannote.audio**: Speaker diarization (`SPEAKER_00`, `SPEAKER_01`, ...).
   - **Ollama + Qwen3.5 9B**: Hierarchical meeting summarization, decisions, action items, and RAG Q&A.
   - **Ollama + `nomic-embed-text` + ChromaDB**: Semantic chunk embeddings and vector search.
   - Designed behind an **AI Provider Abstraction** (`TranscriptionProvider`, `LLMProvider`, `EmbeddingProvider`) so self-hosted open-source models are used by default and optional paid providers can be plugged in later without altering the backend or frontend contracts.

## 2. High-Level Topology

```
[Browser / Next.js on Vercel]
   │  HTTPS REST + WSS Socket.IO
   ▼
[Express.js API + Socket.IO on Render] ──► [MySQL 8.0] (Relational tenant data)
   │                                    ──► [S3 / MinIO] (Audio/video objects)
   │  Enqueue jobs (Redis)
   ▼
[Redis Queue] ◄──► [Python FastAPI AI Worker (Dedicated GPU/CPU Compute)]
                      ├── FFmpeg + WhisperX (large-v3) + pyannote.audio
                      ├── Ollama (Qwen3.5 9B + nomic-embed-text)
                      └── ChromaDB (Vector store, isolated per organization_id)
```

## 3. Multi-Tenancy & Security Model

- **Authentication**: Short-lived JWT Access Tokens (`15m`) + rotating Refresh Tokens stored as SHA-256 hashes in `user_sessions`. Passwords hashed with `bcryptjs` (cost 12).
- **Authorization (RBAC)**:
  - `super_admin`: Platform-level administration.
  - `org_admin`: Full organization settings, billing/plan, team invitations, integrations, all org meetings.
  - `manager`: Create/edit/share meetings, manage tasks, invite members.
  - `member`: Access organization meetings (or shared meetings), collaborate on notes/tasks/AI chat.
- **Organization Isolation**: Every organization-scoped query enforces `WHERE organization_id = ?` derived from the verified membership (`organization_members`) for the active `X-Organization-Id` header or user's primary organization. Users cannot access recordings, transcripts, summaries, or chat history from any organization they do not belong to.

## 4. Phased Delivery Roadmap

- **Phase 1 (Implemented)**: Monorepo structure, MySQL schema & migrations, Auth (register, login, logout, verify email, forgot/reset password, profile, sessions), Organization management & invitations & RBAC, Dashboard with real SQL metrics & charts, Meetings CRUD + detail workspace + sharing, 11-item Collapsible Sidebar + Light/Dark themes.
- **Phase 2 (Implemented)**: In-person & browser-tab recording (`MediaRecorder` / `getDisplayMedia`), chunked uploads to S3/MinIO/local, Redis job queue, FFmpeg + WhisperX (`large-v3`) + `pyannote.audio` diarization worker, Range playback streaming.
- **Phase 3 (Implemented)**: Interactive Transcript Viewer (real-time playback sync & word-level highlighting, match navigation, speaker relabeling modal, inline editing, segment split/merge/delete, print view, PDF/DOCX/TXT/Markdown export).
- **Phase 4 (Implemented)**: Hierarchical AI Summarization (Ollama Qwen3.5 9B / Qwen2.5 7B + local NLP engine fallback, executive summary, purpose, topics, discussion points, challenges & risks, next steps, meeting minutes markdown, decisions workspace with statuses, action items workspace with 1-click completion).
- **Phase 5 (Implemented)**: ChromaDB + `nomic-embed-text` dense vector embeddings, organization-isolated vector collections (`voxa_org_<orgId>`), In-Meeting AI Assistant with transcript citations & audio seeking, and Global Cross-Meeting AI Assistant (`/assistant`) with multi-turn chat sessions and semantic search.
- **Phase 6 (Implemented)**: OAuth 2.0 Integrations Marketplace (Google Calendar, Outlook Calendar, Zoom, Google Meet, Microsoft Teams, Slack, Jira, Google Drive, Dropbox), AES-256-GCM token encryption vault, two-way Calendar Synchronization with 1-click meeting import, 1-click Jira task export, and Slack Block Kit summary broadcasting.
- **Phase 7 (Implemented)**: Advanced Reports & Organization Intelligence Hub (`/reports`), cross-meeting KPI analytics, trailing 6-month volume & duration metrics, speaker engagement breakdown, consolidated CSV task & decision exports, and immutable audit logging.

