# syntax=docker/dockerfile:1.7

# ── base ─────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps needed at runtime (git for GitPython, libpq for psycopg2, curl for healthcheck).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# ── builder: install runtime deps into a venv ────────────────────────────────
FROM base AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
# Stub `app` package so setuptools.packages.find resolves during dep install.
RUN mkdir -p app && touch app/__init__.py && \
    pip install --no-cache-dir -e . && \
    rm -rf app

# ── dev image (hot reload, dev deps) ─────────────────────────────────────────
FROM base AS dev
ENV PATH="/opt/venv/bin:$PATH"
COPY --from=builder /opt/venv /opt/venv

COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py && \
    pip install --no-cache-dir -e ".[dev]" && \
    rm -rf app

COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── prod image (default) ─────────────────────────────────────────────────────
FROM base AS prod
ENV PATH="/opt/venv/bin:$PATH"
COPY --from=builder /opt/venv /opt/venv

COPY . .

# Non-root user, writable data dirs.
RUN useradd --system --uid 1001 --home-dir /app --no-create-home app && \
    mkdir -p /app/uploads /app/repos && \
    chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips=*"]
