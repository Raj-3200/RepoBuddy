"""Repository management service."""

import shutil
import zipfile
from pathlib import Path

import git

from app.config import get_settings
from app.core.exceptions import IngestionError, InvalidRepositoryError
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)

# Directories to skip during scanning
IGNORED_DIRS = {
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".tox",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".nyc_output",
    "vendor",
    ".venv",
    "venv",
    "env",
    ".env",
    ".idea",
    ".vscode",
    "bower_components",
}

# Supported source file extensions
SOURCE_EXTENSIONS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".py",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
    ".html",
    ".css",
    ".scss",
    ".less",
    ".vue",
    ".svelte",
}


def clone_github_repo(url: str, target_dir: Path, token: str | None = None) -> Path:
    """Clone a GitHub repository to local storage.

    Classifies git failures into user-facing messages instead of leaking raw
    git stderr to the UI.
    """
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        clone_url = url
        if token and "github.com" in url:
            clone_url = url.replace("https://", f"https://x-access-token:{token}@")

        logger.info("cloning_repository", url=url, target=str(target_dir), has_token=bool(token))
        git.Repo.clone_from(clone_url, str(target_dir), depth=1)
        return target_dir
    except git.exc.GitCommandError as e:
        stderr = (getattr(e, "stderr", "") or str(e)).lower()

        # Clean up any partial clone directory so retries start clean
        try:
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)
        except Exception:  # pragma: no cover — best-effort cleanup
            pass

        if (
            "could not read username" in stderr
            or "authentication failed" in stderr
            or "403" in stderr
        ):
            msg = (
                "Repository appears to be private or requires authentication. "
                "Provide a GitHub personal access token with repo scope to analyze it."
            )
        elif "repository not found" in stderr or "404" in stderr:
            msg = "Repository not found. Check the URL and that the repo is accessible."
        elif (
            "could not resolve host" in stderr
            or "network is unreachable" in stderr
            or "timed out" in stderr
        ):
            msg = "Network error while contacting GitHub. Check your connection and try again."
        else:
            # Fall back to the first non-empty stderr line, scrubbed of the token
            first_line = next(
                (line for line in stderr.splitlines() if line.strip()), "git clone failed"
            )
            msg = f"Clone failed: {first_line.strip()[:200]}"

        logger.warning("clone_failed", url=url, message=msg)
        raise InvalidRepositoryError(msg) from e


def extract_zip_repo(zip_path: Path, target_dir: Path) -> Path:
    """Safely extract a ZIP file to target directory."""
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            # Security: check for path traversal
            for member in zf.namelist():
                member_path = Path(member)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise InvalidRepositoryError(f"ZIP contains unsafe path: {member}")

            zf.extractall(target_dir)

        # If ZIP has a single root folder, move contents up
        entries = list(target_dir.iterdir())
        if len(entries) == 1 and entries[0].is_dir():
            single_dir = entries[0]
            for item in single_dir.iterdir():
                shutil.move(str(item), str(target_dir / item.name))
            single_dir.rmdir()

        return target_dir
    except zipfile.BadZipFile as e:
        raise InvalidRepositoryError("Invalid ZIP file") from e


def scan_repository_files(repo_dir: Path) -> list[dict]:
    """Scan repository and return metadata for each source file."""
    files: list[dict] = []

    if not repo_dir.exists():
        raise IngestionError(f"Repository directory not found: {repo_dir}")

    for file_path in repo_dir.rglob("*"):
        if not file_path.is_file():
            continue

        # Skip ignored directories
        rel_path = file_path.relative_to(repo_dir)
        if any(part in IGNORED_DIRS for part in rel_path.parts):
            continue

        ext = file_path.suffix.lower()
        if ext not in SOURCE_EXTENSIONS:
            continue

        try:
            stat = file_path.stat()
            # Skip very large files (> 1MB)
            if stat.st_size > 1_000_000:
                continue

            content = file_path.read_text(encoding="utf-8", errors="replace")
            line_count = content.count("\n") + 1

            files.append(
                {
                    "path": str(rel_path).replace("\\", "/"),
                    "name": file_path.name,
                    "extension": ext,
                    "language": _detect_language(ext),
                    "size_bytes": stat.st_size,
                    "line_count": line_count,
                    "is_entry_point": _is_entry_point(file_path.name, ext),
                }
            )
        except Exception as e:
            logger.warning("file_scan_error", path=str(rel_path), error=str(e))
            continue

    return files


def detect_framework(repo_dir: Path) -> tuple[str | None, str | None]:
    """Detect the primary framework and language of a repository."""
    package_json = repo_dir / "package.json"
    if package_json.exists():
        try:
            import json

            pkg = json.loads(package_json.read_text(encoding="utf-8"))
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}

            if "next" in deps:
                return "Next.js", "TypeScript" if (
                    repo_dir / "tsconfig.json"
                ).exists() else "JavaScript"
            if "react" in deps:
                return "React", "TypeScript" if (
                    repo_dir / "tsconfig.json"
                ).exists() else "JavaScript"
            if "vue" in deps:
                return "Vue.js", "JavaScript"
            if "express" in deps:
                return "Express", "JavaScript"
            if "fastify" in deps:
                return "Fastify", "JavaScript"
            if "nestjs" in deps or "@nestjs/core" in deps:
                return "NestJS", "TypeScript"

            lang = "TypeScript" if (repo_dir / "tsconfig.json").exists() else "JavaScript"
            return "Node.js", lang
        except Exception:
            pass

    if (repo_dir / "requirements.txt").exists() or (repo_dir / "pyproject.toml").exists():
        return "Python", "Python"

    return None, None


def _detect_language(ext: str) -> str | None:
    mapping = {
        ".js": "JavaScript",
        ".jsx": "JavaScript",
        ".mjs": "JavaScript",
        ".cjs": "JavaScript",
        ".ts": "TypeScript",
        ".tsx": "TypeScript",
        ".py": "Python",
        ".json": "JSON",
        ".yaml": "YAML",
        ".yml": "YAML",
        ".toml": "TOML",
        ".md": "Markdown",
        ".html": "HTML",
        ".css": "CSS",
        ".scss": "SCSS",
        ".less": "Less",
        ".vue": "Vue",
        ".svelte": "Svelte",
    }
    return mapping.get(ext)


def _is_entry_point(name: str, ext: str) -> bool:
    entry_names = {
        "index.js",
        "index.ts",
        "index.tsx",
        "index.jsx",
        "main.js",
        "main.ts",
        "app.js",
        "app.ts",
        "app.tsx",
        "server.js",
        "server.ts",
        "main.py",
        "app.py",
        "__main__.py",
    }
    return name.lower() in entry_names
