"""Deep evidence-backed stack detection engine.

Analyses multiple signals to determine what technologies a repository uses:
  - package.json / pyproject.toml / requirements.txt  (DETERMINISTIC)
  - Config files on disk (next.config, tailwind.config, etc.)  (DETERMINISTIC)
  - Import patterns in source files  (INFERRED)
  - File naming / directory patterns  (INFERRED)

Returns a list of DetectedTechnology objects, each with:
  - technology name
  - category  (frontend_framework, backend_framework, styling, db, testing, …)
  - confidence level + score
  - evidence items
  - where it is used (files)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar

from app.analysis.evidence import (
    Claim,
    ConfidenceLevel,
    EvidenceItem,
    EvidenceType,
    compute_confidence,
)

# ─────────────────────────── Result model ───────────────────────────


@dataclass
class DetectedTechnology:
    technology: str
    category: str  # frontend_framework | backend_framework | styling | state | db | testing | build | runtime | auth | other
    confidence_level: ConfidenceLevel
    confidence_score: float
    evidence_items: list[EvidenceItem] = field(default_factory=list)
    used_in_files: list[str] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "technology": self.technology,
            "category": self.category,
            "confidence_level": self.confidence_level.value,
            "confidence_score": round(self.confidence_score, 3),
            "evidence_items": [e.to_dict() for e in self.evidence_items],
            "used_in_files": self.used_in_files[:10],
            "notes": self.notes,
        }


@dataclass
class StackDetectionResult:
    technologies: list[DetectedTechnology] = field(default_factory=list)
    primary_language: str = "Unknown"
    primary_framework: str | None = None
    claims: list[Claim] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "technologies": [t.to_dict() for t in self.technologies],
            "primary_language": self.primary_language,
            "primary_framework": self.primary_framework,
        }

    def by_category(self, category: str) -> list[DetectedTechnology]:
        return [t for t in self.technologies if t.category == category]

    def get(self, technology: str) -> DetectedTechnology | None:
        return next(
            (t for t in self.technologies if t.technology.lower() == technology.lower()), None
        )


# ─────────────────────────── Detector ───────────────────────────


class StackDetector:
    """Evidence-backed stack detection.

    Usage:
        detector = StackDetector(file_infos, file_contents, repo_dir)
        result = detector.detect()
    """

    # (technology, category, package-key, config-file-patterns, import-patterns)
    JS_TECHNOLOGIES: ClassVar[list[tuple[str, str, list[str], list[str], list[str]]]] = [
        # Frontend frameworks
        (
            "React",
            "frontend_framework",
            ["react", "react-dom"],
            [],
            ["from 'react'", 'from "react"', "import React"],
        ),
        (
            "Next.js",
            "frontend_framework",
            ["next"],
            ["next.config.js", "next.config.mjs", "next.config.ts"],
            ["from 'next", 'from "next'],
        ),
        (
            "Vue.js",
            "frontend_framework",
            ["vue"],
            ["vue.config.js", "vue.config.ts"],
            ["from 'vue'", "createApp"],
        ),
        (
            "Angular",
            "frontend_framework",
            ["@angular/core"],
            ["angular.json"],
            ["@NgModule", "@Component", "from '@angular/"],
        ),
        (
            "Svelte",
            "frontend_framework",
            ["svelte"],
            ["svelte.config.js", "svelte.config.ts"],
            ["<script", ".svelte"],
        ),
        ("SolidJS", "frontend_framework", ["solid-js"], [], ["from 'solid-js'"]),
        (
            "Remix",
            "frontend_framework",
            ["@remix-run/react"],
            ["remix.config.js"],
            ["from '@remix-run/"],
        ),
        (
            "Astro",
            "frontend_framework",
            ["astro"],
            ["astro.config.mjs", "astro.config.ts"],
            ["from 'astro'"],
        ),
        # Backend frameworks
        (
            "Express",
            "backend_framework",
            ["express"],
            [],
            ["require('express')", "from 'express'", "express()"],
        ),
        ("Fastify", "backend_framework", ["fastify"], [], ["require('fastify')", "from 'fastify'"]),
        (
            "NestJS",
            "backend_framework",
            ["@nestjs/core"],
            [],
            ["@Module", "@Controller", "@Injectable", "from '@nestjs/"],
        ),
        ("Hono", "backend_framework", ["hono"], [], ["from 'hono'"]),
        ("Koa", "backend_framework", ["koa"], [], ["require('koa')", "from 'koa'"]),
        # Styling
        (
            "Tailwind CSS",
            "styling",
            ["tailwindcss"],
            ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs"],
            ["tailwind", "tw`", "className="],
        ),
        (
            "Styled Components",
            "styling",
            ["styled-components"],
            [],
            ["from 'styled-components'", "styled."],
        ),
        ("Emotion", "styling", ["@emotion/react", "@emotion/styled"], [], ["from '@emotion/"]),
        ("CSS Modules", "styling", ["css-loader"], [], [".module.css", ".module.scss"]),
        ("Sass/SCSS", "styling", ["sass", "node-sass"], [], [".scss"]),
        # State management
        (
            "Redux",
            "state_management",
            ["redux", "@reduxjs/toolkit"],
            [],
            ["createSlice", "configureStore", "from 'redux'"],
        ),
        ("Zustand", "state_management", ["zustand"], [], ["from 'zustand'", "create("]),
        ("MobX", "state_management", ["mobx"], [], ["from 'mobx'", "@observable"]),
        ("Jotai", "state_management", ["jotai"], [], ["from 'jotai'", "atom("]),
        ("Recoil", "state_management", ["recoil"], [], ["from 'recoil'", "atom({"]),
        (
            "TanStack Query",
            "state_management",
            ["@tanstack/react-query", "react-query"],
            [],
            ["useQuery", "useMutation", "QueryClient"],
        ),
        # Database / ORM
        (
            "Prisma",
            "database",
            ["prisma", "@prisma/client"],
            ["prisma/schema.prisma", "schema.prisma"],
            ["from '@prisma/client'", "PrismaClient"],
        ),
        ("Drizzle", "database", ["drizzle-orm"], [], ["from 'drizzle-orm'"]),
        ("TypeORM", "database", ["typeorm"], [], ["from 'typeorm'", "@Entity", "@Column"]),
        ("Mongoose", "database", ["mongoose"], [], ["from 'mongoose'", "mongoose.model"]),
        ("Sequelize", "database", ["sequelize"], [], ["from 'sequelize'"]),
        # Authentication
        ("NextAuth.js", "auth", ["next-auth"], [], ["from 'next-auth'", "NextAuth("]),
        ("Auth.js", "auth", ["@auth/core"], [], ["from '@auth/"]),
        ("Clerk", "auth", ["@clerk/nextjs", "@clerk/clerk-react"], [], ["from '@clerk/"]),
        ("Supabase", "auth", ["@supabase/supabase-js"], [], ["from '@supabase/", "createClient"]),
        ("Firebase", "auth", ["firebase"], [], ["from 'firebase'", "initializeApp"]),
        # Build tools
        ("Vite", "build_tool", ["vite"], ["vite.config.ts", "vite.config.js"], []),
        ("Webpack", "build_tool", ["webpack"], ["webpack.config.js"], []),
        ("Turbopack", "build_tool", [], ["turbo.json"], []),
        ("esbuild", "build_tool", ["esbuild"], [], []),
        # Testing
        (
            "Jest",
            "testing",
            ["jest", "@jest/core"],
            ["jest.config.js", "jest.config.ts"],
            ["describe(", "it(", "test(", "expect("],
        ),
        ("Vitest", "testing", ["vitest"], ["vitest.config.ts"], ["describe(", "test("]),
        ("Cypress", "testing", ["cypress"], ["cypress.config.js", "cypress.config.ts"], []),
        ("Playwright", "testing", ["@playwright/test"], ["playwright.config.ts"], []),
        ("Testing Library", "testing", ["@testing-library/react"], [], ["render(", "screen."]),
        # Runtime / Infra
        ("TypeScript", "language", ["typescript"], ["tsconfig.json"], []),
        ("Bun", "runtime", [], ["bun.lockb", "bunfig.toml"], []),
        ("Node.js", "runtime", [], [], []),
    ]

    PYTHON_TECHNOLOGIES: ClassVar[list[tuple[str, str, list[str], list[str]]]] = [
        ("FastAPI", "backend_framework", ["fastapi"], []),
        ("Django", "backend_framework", ["django"], ["manage.py", "settings.py"]),
        ("Flask", "backend_framework", ["flask"], []),
        ("SQLAlchemy", "database", ["sqlalchemy"], []),
        ("Alembic", "database", ["alembic"], ["alembic.ini"]),
        ("Pydantic", "validation", ["pydantic"], []),
        ("Celery", "queue", ["celery"], []),
        ("Redis (Python)", "cache", ["redis"], []),
        ("PostgreSQL (Python)", "database", ["psycopg2", "asyncpg"], []),
        ("Pytest", "testing", ["pytest"], ["pytest.ini", "pyproject.toml"]),
        ("SQLModel", "database", ["sqlmodel"], []),
        ("Tortoise ORM", "database", ["tortoise-orm"], []),
        ("Starlette", "backend_framework", ["starlette"], []),
        ("Strawberry (GraphQL)", "api", ["strawberry-graphql"], []),
    ]

    def __init__(
        self,
        file_infos: list[dict],
        file_contents: dict[str, str],
        repo_dir: Path | None = None,
    ):
        self.file_infos = file_infos
        self.file_contents = file_contents
        self.repo_dir = repo_dir
        self._file_names = {Path(f["path"]).name for f in file_infos}
        self._all_paths = {f["path"] for f in file_infos}
        self._source_content = "\n".join(
            v
            for k, v in file_contents.items()
            if Path(k).suffix in (".ts", ".tsx", ".js", ".jsx", ".py", ".vue", ".svelte")
        )

    def detect(self) -> StackDetectionResult:
        technologies: list[DetectedTechnology] = []

        # ── Language detection ──
        primary_language = self._detect_primary_language()

        # ── JS/TS ecosystem ──
        if primary_language in ("TypeScript", "JavaScript"):
            technologies.extend(self._detect_js_stack())

        # ── Python ecosystem ──
        if primary_language == "Python":
            technologies.extend(self._detect_python_stack())

        # ── Language tech (TypeScript is always separately surfaced) ──
        if any(f["extension"] in (".ts", ".tsx") for f in self.file_infos):
            if not any(t.technology == "TypeScript" for t in technologies):
                ts_files = [f["path"] for f in self.file_infos if f["extension"] in (".ts", ".tsx")]
                technologies.append(
                    DetectedTechnology(
                        technology="TypeScript",
                        category="language",
                        confidence_level=ConfidenceLevel.HIGH,
                        confidence_score=1.0,
                        evidence_items=[
                            EvidenceItem(
                                evidence_type=EvidenceType.FILE_PATTERN,
                                description=f"{len(ts_files)} .ts/.tsx files found",
                                file_paths=ts_files[:5],
                                weight=2.0,
                            )
                        ],
                        used_in_files=ts_files[:10],
                        notes=f"{len(ts_files)} TypeScript files",
                    )
                )

        # Sort by confidence score descending
        technologies.sort(key=lambda t: t.confidence_score, reverse=True)

        primary_framework = self._pick_primary_framework(technologies)

        return StackDetectionResult(
            technologies=technologies,
            primary_language=primary_language,
            primary_framework=primary_framework,
        )

    # ─────────────────────────── JS/TS detection ───────────────────────────

    def _detect_js_stack(self) -> list[DetectedTechnology]:
        results: list[DetectedTechnology] = []
        pkg = self._parse_package_json()
        dep_names = set(pkg.keys()) if pkg is not None else set()

        for tech, category, pkg_keys, config_files, import_patterns in self.JS_TECHNOLOGIES:
            evidence_items: list[EvidenceItem] = []
            used_files: list[str] = []

            # 1. Package dependency check (DETERMINISTIC)
            matched_pkg_keys = [k for k in pkg_keys if k in dep_names]
            if matched_pkg_keys:
                evidence_items.append(
                    EvidenceItem(
                        evidence_type=EvidenceType.PACKAGE_DEPENDENCY,
                        description=f"Found {', '.join(matched_pkg_keys)} in package.json",
                        file_paths=["package.json"],
                        content_snippet=", ".join(matched_pkg_keys),
                        weight=2.0,
                    )
                )

            # 2. Config file check (DETERMINISTIC)
            found_configs = [cf for cf in config_files if cf in self._file_names]
            if found_configs:
                config_paths = [
                    f["path"] for f in self.file_infos if Path(f["path"]).name in found_configs
                ]
                evidence_items.append(
                    EvidenceItem(
                        evidence_type=EvidenceType.CONFIG_FILE,
                        description=f"Config file(s) found: {', '.join(found_configs)}",
                        file_paths=config_paths,
                        weight=2.0,
                    )
                )

            # 3. Import pattern scan (INFERRED)
            if import_patterns and self._source_content:
                matched_patterns = [p for p in import_patterns if p in self._source_content]
                if matched_patterns:
                    # Find specific files using the patterns
                    pattern_files = self._find_files_with_patterns(import_patterns)
                    if pattern_files:
                        used_files = pattern_files[:10]
                        evidence_items.append(
                            EvidenceItem(
                                evidence_type=EvidenceType.IMPORT_PATTERN,
                                description=f"Import patterns found in {len(pattern_files)} file(s): {matched_patterns[0]}",
                                file_paths=pattern_files[:5],
                                weight=1.0,
                            )
                        )

            if not evidence_items:
                continue

            confidence_level, confidence_score = compute_confidence(evidence_items)

            results.append(
                DetectedTechnology(
                    technology=tech,
                    category=category,
                    confidence_level=confidence_level,
                    confidence_score=confidence_score,
                    evidence_items=evidence_items,
                    used_in_files=used_files,
                    notes=self._build_notes(tech, evidence_items),
                )
            )

        return results

    # ─────────────────────────── Python detection ───────────────────────────

    def _detect_python_stack(self) -> list[DetectedTechnology]:
        results: list[DetectedTechnology] = []
        py_text = self._get_python_deps_text()

        for tech, category, dep_keys, special_files in self.PYTHON_TECHNOLOGIES:
            evidence_items: list[EvidenceItem] = []

            # Dependency check
            matched = [k for k in dep_keys if k.lower() in py_text.lower()]
            if matched:
                dep_files = [
                    f["path"]
                    for f in self.file_infos
                    if Path(f["path"]).name in ("requirements.txt", "pyproject.toml", "setup.py")
                ]
                evidence_items.append(
                    EvidenceItem(
                        evidence_type=EvidenceType.PACKAGE_DEPENDENCY,
                        description=f"Found {', '.join(matched)} in Python deps",
                        file_paths=dep_files[:3],
                        weight=2.0,
                    )
                )

            # Special file check
            found_special = [sf for sf in special_files if sf in self._file_names]
            if found_special:
                special_paths = [
                    f["path"] for f in self.file_infos if Path(f["path"]).name in found_special
                ]
                evidence_items.append(
                    EvidenceItem(
                        evidence_type=EvidenceType.FILE_EXISTS,
                        description=f"Special file(s) found: {', '.join(found_special)}",
                        file_paths=special_paths,
                        weight=1.5,
                    )
                )

            if not evidence_items:
                continue

            confidence_level, confidence_score = compute_confidence(evidence_items)

            results.append(
                DetectedTechnology(
                    technology=tech,
                    category=category,
                    confidence_level=confidence_level,
                    confidence_score=confidence_score,
                    evidence_items=evidence_items,
                    used_in_files=[],
                    notes=self._build_notes(tech, evidence_items),
                )
            )

        return results

    # ─────────────────────────── Helpers ───────────────────────────

    def _detect_primary_language(self) -> str:
        ext_counts: dict[str, int] = {}
        for f in self.file_infos:
            ext = f.get("extension", "")
            if ext in (".ts", ".tsx"):
                ext_counts["TypeScript"] = ext_counts.get("TypeScript", 0) + 1
            elif ext in (".js", ".jsx", ".mjs"):
                ext_counts["JavaScript"] = ext_counts.get("JavaScript", 0) + 1
            elif ext == ".py":
                ext_counts["Python"] = ext_counts.get("Python", 0) + 1
            elif ext == ".go":
                ext_counts["Go"] = ext_counts.get("Go", 0) + 1
            elif ext == ".rs":
                ext_counts["Rust"] = ext_counts.get("Rust", 0) + 1
            elif ext == ".java":
                ext_counts["Java"] = ext_counts.get("Java", 0) + 1
            elif ext == ".rb":
                ext_counts["Ruby"] = ext_counts.get("Ruby", 0) + 1

        if not ext_counts:
            return "Unknown"
        return max(ext_counts, key=lambda k: ext_counts[k])

    def _parse_package_json(self) -> dict | None:
        raw = self.file_contents.get("package.json", "")
        if not raw:
            return None
        try:
            pkg = json.loads(raw)
            return {
                **pkg.get("dependencies", {}),
                **pkg.get("devDependencies", {}),
                **pkg.get("peerDependencies", {}),
            }
        except (json.JSONDecodeError, KeyError):
            return None

    def _get_python_deps_text(self) -> str:
        parts = [
            self.file_contents.get("requirements.txt", ""),
            self.file_contents.get("pyproject.toml", ""),
            self.file_contents.get("setup.py", ""),
            self.file_contents.get("setup.cfg", ""),
        ]
        return "\n".join(parts)

    def _find_files_with_patterns(self, patterns: list[str]) -> list[str]:
        found: list[str] = []
        for path, content in self.file_contents.items():
            if Path(path).suffix in (".ts", ".tsx", ".js", ".jsx", ".py", ".vue"):
                if any(p in content for p in patterns):
                    found.append(path)
        return found

    @staticmethod
    def _build_notes(tech: str, evidence_items: list[EvidenceItem]) -> str:
        parts = [e.description for e in evidence_items]
        return "; ".join(parts[:2])

    @staticmethod
    def _pick_primary_framework(technologies: list[DetectedTechnology]) -> str | None:
        priority_categories = ["frontend_framework", "backend_framework"]
        for cat in priority_categories:
            frameworks = [
                t
                for t in technologies
                if t.category == cat
                and t.confidence_level in (ConfidenceLevel.HIGH, ConfidenceLevel.MEDIUM)
            ]
            if frameworks:
                return frameworks[0].technology
        return None
