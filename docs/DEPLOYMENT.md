# Production Deployment Guide — VoxaMeet AI

VoxaMeet AI is architected as three specialized layers:
1. **Frontend (`frontend/`)**: Next.js App Router ➔ **Vercel**
2. **Backend API & WebSockets (`backend/`)**: Node.js Express + Socket.IO + MySQL + Redis ➔ **Render / Railway / Fly.io / VPS**
3. **AI Microservice (`ai-service/`)**: Python FastAPI + WhisperX + Ollama ➔ **GPU Compute / RunPod / Dedicated VPS**

---

## 1. Hosting the Frontend on Vercel

### Step 1: Connect GitHub Repository to Vercel
1. Log in to [Vercel](https://vercel.com).
2. Click **"Add New..."** ➔ **"Project"**.
3. Select your GitHub repository: `Riham-Awol/Audio-AI-Transriber`.

### Step 2: Configure Monorepo Settings (Crucial!)
Because the Next.js app is located in the `frontend/` folder:
- **Root Directory**: Click **"Edit"**, choose `frontend`, and click **Continue**.
- **Framework Preset**: Vercel will automatically detect **Next.js**.
- **Build Command**: `next build` (default).
- **Output Directory**: `.next` (default).
- **Install Command**: `npm install` (default).

### Step 3: Add Environment Variables
In the **Environment Variables** section on Vercel, add:

| Key | Value (Example) | Notes |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | `https://your-backend.onrender.com/api` | The public URL of your deployed Express backend |
| `NEXT_PUBLIC_SOCKET_URL` | `https://your-backend.onrender.com` | The WebSocket URL for real-time transcript sync |

Click **"Deploy"**.

---

## 2. Deploying via Vercel CLI (Alternative)

If you prefer deploying directly from your terminal:

```bash
# 1. Install Vercel CLI globally
npm i -g vercel

# 2. Navigate to the frontend directory
cd frontend

# 3. Deploy preview
vercel

# 4. Deploy to production
vercel --prod
```

When prompted:
- Set up and deploy `frontend`: **Yes**
- Which scope: Select your personal or team account
- Link to existing project: **No**
- Project name: `voxameet-ai` (or your choice)
- In which directory is your code located: `./`

---

## 3. Configuring Backend CORS for Vercel

Once your Vercel URL is generated (e.g. `https://voxameet-ai.vercel.app`), update your backend's environment variables:

In your deployed backend environment settings:
```env
CORS_ORIGINS=https://voxameet-ai.vercel.app,http://localhost:3000
FRONTEND_URL=https://voxameet-ai.vercel.app
```

This ensures the browser will allow login requests, streaming audio, and Socket.IO connections from your Vercel deployment.

---

## 4. Where to Host the Backend & Database

Since the backend requires persistent WebSockets (Socket.IO) and database connections, use a containerized host:

### Option A: Render (Recommended & Simple)
1. Create a **Web Service** on [Render](https://render.com).
2. Root Directory: `backend`.
3. Build Command: `npm install`.
4. Start Command: `npm start`.
5. Attach a managed MySQL database and Redis instance.

### Option B: Railway
1. New Project ➔ Deploy from GitHub.
2. Select root directory `backend`.
3. Add MySQL and Redis plugins from the Railway canvas.
