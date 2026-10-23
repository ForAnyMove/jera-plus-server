# Jera Plus API Backend

Node.js / Express production backend for **Jera Plus** international trading platform. Handles dynamic content delivery, admin authentication, Supabase cloud synchronization, contact form submissions, newsletter subscribers, careers management, and secure media uploads.

---

## 🚀 Tech Stack & Features

- **Runtime:** Node.js (>= 20) & Express
- **Database & Storage:** Supabase (PostgreSQL + S3-compatible Storage Bucket `jeraplus_media`)
- **Security:**
  - `helmet` security headers & Content-Security-Policy
  - `express-rate-limit` (strict limiters for admin login, contact/subscribe forms, and general API)
  - HMAC-SHA256 cryptographically signed expiring admin tokens with timing-safe comparison (`crypto.timingSafeEqual`)
  - Whitelist-based dynamic CORS (`CORS_ORIGINS`)
  - Magic-byte image inspection for uploads (blocks disguised scripts and executables)
  - CSV formula injection escaping (`=+-@\t\r`) on export endpoints
  - Honeypot bot protection for form spam prevention
- **Local Fallback:** In-memory + JSON caching (`data/initialContent.json`) ensures 100% uptime even during database maintenance.

---

## 📋 Prerequisites

- Node.js >= 20.x
- Supabase Project (URL and `service_role` key)

---

## 🛠 Local Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in your values:
   ```ini
   PORT=5000
   NODE_ENV=development
   CORS_ORIGINS=http://localhost:3000,http://localhost:3001
   ADMIN_PASSWORD=your-secure-password
   ADMIN_TOKEN_SECRET=any-random-32-char-string
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   SUPABASE_STORAGE_BUCKET=jeraplus_media
   ```

3. **Database Schema:**
   Open your Supabase SQL Editor and execute:
   - `supabase/001_schema.sql` (Tables, RLS policies, default content)
   - `supabase/002_security_careers.sql` (Careers table, subscribers table, storage bucket, sequence sync)

4. **Run server:**
   ```bash
   npm run dev
   # or
   npm start
   ```
   Health check: `http://localhost:5000/api/health`

---

## 🌐 Deploy to Render

This repository includes a `render.yaml` Blueprint for 1-click deployment.

### Option A: Render Blueprint (Recommended)
1. Push this repository to GitHub.
2. In Render Dashboard, click **New +** -> **Blueprint**.
3. Connect your repository. Render will automatically read `render.yaml` and configure the web service.
4. Fill in the required environment variables:
   - `CORS_ORIGINS`: URLs of your Vercel front and admin apps (e.g. `https://jera-plus.vercel.app,https://jera-plus-admin.vercel.app`)
   - `ADMIN_PASSWORD`: Your secret admin password
   - `SUPABASE_URL`: Your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase `service_role` key
5. Click **Apply**.

### Option B: Manual Web Service
1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure settings:
   - **Environment:** Node
   - **Build Command:** `npm ci --omit=dev`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
4. In **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `NODE_VERSION`: `20`
   - `CORS_ORIGINS`: `https://jera-plus.vercel.app,https://jera-plus-admin.vercel.app`
   - `ADMIN_PASSWORD`: `<your-admin-password>`
   - `ADMIN_TOKEN_SECRET`: `<generated 64-char hex string>`
   - `ADMIN_TOKEN_TTL_HOURS`: `12`
   - `SUPABASE_URL`: `https://<your-project>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: `<service_role_key>`
   - `SUPABASE_STORAGE_BUCKET`: `jeraplus_media`
5. Click **Create Web Service**.

---

## 🔒 Security Best Practices
- **NEVER** commit `.env` to Git (it is ignored in `.gitignore`).
- `SUPABASE_SERVICE_ROLE_KEY` has full database bypass privileges — keep it strictly on Render.
- `ADMIN_TOKEN_SECRET` must be set to a high-entropy random string in production.

---

## 📦 Git Push Commands
```bash
git init
git add .
git commit -m "feat: production hardened backend with Supabase, security middleware, and Render config"
git branch -M main
git remote add origin <YOUR_BACKEND_REPO_URL>
git push -u origin main
```
