"""RepoBuddy application configuration."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──
    app_env: str = "development"
    app_secret_key: str = "change-me-in-production"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_debug: bool = False
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # ── Database ──
    database_url: str = "postgresql+asyncpg://repobuddy:repobuddy@localhost:5432/repobuddy"
    database_url_sync: str = "postgresql://repobuddy:repobuddy@localhost:5432/repobuddy"

    # ── Redis ──
    redis_url: str = "redis://localhost:6379/0"

    # ── Celery ──
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ── File storage ──
    max_upload_size_mb: int = 100
    upload_dir: str = "./uploads"
    repos_dir: str = "./repos"

    # ── GitHub ──
    github_token: str = ""

    # ── GitHub OAuth App (optional — enables real "Sign in with GitHub") ──
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""
    github_oauth_redirect_uri: str = "http://localhost:8000/api/auth/github/callback"
    frontend_url: str = "http://localhost:5173"

    # ── AI / LLM ──
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o"
    embedding_model: str = "text-embedding-3-small"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def upload_path(self) -> Path:
        p = Path(self.upload_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def repos_path(self) -> Path:
        p = Path(self.repos_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
