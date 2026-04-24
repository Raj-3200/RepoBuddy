# RepoBuddy Deployment Runbook

**Target stack:** Vercel (frontend SPA) + Oracle Cloud Always Free VM (backend + worker + redis + Caddy) + Neon (Postgres) + Groq (LLM).

---

## 0. Prereqs / one-time

- A domain you control (e.g. `yourdomain.com`). You'll use `api.yourdomain.com` for the backend.
- Oracle Cloud account (free tier — Ampere A1 recommended: 4 OCPU / 24 GB RAM).
- Vercel account linked to your GitHub.
- Neon project (already done — your `.env` already has the URL).
- Your repo pushed to GitHub.

---

## 1. Rotate the leaked secrets first

You pasted live credentials into chat earlier. Before deploying, **rotate**:

- [ ] **Neon Postgres password** — Neon console → Roles → reset password for `neondb_owner`. Update `DATABASE_URL` and `DATABASE_URL_SYNC`.
- [ ] **Groq API key** — `https://console.groq.com/keys`, delete the old one, create a new one. Update `OPENAI_API_KEY`.
- [ ] **Better Auth API key** — rotate in the Better Auth dashboard. Update `BETTER_AUTH_API_KEY`.

---

## 2. Create the Oracle Cloud VM

1. OCI Console → **Compute → Instances → Create instance**.
2. **Image:** Ubuntu 22.04 (or Oracle Linux 9). **Shape:** `VM.Standard.A1.Flex`, 2 OCPU / 12 GB RAM (free tier).
3. Upload an SSH public key.
4. Networking:
   - Assign public IPv4.
   - Open **ingress** on the VCN Security List (or NSG) for **TCP 80** and **TCP 443** from `0.0.0.0/0`.
5. Wait for status = _Running_, note the **public IP**.

### DNS

- Create an **A record** `api.yourdomain.com → <VM public IP>` (TTL 300). Let it propagate.

---

## 3. Bootstrap the VM

SSH in:

```bash
ssh ubuntu@<VM_PUBLIC_IP>      # or opc@... on Oracle Linux
```

Then:

```bash
sudo apt-get update -y && sudo apt-get install -y git     # or: sudo dnf install -y git
git clone https://github.com/<YOU>/RepoBuddy.git
cd RepoBuddy
bash deploy/bootstrap.sh
```

On first run it will:

- Install Docker + compose plugin.
- Open firewall 80/443.
- Copy `.env.example` → `.env` and exit with a prompt.

Edit `.env`:

```bash
nano .env
```

Set at minimum:

```ini
APP_ENV=production
APP_DEBUG=false
APP_SECRET_KEY=<run: openssl rand -hex 32>
CORS_ORIGINS=https://<your-vercel-domain>.vercel.app

DATABASE_URL=postgresql+asyncpg://...neon.tech/...?ssl=require
DATABASE_URL_SYNC=postgresql://...neon.tech/...?sslmode=require

REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/2

OPENAI_API_KEY=<new groq key>
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=llama-3.3-70b-versatile

API_DOMAIN=api.yourdomain.com
ACME_EMAIL=you@yourdomain.com
```

Re-run bootstrap to build + start:

```bash
bash deploy/bootstrap.sh
```

Verify:

```bash
curl -sS https://api.yourdomain.com/health
# → {"status":"ok"}
```

If the cert isn't ready yet, wait ~30 s and retry.

### Run DB migrations

```bash
sudo docker compose -f deploy/docker-compose.oracle.yml exec backend alembic upgrade head
```

---

## 4. Deploy the frontend to Vercel

1. Vercel → **Add New Project → Import** your GitHub repo.
2. **Framework Preset:** _Other_ (Vercel will respect the repo-root `vercel.json`).
3. **Root Directory:** keep as `/` (repo root) — `vercel.json` builds from `frontend/`.
4. **Environment Variables:**
   - `VITE_API_URL` = `https://api.yourdomain.com/api`
5. Click **Deploy**. First build ~1–2 min.

Once live, note the Vercel URL (e.g. `repobuddy.vercel.app` or your custom domain).

### Wire CORS back

On the VM:

```bash
cd ~/RepoBuddy
nano .env
# set: CORS_ORIGINS=https://repobuddy.vercel.app,https://yourdomain.com

sudo docker compose -f deploy/docker-compose.oracle.yml up -d backend celery
```

---

## 5. Smoke test

- Open `https://<your-vercel-domain>` → landing page loads.
- Sign in → `/app` loads.
- Upload a small repo → poll progress → results render.
- Check worker logs: `sudo docker compose -f deploy/docker-compose.oracle.yml logs -f celery`

---

## 6. Day-2 ops

**Update code:**

```bash
cd ~/RepoBuddy && git pull
sudo docker compose -f deploy/docker-compose.oracle.yml up -d --build
```

**Logs:**

```bash
sudo docker compose -f deploy/docker-compose.oracle.yml logs -f backend
sudo docker compose -f deploy/docker-compose.oracle.yml logs -f celery
sudo docker compose -f deploy/docker-compose.oracle.yml logs -f caddy
```

**Restart a service:**

```bash
sudo docker compose -f deploy/docker-compose.oracle.yml restart backend
```

**Tear everything down (data preserved via named volumes):**

```bash
sudo docker compose -f deploy/docker-compose.oracle.yml down
```

**Tear down + wipe data:**

```bash
sudo docker compose -f deploy/docker-compose.oracle.yml down -v
```

**Backups:** Neon handles Postgres (point-in-time recovery on paid; free tier has branch snapshots). For `uploads` + `repos` volumes on the VM, run a nightly tar to object storage:

```bash
# crontab -e
0 3 * * * docker run --rm -v repobuddy_uploads:/src -v /var/backups:/dst alpine tar czf /dst/uploads-$(date +\%F).tgz -C /src .
```

---

## 7. Known caveats

- **ARM64 build:** Oracle A1 is ARM. Don't build images on your Windows laptop and push — build on the VM (what `bootstrap.sh` does) or use `docker buildx --platform linux/arm64`.
- **Free tier Neon** sleeps after 5 min idle → first request after sleep takes 1–2 s to wake the compute.
- **Groq free tier** has daily token limits. AI features degrade gracefully if the key is missing.
- **Uploads directory** lives on the VM disk (volume `uploads`). If you outgrow 50 GB, move to OCI Object Storage via a small adapter in [backend/app/config.py](../backend/app/config.py).
