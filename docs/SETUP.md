# VoxaMeet AI — Setup, Installation & Testing Guide (Phases 1–2)

## Prerequisites

- **Node.js**: `>= 20.x` (tested on `v24.22.0`)
- **npm**: `>= 10.x`
- **MySQL**: `8.0+` (local installation or Docker via `docker-compose.yml`)
- **Python**: `3.10` or `3.11` (for the Phase 2 WhisperX & pyannote AI microservice)
- **FFmpeg**: `ffmpeg` & `ffprobe` on system `PATH` (required by the Phase 2 audio preprocessing pipeline)
- **Docker Desktop** (optional, recommended for spinning up MySQL, Redis, ChromaDB, MinIO)

---

## Step 1: Start Infrastructure Services (MySQL)

If using Docker:
```bash
cp .env.example .env
docker compose up -d mysql
```

Or connect to an existing local MySQL 8.0 server and create the database:
```sql
CREATE DATABASE meeting_intelligence CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## Step 2: Configure & Initialize the Backend

1. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Create `backend/.env` from `backend/.env.example` and update `DB_*` and JWT secrets:
   ```bash
   cp .env.example .env
   ```

3. Run database migrations (creates all 22 normalized tables + `schema_migrations`):
   ```bash
   npm run migrate
   ```

4. *(Optional — Development Only)* Seed realistic development demonstration data:
   ```bash
   npm run seed
   ```
   > **Note:** Seed data only runs when `NODE_ENV !== 'production'`. Dashboard statistics in the app always query real MySQL data.
   > Demo accounts created by the seeder:
   > - `admin@acme-corp.demo` / `Password123!` (Organization Admin)
   > - `manager@acme-corp.demo` / `Password123!` (Manager)
   > - `member@acme-corp.demo` / `Password123!` (Member)

5. Start the backend API server:
   ```bash
   npm run dev
   ```
   The API will listen on `http://localhost:4000` (health check: `GET http://localhost:4000/api/health`).

---

## Step 3: Configure & Start the Frontend

1. Install frontend dependencies:
   ```bash
   cd ../frontend
   npm install
   ```

2. Create `frontend/.env.local` from `frontend/.env.example`:
   ```bash
   cp .env.example .env.local
   ```

3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

## Step 4: Running Phase 1 Tests

### Backend Unit & Integration Tests
```bash
cd backend
npm test
```
- Runs core auth/token/RBAC/SQL-migration/validation tests using `node --test`.
- If `RUN_DB_TESTS=true` is set with a reachable MySQL instance, also executes live MySQL migration, authentication, organization isolation, and Meetings CRUD integration tests.

### Frontend Production Build & Lint Verification
```bash
cd frontend
npm run lint
npm run build
```

---

## Step 5: Phase 2 — Audio Pipeline & Python AI Microservice

1. **Install FFmpeg** (must provide `ffmpeg` and `ffprobe` on `PATH`):
   - Windows (winget): `winget install Gyan.FFmpeg` (then open a new terminal so `PATH` refreshes)
   - macOS: `brew install ffmpeg`
   - Ubuntu/Debian: `sudo apt install ffmpeg`

2. **Install Python Dependencies (`ai-service/`)**:
   ```bash
   cd ai-service
   python -m venv .venv
   # Windows PowerShell: .\.venv\Scripts\Activate.ps1
   # Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   ```

3. **Configure `ai-service/.env`**:
   - Ensure `BACKEND_INTERNAL_URL` matches your running Express server (e.g. `http://localhost:4002/api/internal`).
   - Ensure `BACKEND_API_KEY` matches `AI_SERVICE_API_KEY` in `backend/.env`.
   - Set `WHISPER_MODEL=large-v3` (or `base`/`small` on CPU-only machines for faster local tests).
   - Set `HF_TOKEN=<your_huggingface_token>` after accepting model access for `pyannote/speaker-diarization-3.1` on Hugging Face (if omitted, transcription still completes with single/default speaker labeling).

4. **Start the AI Microservice**:
   ```bash
   cd ai-service
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   *(Optional)* If using Redis (`REDIS_URL` configured in both `backend/.env` and `ai-service/.env`), also run the Redis queue consumer:
   ```bash
   python -m app.worker
   ```

5. **Run Phase 2 AI Service Unit Tests**:
   ```bash
   cd ai-service
   python -m unittest discover -s tests -v
   ```

