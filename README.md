# RepoBuddy — Intelligent Codebase Understanding Platform

RepoBuddy transforms unfamiliar repositories into explorable architecture maps, structured dependency graphs, searchable code intelligence, and AI-assisted onboarding — all grounded in deterministic static analysis.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                │
│  Landing · Dashboard · Graph · Files · AI · Insights│
└─────────────┬───────────────────────────┬───────────┘
              │  REST API                 │  WebSocket
┌─────────────▼───────────────────────────▼───────────┐
│                  Backend (FastAPI)                   │
│  API → Services → Domain Logic → Data Access        │
└──────┬──────────┬───────────┬───────────┬───────────┘
       │          │           │           │
  ┌────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────────┐
  │PostgreSQL│ │ Redis  │ │Celery  │ │ File Store │
  │+pgvector│ │        │ │Workers │ │            │
  └─────────┘ └────────┘ └────────┘ └────────────┘
```

## Quick Start

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start infrastructure
docker compose up -d

# 3. Start backend
cd backend
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload

# 4. Start frontend
cd frontend
npm install
npm run dev
```

## Tech Stack

| Layer    | Technology                                                             |
| -------- | ---------------------------------------------------------------------- |
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui, Framer Motion, React Flow |
| Backend  | FastAPI, Python 3.12+, Pydantic, SQLAlchemy 2.x                        |
| Database | PostgreSQL + pgvector                                                  |
| Queue    | Redis + Celery                                                         |
| Analysis | tree-sitter, NetworkX, custom AST pipeline                             |
| AI       | OpenAI (grounded RAG over code evidence)                               |

## Project Structure

```
RepoBuddy/
├── backend/          # FastAPI application
│   ├── app/
│   │   ├── api/          # Route handlers
│   │   ├── core/         # Config, security, logging
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Business logic
│   │   ├── parsers/      # Language-specific AST parsers
│   │   ├── graph/        # Graph building & analysis
│   │   ├── workers/      # Celery tasks
│   │   └── repositories/ # Data access layer
│   └── tests/
├── frontend/         # Next.js application
│   └── src/
│       ├── app/          # App Router pages
│       ├── components/   # UI components
│       ├── hooks/        # React hooks
│       ├── lib/          # Utilities & API client
│       ├── stores/       # Zustand stores
│       └── types/        # TypeScript types
└── docker-compose.yml
```

## Key Endpoints

RepoBuddy's public REST surface is evidence-first — every major response
includes the file paths, symbols, and metrics backing the claim.

| Endpoint                         | Method | Purpose                                                                                   |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `/api/repos/github`              | POST   | Clone a GitHub repo (optional PAT for private). Classifies failures, no silent retries.   |
| `/api/repos/upload`              | POST   | Upload a ZIP and analyze it.                                                              |
| `/api/analyses/{id}`             | GET    | Analysis status + progress.                                                               |
| `/api/graph/{id}`                | GET    | Full dependency graph (nodes, edges, modules, cycles, hotspots).                          |
| `/api/graph/{id}/modules`        | GET    | Module-level intelligence (cohesion, fan-in/out, entry points).                           |
| `/api/files/{id}`                | GET    | File list with risk scores and metadata.                                                  |
| `/api/intelligence/{id}`         | GET    | Repository Intelligence Report: stack, identity, quality report, critique, improvements.  |
| `/api/impact/{id}?file_path=...` | GET    | Change Impact + Review Path — blast radius, affected modules, entry points, review order. |
| `/api/insights/{id}`             | GET    | Structured insights (patterns, risks, opportunities) with evidence.                       |
| `/api/ai/chat`                   | POST   | Grounded Q&A over the analyzed repo.                                                      |

## Design Principles

- **Evidence over opinion.** Every claim is paired with file paths, line
  ranges, symbols, or graph metrics. No "high confidence" without support.
- **Deterministic core, AI at the edges.** Graph, quality, impact and
  identity analysis are pure Python over the parsed AST / dependency graph.
  LLMs only phrase what the analyzers already proved.
- **Conservative labels.** Risk, confidence and severity labels are biased
  downward when supporting evidence is thin.

## Deployment

RepoBuddy ships as a single `docker compose` stack. For a production deploy:

1. **Copy and edit env**

   ```bash
   cp .env.example .env
   ```

   Set at minimum:
   - `APP_ENV=production`
   - `APP_DEBUG=false`
   - `APP_SECRET_KEY=<a long random string>`
   - `CORS_ORIGINS=https://your.domain` (no `localhost`)
   - Strong DB credentials in `DATABASE_URL` / `DATABASE_URL_SYNC`
   - `OPENAI_API_KEY` only if you want the AI features enabled

2. **Bring the stack up**

   ```bash
   docker compose up -d --build
   ```

   All five services (`postgres`, `redis`, `backend`, `celery-worker`, `frontend`) have healthchecks. `docker compose ps` should show every service as `healthy` within ~30s.

3. **Run migrations** (first deploy and after schema changes)

   ```bash
   docker compose exec backend alembic upgrade head
   ```

4. **Verify**
   - `GET http://<host>:8000/health` → `{"status":"healthy"}`
   - `GET http://<host>:3000/` → SPA loads; response includes `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Cache-Control: no-store` on `index.html`.
   - In production mode `/docs` and `/redoc` are disabled.

On startup, the backend logs `production_misconfig` warnings if `APP_DEBUG`, `APP_SECRET_KEY`, or `CORS_ORIGINS` still hold development defaults — check the first seconds of `docker compose logs backend` after any config change.

## License

MIT
