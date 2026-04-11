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

## License

MIT
