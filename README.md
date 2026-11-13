# VoxaMeet AI — AI Meeting Intelligence & Management Platform

Enterprise, multi-tenant AI Meeting Intelligence platform powered by Next.js, Node.js/Express, MySQL, Redis, ChromaDB, WhisperX (`whisper-large-v3`), `pyannote.audio`, and Ollama (`Qwen3.5` + `nomic-embed-text`).

## Brand Identity
- Primary Burgundy: `#762F48`
- Deep Burgundy: `#542033`
- Midnight Blue: `#17243C`
- Warm Background: `#F5F1EE`
- Light Gray: `#F1F3F5`
- Text: `#263247`

## Current Implementation Status: Phase 1 Complete
- **Architecture & Complete 22-Table MySQL Schema** (`backend/src/db/migrations/001_initial_schema.sql`)
- **Authentication & Security**: Registration, Login, Logout, Refresh Token Sessions, Email Verification, Forgot/Reset Password, Profile & Password Management, Rate Limiting, Audit Logs.
- **Organization Management & RBAC**: Multi-organization workspaces, Organization Creation, Team Invitations, Role-Based Access (`super_admin`, `org_admin`, `manager`, `member`), strict Organization Data Isolation.
- **Dashboard**: Real MySQL-backed KPIs, Meeting Activity & Duration charts, Recent/Upcoming Meetings, Processing Status, Quick Actions.
- **Meetings Module**: Searchable/filterable table & card views, Create/Edit/Archive/Duplicate/Delete/Share meetings, Dedicated Meeting Detail Workspace.
- **Enterprise UI Shell**: Collapsible 11-item Sidebar, Top Navigation with Global Search, Notifications, Organization Switcher, Profile Menu, Light & Dark Themes.

See [docs/SETUP.md](./docs/SETUP.md) for step-by-step installation and testing instructions, [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for system architecture, and [docs/API.md](./docs/API.md) for API documentation.

