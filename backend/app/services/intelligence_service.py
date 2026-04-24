"""Intelligence Report service — gathers evidence and generates a senior-level repository audit."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.logging import get_logger
from app.models.repository import (
    Analysis,
    DependencyEdge,
    Insight,
    RepoFile,
    Repository,
    Symbol,
)
from app.schemas.intelligence import (
    AntiPatternSchema,
    ArchitectureLayer,
    ComplexityHotspot,
    ConfidenceNote,
    CritiquePoint,
    EvidenceItemSchema,
    FileRiskSchema,
    FlowStep,
    Improvement,
    IntelligenceReportResponse,
    ProjectIdentitySchema,
    QualityPoint,
    QualityReportSchema,
    ScoredMetricSchema,
    ScoreItem,
    StackItem,
)

settings = get_settings()
logger = get_logger(__name__)

# ── Heuristic thresholds ──
HIGH_FAN_IN = 6
HIGH_FAN_OUT = 10
LARGE_FILE_LINES = 400
MANY_SYMBOLS_PER_FILE = 25
GOOD_COHESION = 0.6

# ── Technology detection patterns ──
FRAMEWORK_INDICATORS: dict[str, dict] = {
    "React": {"files": ["package.json"], "markers": ["react", "react-dom"]},
    "Next.js": {"files": ["next.config"], "markers": ["next"]},
    "Vue": {"files": ["package.json"], "markers": ["vue"]},
    "Angular": {"files": ["angular.json"], "markers": ["@angular/core"]},
    "Svelte": {"files": ["svelte.config"], "markers": ["svelte"]},
    "Express": {"files": ["package.json"], "markers": ["express"]},
    "FastAPI": {"files": ["pyproject.toml", "requirements.txt"], "markers": ["fastapi"]},
    "Django": {"files": ["manage.py"], "markers": ["django"]},
    "Flask": {"files": ["requirements.txt"], "markers": ["flask"]},
    "Tailwind CSS": {"files": ["tailwind.config"], "markers": ["tailwindcss"]},
    "Prisma": {"files": ["schema.prisma"], "markers": ["prisma"]},
    "SQLAlchemy": {"files": ["pyproject.toml"], "markers": ["sqlalchemy"]},
    "TypeScript": {"files": ["tsconfig.json"], "markers": ["typescript"]},
}


class IntelligenceService:
    """Gathers evidence from repository analysis data and produces an intelligence report."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_report(
        self, analysis: Analysis, repo: Repository
    ) -> IntelligenceReportResponse:
        """Generate a full intelligence report from existing analysis data."""

        summary = analysis.summary_json or {}
        graph_metrics = summary.get("graph_metrics", {})
        top_modules = summary.get("top_modules", [])
        risk_areas = summary.get("risk_areas", [])
        entry_points = summary.get("entry_points", [])
        cycle_count = summary.get("cycle_count", 0)

        # ── Gather evidence from DB (serial — single AsyncSession) ──
        files = await self._get_files(repo.id)
        # Kick off disk sampling concurrently with remaining DB work.
        sample_task = asyncio.create_task(
            asyncio.to_thread(self._sample_file_contents_sync, repo, files)
        )
        symbols = await self._get_symbols(analysis.id)
        edges = await self._get_edges(analysis.id)
        insights = await self._get_insights(analysis.id)
        file_contents = await sample_task

        # ── Derived data ──
        file_paths = [f.path for f in files]
        extensions = self._count_extensions(files)
        fan_in, fan_out = self._compute_fan_maps(edges)
        symbols_per_file = self._symbols_per_file(symbols)
        large_files = [f for f in files if (f.line_count or 0) > LARGE_FILE_LINES]
        oversized_symbol_files = [
            p for p, cnt in symbols_per_file.items() if cnt > MANY_SYMBOLS_PER_FILE
        ]

        # ── Build report sections ──
        stack = self._detect_stack(files, file_contents, repo)
        architecture_layers = self._infer_architecture(top_modules, file_paths)
        app_flow, flow_notes = self._infer_app_flow(entry_points, stack, file_paths, file_contents)
        quality = self._assess_quality(top_modules, files, symbols, edges, cycle_count, extensions)
        complexity_overview, hotspots = self._assess_complexity(
            files, fan_in, fan_out, large_files, risk_areas, graph_metrics
        )
        optimization_notes = self._assess_optimization(
            large_files, oversized_symbol_files, fan_out, cycle_count, graph_metrics
        )
        critique = self._build_critique(
            top_modules,
            risk_areas,
            cycle_count,
            large_files,
            oversized_symbol_files,
            fan_in,
            fan_out,
            graph_metrics,
            insights,
            quality,
        )
        improvements = self._build_improvements(critique, quality, top_modules)
        confidence_notes = self._build_confidence_notes(files, symbols, edges, stack, entry_points)
        scores = self._compute_scores(
            top_modules,
            cycle_count,
            risk_areas,
            large_files,
            oversized_symbol_files,
            graph_metrics,
            quality,
        )

        # ── AI-enhanced synthesis (optional) ──
        ai_summary, ai_project_type, ai_domain = await self._ai_synthesize(
            analysis, repo, summary, stack, top_modules, entry_points, file_contents, graph_metrics
        )

        # ── Pull pre-computed engine results from summary_json ──
        identity_schema = self._build_identity_schema(summary, ai_project_type, ai_domain)
        quality_report_schema = self._build_quality_report_schema(summary)
        enriched_stack = self._enrich_stack_from_summary(stack, summary)

        return IntelligenceReportResponse(
            summary=ai_summary,
            project_type=ai_project_type,
            likely_domain=ai_domain,
            stack=enriched_stack,
            identity=identity_schema,
            architecture_overview=self._build_architecture_overview(
                repo, top_modules, graph_metrics
            ),
            architecture_layers=architecture_layers,
            app_flow=app_flow,
            app_flow_notes=flow_notes,
            quality_assessment=quality,
            quality_report=quality_report_schema,
            complexity_overview=complexity_overview,
            complexity_hotspots=hotspots,
            optimization_notes=optimization_notes,
            critique=critique,
            improvements=improvements,
            confidence_notes=confidence_notes,
            scores=scores,
            repo_name=repo.name,
            detected_framework=repo.detected_framework,
            detected_language=repo.detected_language,
            total_files=analysis.total_files or 0,
            total_lines=analysis.total_lines or 0,
            total_functions=analysis.total_functions or 0,
            total_classes=analysis.total_classes or 0,
        )

    # ──────────────────────── New engine helpers ────────────────────────

    @staticmethod
    def _build_identity_schema(
        summary: dict, fallback_type: str, fallback_domain: str
    ) -> ProjectIdentitySchema | None:
        """Build a ProjectIdentitySchema from pre-computed identity data in summary_json."""
        identity_data = summary.get("identity")
        if not identity_data or not isinstance(identity_data, dict):
            return None
        try:
            return ProjectIdentitySchema(
                project_type=identity_data.get("project_type", fallback_type or "unknown"),
                display_name=identity_data.get("display_name", fallback_type or "Unknown"),
                description=identity_data.get("description", fallback_domain or ""),
                confidence_level=identity_data.get("confidence_level", "low"),
                confidence_score=identity_data.get("confidence_score", 0.0),
                confidence_label=identity_data.get("confidence_label", ""),
                domain_entities=identity_data.get("domain_entities", []),
                likely_users=identity_data.get("likely_users", []),
                key_signals=identity_data.get("key_signals", []),
                alternative_types=identity_data.get("alternative_types", []),
                evidence_items=[
                    EvidenceItemSchema(**e)
                    for e in identity_data.get("evidence_items", [])
                    if isinstance(e, dict)
                ],
            )
        except Exception:
            return None

    @staticmethod
    def _build_quality_report_schema(summary: dict) -> QualityReportSchema | None:
        """Build QualityReportSchema from pre-computed quality data in summary_json."""
        quality_data = summary.get("quality")
        if not quality_data or not isinstance(quality_data, dict):
            return None
        try:
            metrics = [
                ScoredMetricSchema(**m)
                for m in quality_data.get("metrics", [])
                if isinstance(m, dict)
            ]
            file_risks = [
                FileRiskSchema(**r)
                for r in quality_data.get("file_risks", [])
                if isinstance(r, dict)
            ]
            anti_patterns = [
                AntiPatternSchema(**a)
                for a in quality_data.get("anti_patterns", [])
                if isinstance(a, dict)
            ]
            return QualityReportSchema(
                overall_score=quality_data.get("overall_score", 0.0),
                overall_label=quality_data.get("overall_label", "unknown"),
                metrics=metrics,
                file_risks=file_risks,
                anti_patterns=anti_patterns,
                refactor_priorities=quality_data.get("refactor_priorities", []),
                quick_wins=quality_data.get("quick_wins", []),
            )
        except Exception:
            return None

    @staticmethod
    def _enrich_stack_from_summary(
        existing_stack: list[StackItem], summary: dict
    ) -> list[StackItem]:
        """Replace or enrich the stack list with pre-computed evidence-backed results."""
        stack_data = summary.get("stack")
        if not stack_data or not isinstance(stack_data, dict):
            return existing_stack

        tech_list = stack_data.get("technologies", [])
        if not tech_list:
            return existing_stack

        enriched: list[StackItem] = []
        for t in tech_list:
            if not isinstance(t, dict):
                continue
            try:
                evidence_items = [
                    EvidenceItemSchema(**e)
                    for e in t.get("evidence_items", [])
                    if isinstance(e, dict)
                ]
                enriched.append(
                    StackItem(
                        technology=t.get("technology", ""),
                        category=t.get("category", "other"),
                        confidence_level=t.get("confidence_level", "medium"),
                        confidence_score=t.get("confidence_score", 0.5),
                        evidence_files=t.get("evidence_items", [{}])[0].get("file_paths", [])
                        if t.get("evidence_items")
                        else [],
                        used_in_files=t.get("used_in_files", []),
                        notes=t.get("notes", ""),
                        evidence_items=evidence_items,
                    )
                )
            except Exception:
                continue

        return enriched if enriched else existing_stack

    # ──────────────────────── DB helpers ────────────────────────

    async def _get_files(self, repo_id: uuid.UUID) -> list[RepoFile]:
        result = await self.db.execute(select(RepoFile).where(RepoFile.repository_id == repo_id))
        return list(result.scalars().all())

    async def _get_symbols(self, analysis_id: uuid.UUID) -> list[Symbol]:
        result = await self.db.execute(select(Symbol).where(Symbol.analysis_id == analysis_id))
        return list(result.scalars().all())

    async def _get_edges(self, analysis_id: uuid.UUID) -> list[DependencyEdge]:
        result = await self.db.execute(
            select(DependencyEdge).where(DependencyEdge.analysis_id == analysis_id)
        )
        return list(result.scalars().all())

    async def _get_insights(self, analysis_id: uuid.UUID) -> list[Insight]:
        result = await self.db.execute(select(Insight).where(Insight.analysis_id == analysis_id))
        return list(result.scalars().all())

    async def _sample_file_contents(
        self, repo: Repository, files: list[RepoFile], max_files: int = 30
    ) -> dict[str, str]:
        """Async wrapper — runs the blocking disk reads in a worker thread."""
        return await asyncio.to_thread(self._sample_file_contents_sync, repo, files, max_files)

    @staticmethod
    def _sample_file_contents_sync(
        repo: Repository, files: list[RepoFile], max_files: int = 30
    ) -> dict[str, str]:
        """Read a sample of key files for evidence gathering (blocking)."""
        contents: dict[str, str] = {}
        if not repo.local_path:
            return contents
        repo_dir = Path(repo.local_path)
        if not repo_dir.exists():
            return contents

        # Prioritize config and entry-point files
        priority_names = {
            "package.json",
            "tsconfig.json",
            "pyproject.toml",
            "requirements.txt",
            "setup.py",
            "Cargo.toml",
            "go.mod",
            "Gemfile",
            "composer.json",
            "angular.json",
            "next.config.js",
            "next.config.mjs",
            "vite.config.ts",
            "tailwind.config.js",
            "tailwind.config.ts",
            ".env.example",
            "README.md",
            "readme.md",
        }
        entry_files = [f for f in files if f.is_entry_point]
        config_files = [f for f in files if Path(f.path).name in priority_names]
        other_files = [f for f in files if f not in entry_files and f not in config_files]

        ordered = config_files + entry_files + other_files[:max_files]

        for f in ordered[:max_files]:
            try:
                fp = repo_dir / f.path
                if fp.exists() and fp.stat().st_size < 100_000:
                    raw = fp.read_text(encoding="utf-8", errors="replace")
                    # Keep first 200 lines for evidence
                    contents[f.path] = "\n".join(raw.splitlines()[:200])
            except Exception:
                continue

        return contents

    # ──────────────────────── Analysis helpers ────────────────────────

    @staticmethod
    def _count_extensions(files: list[RepoFile]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for f in files:
            ext = f.extension or ""
            counts[ext] = counts.get(ext, 0) + 1
        return counts

    @staticmethod
    def _compute_fan_maps(
        edges: list[DependencyEdge],
    ) -> tuple[dict[str, int], dict[str, int]]:
        fan_in: dict[str, int] = {}
        fan_out: dict[str, int] = {}
        for e in edges:
            fan_in[e.target_path] = fan_in.get(e.target_path, 0) + 1
            fan_out[e.source_path] = fan_out.get(e.source_path, 0) + 1
        return fan_in, fan_out

    @staticmethod
    def _symbols_per_file(symbols: list[Symbol]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for s in symbols:
            counts[s.file_path] = counts.get(s.file_path, 0) + 1
        return counts

    # ──────────────────────── Stack detection ────────────────────────

    @staticmethod
    def _detect_stack(
        files: list[RepoFile],
        file_contents: dict[str, str],
        repo: Repository,
    ) -> list[StackItem]:
        stack: list[StackItem] = []
        file_names = {Path(f.path).name for f in files}
        "\n".join(file_contents.values()).lower()

        # Package.json parsing
        pkg_json = file_contents.get("package.json", "")
        if pkg_json:
            import json

            try:
                pkg = json.loads(pkg_json)
                all_deps = {
                    **pkg.get("dependencies", {}),
                    **pkg.get("devDependencies", {}),
                }
                dep_names = set(all_deps.keys())

                # Frontend frameworks
                for fw, indicator in [
                    ("React", "react"),
                    ("Next.js", "next"),
                    ("Vue.js", "vue"),
                    ("Angular", "@angular/core"),
                    ("Svelte", "svelte"),
                    ("SolidJS", "solid-js"),
                ]:
                    if indicator in dep_names:
                        evidence = [
                            f.path
                            for f in files
                            if f.extension in (".tsx", ".jsx", ".vue", ".svelte")
                        ][:5]
                        stack.append(
                            StackItem(
                                technology=fw,
                                category="frontend_framework",
                                evidence_files=evidence,
                                notes=f"Found '{indicator}' in package.json dependencies",
                            )
                        )

                # Backend frameworks
                for fw, indicator in [
                    ("Express", "express"),
                    ("Fastify", "fastify"),
                    ("NestJS", "@nestjs/core"),
                    ("Hono", "hono"),
                ]:
                    if indicator in dep_names:
                        evidence = [
                            f.path
                            for f in files
                            if "server" in f.path.lower() or "api" in f.path.lower()
                        ][:5]
                        stack.append(
                            StackItem(
                                technology=fw,
                                category="backend_framework",
                                evidence_files=evidence,
                                notes=f"Found '{indicator}' in package.json",
                            )
                        )

                # Styling
                for tech, indicator in [
                    ("Tailwind CSS", "tailwindcss"),
                    ("Styled Components", "styled-components"),
                    ("Emotion", "@emotion/react"),
                    ("CSS Modules", "css-loader"),
                ]:
                    if indicator in dep_names:
                        evidence = [f.path for f in files if f.extension in (".css", ".scss")][:3]
                        stack.append(
                            StackItem(
                                technology=tech,
                                category="styling",
                                evidence_files=evidence,
                                notes=f"Found '{indicator}' in package.json",
                            )
                        )

                # State management
                for tech, indicator in [
                    ("Redux", "redux"),
                    ("Zustand", "zustand"),
                    ("MobX", "mobx"),
                    ("Jotai", "jotai"),
                    ("Recoil", "recoil"),
                ]:
                    if indicator in dep_names:
                        stack.append(
                            StackItem(
                                technology=tech,
                                category="state_management",
                                evidence_files=[],
                                notes=f"Found '{indicator}' in package.json",
                            )
                        )

                # Build tools
                for tech, indicator in [
                    ("Vite", "vite"),
                    ("Webpack", "webpack"),
                    ("esbuild", "esbuild"),
                    ("Turbopack", "turbopack"),
                ]:
                    if indicator in dep_names:
                        stack.append(
                            StackItem(
                                technology=tech,
                                category="build_tool",
                                evidence_files=[],
                                notes=f"Found '{indicator}' in package.json",
                            )
                        )

                # ORM / DB
                for tech, indicator in [
                    ("Prisma", "prisma"),
                    ("Drizzle", "drizzle-orm"),
                    ("TypeORM", "typeorm"),
                    ("Mongoose", "mongoose"),
                    ("Sequelize", "sequelize"),
                ]:
                    if indicator in dep_names:
                        stack.append(
                            StackItem(
                                technology=tech,
                                category="database",
                                evidence_files=[],
                                notes=f"Found '{indicator}' in package.json",
                            )
                        )

                # Testing
                for tech, indicator in [
                    ("Jest", "jest"),
                    ("Vitest", "vitest"),
                    ("Mocha", "mocha"),
                    ("Cypress", "cypress"),
                    ("Playwright", "playwright"),
                ]:
                    if indicator in dep_names:
                        stack.append(
                            StackItem(
                                technology=tech,
                                category="testing",
                                evidence_files=[],
                                notes=f"Found '{indicator}' in package.json",
                            )
                        )

            except (json.JSONDecodeError, KeyError):
                pass

        # Python-specific detection
        pyproject = file_contents.get("pyproject.toml", "")
        requirements = file_contents.get("requirements.txt", "")
        py_deps = (pyproject + "\n" + requirements).lower()

        if py_deps.strip():
            for tech, indicator in [
                ("FastAPI", "fastapi"),
                ("Django", "django"),
                ("Flask", "flask"),
                ("SQLAlchemy", "sqlalchemy"),
                ("Celery", "celery"),
                ("Pydantic", "pydantic"),
                ("Alembic", "alembic"),
                ("pytest", "pytest"),
            ]:
                if indicator in py_deps:
                    evidence = [f.path for f in files if f.extension == ".py"][:3]
                    stack.append(
                        StackItem(
                            technology=tech,
                            category="python",
                            evidence_files=evidence,
                            notes=f"Found '{indicator}' in Python dependencies",
                        )
                    )

        # Language detection from file extensions
        ext_lang_map = {
            ".ts": "TypeScript",
            ".tsx": "TypeScript (JSX)",
            ".js": "JavaScript",
            ".jsx": "JavaScript (JSX)",
            ".py": "Python",
            ".go": "Go",
            ".rs": "Rust",
            ".java": "Java",
            ".rb": "Ruby",
            ".php": "PHP",
        }
        ext_counts = IntelligenceService._count_extensions(files)
        for ext, lang in ext_lang_map.items():
            count = ext_counts.get(ext, 0)
            if count > 0:
                stack.append(
                    StackItem(
                        technology=lang,
                        category="language",
                        evidence_files=[f.path for f in files if f.extension == ext][:3],
                        notes=f"{count} files with {ext} extension",
                    )
                )

        # TypeScript detection
        if "tsconfig.json" in file_names:
            stack.append(
                StackItem(
                    technology="TypeScript",
                    category="language_tooling",
                    evidence_files=["tsconfig.json"],
                    notes="tsconfig.json present — TypeScript project",
                )
            )

        # Docker
        docker_files = [
            f.path
            for f in files
            if "dockerfile" in f.path.lower() or f.path == "docker-compose.yml"
        ]
        if docker_files:
            stack.append(
                StackItem(
                    technology="Docker",
                    category="infrastructure",
                    evidence_files=docker_files[:3],
                    notes=f"{len(docker_files)} Docker-related files found",
                )
            )

        return stack

    # ──────────────────────── Architecture ────────────────────────

    @staticmethod
    def _infer_architecture(modules: list[dict], file_paths: list[str]) -> list[ArchitectureLayer]:
        layers: list[ArchitectureLayer] = []
        module_names = {m["name"] for m in modules}

        layer_hints = [
            ("UI / Presentation", ["components", "pages", "views", "screens", "ui", "layouts"]),
            ("Routing", ["routes", "router", "routing", "pages"]),
            ("API / Controllers", ["api", "controllers", "routes", "endpoints", "handlers"]),
            ("Services / Business Logic", ["services", "usecases", "domain", "logic"]),
            ("Data / Models", ["models", "entities", "schemas", "types", "interfaces"]),
            ("State Management", ["store", "stores", "state", "redux", "atoms"]),
            ("Utilities", ["utils", "helpers", "lib", "common", "shared"]),
            ("Configuration", ["config", "settings", "constants", "env"]),
            ("Testing", ["tests", "test", "__tests__", "spec", "e2e"]),
            ("Workers / Background", ["workers", "jobs", "tasks", "queues", "cron"]),
            ("Infrastructure", ["infra", "deploy", "docker", "ci", "scripts"]),
        ]

        for layer_name, hints in layer_hints:
            matching_modules = [m for m in module_names if any(h in m.lower() for h in hints)]
            matching_files = [p for p in file_paths if any(h in p.lower() for h in hints)][:5]
            if matching_modules or matching_files:
                layers.append(
                    ArchitectureLayer(
                        name=layer_name,
                        description=f"Found in: {', '.join(matching_modules) if matching_modules else 'various files'}",
                        key_files=matching_files,
                    )
                )

        return layers

    @staticmethod
    def _build_architecture_overview(
        repo: Repository, modules: list[dict], graph_metrics: dict
    ) -> str:
        total = graph_metrics.get("total_nodes", 0)
        edges = graph_metrics.get("total_edges", 0)
        density = graph_metrics.get("density", 0)

        parts = []
        if repo.detected_framework:
            parts.append(
                f"This is a {repo.detected_framework} project "
                f"({repo.detected_language or 'unknown language'})."
            )
        parts.append(
            f"The dependency graph contains {total} files and {edges} dependency edges "
            f"(density: {density:.3f})."
        )
        if modules:
            names = [m["name"] for m in modules[:8]]
            parts.append(f"Major modules: {', '.join(names)}.")

        if density > 0.15:
            parts.append(
                "The graph density is relatively high, suggesting tight coupling between modules."
            )
        elif density < 0.03:
            parts.append(
                "The graph density is low, which may indicate loose coupling or many standalone files."
            )

        return " ".join(parts)

    # ──────────────────────── App Flow ────────────────────────

    @staticmethod
    def _infer_app_flow(
        entry_points: list[dict],
        stack: list[StackItem],
        file_paths: list[str],
        file_contents: dict[str, str],
    ) -> tuple[list[FlowStep], str]:
        steps: list[FlowStep] = []
        notes = ""
        step_num = 0
        {s.technology.lower() for s in stack}

        # Detect boot / entry
        if entry_points:
            main_ep = entry_points[0]
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"Application boots from entry point: {main_ep['path']}",
                    evidence_files=[main_ep["path"]],
                    confidence="high",
                )
            )

        # Detect routing layer
        route_files = [p for p in file_paths if "route" in p.lower() or "router" in p.lower()]
        if route_files:
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"Routing defined in {len(route_files)} file(s). Primary: {route_files[0]}",
                    evidence_files=route_files[:3],
                    confidence="high" if len(route_files) <= 3 else "medium",
                )
            )

        # Detect pages / views
        page_files = [
            p for p in file_paths if any(k in p.lower() for k in ("pages/", "views/", "screens/"))
        ]
        if page_files:
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"Application has {len(page_files)} page/view components.",
                    evidence_files=page_files[:5],
                    confidence="high",
                )
            )

        # Detect API layer
        api_files = [
            p
            for p in file_paths
            if any(k in p.lower() for k in ("api/", "controllers/", "endpoints/"))
        ]
        if api_files:
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"API/controller layer with {len(api_files)} file(s).",
                    evidence_files=api_files[:5],
                    confidence="high",
                )
            )

        # Detect service layer
        service_files = [p for p in file_paths if "service" in p.lower()]
        if service_files:
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"Service/business logic layer with {len(service_files)} file(s).",
                    evidence_files=service_files[:5],
                    confidence="medium",
                )
            )

        # Detect data layer
        model_files = [
            p for p in file_paths if any(k in p.lower() for k in ("models/", "entities/", "schema"))
        ]
        if model_files:
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"Data/model layer with {len(model_files)} file(s).",
                    evidence_files=model_files[:5],
                    confidence="medium",
                )
            )

        # Detect auth
        auth_files = [p for p in file_paths if "auth" in p.lower()]
        if auth_files:
            step_num += 1
            steps.append(
                FlowStep(
                    step=step_num,
                    description=f"Authentication logic found in {len(auth_files)} file(s).",
                    evidence_files=auth_files[:3],
                    confidence="medium",
                )
            )

        if not steps:
            notes = (
                "Insufficient evidence to determine application flow. "
                "No recognizable entry points, routes, or page structures were detected."
            )
        elif len(steps) < 3:
            notes = (
                "Only partial application flow could be inferred. "
                "Some layers may not follow conventional naming patterns."
            )

        return steps, notes

    # ──────────────────────── Code Quality ────────────────────────

    @staticmethod
    def _assess_quality(
        modules: list[dict],
        files: list[RepoFile],
        symbols: list[Symbol],
        edges: list[DependencyEdge],
        cycle_count: int,
        extensions: dict[str, int],
    ) -> list[QualityPoint]:
        points: list[QualityPoint] = []

        # Module structure
        if modules:
            avg_cohesion = sum(m.get("cohesion", 0) for m in modules) / len(modules)
            if avg_cohesion >= GOOD_COHESION:
                points.append(
                    QualityPoint(
                        area="Module Structure",
                        assessment="strong",
                        detail=f"Average module cohesion is {avg_cohesion:.0%}, indicating well-organized modules.",
                    )
                )
            elif avg_cohesion >= 0.35:
                points.append(
                    QualityPoint(
                        area="Module Structure",
                        assessment="adequate",
                        detail=f"Average module cohesion is {avg_cohesion:.0%}. Some modules could be better isolated.",
                    )
                )
            else:
                points.append(
                    QualityPoint(
                        area="Module Structure",
                        assessment="weak",
                        detail=f"Average module cohesion is only {avg_cohesion:.0%}. Modules are heavily cross-dependent.",
                    )
                )

        # Circular dependencies
        if cycle_count == 0:
            points.append(
                QualityPoint(
                    area="Circular Dependencies",
                    assessment="strong",
                    detail="No circular dependencies detected. Clean dependency flow.",
                )
            )
        elif cycle_count <= 3:
            points.append(
                QualityPoint(
                    area="Circular Dependencies",
                    assessment="adequate",
                    detail=f"{cycle_count} circular dependencies detected. Minor but should be addressed.",
                )
            )
        else:
            points.append(
                QualityPoint(
                    area="Circular Dependencies",
                    assessment="weak",
                    detail=f"{cycle_count} circular dependencies detected. This is a significant structural problem.",
                )
            )

        # File size consistency
        total = len(files)
        large = len([f for f in files if (f.line_count or 0) > LARGE_FILE_LINES])
        if total > 0:
            large_pct = large / total
            if large_pct < 0.05:
                points.append(
                    QualityPoint(
                        area="File Sizes",
                        assessment="strong",
                        detail=f"Only {large} of {total} files exceed {LARGE_FILE_LINES} lines. Files are well-scoped.",
                        evidence_files=[
                            f.path for f in files if (f.line_count or 0) > LARGE_FILE_LINES
                        ][:3],
                    )
                )
            elif large_pct < 0.15:
                points.append(
                    QualityPoint(
                        area="File Sizes",
                        assessment="adequate",
                        detail=f"{large} of {total} files exceed {LARGE_FILE_LINES} lines.",
                        evidence_files=[
                            f.path for f in files if (f.line_count or 0) > LARGE_FILE_LINES
                        ][:3],
                    )
                )
            else:
                points.append(
                    QualityPoint(
                        area="File Sizes",
                        assessment="weak",
                        detail=f"{large} of {total} files exceed {LARGE_FILE_LINES} lines. Too many oversized files.",
                        evidence_files=[
                            f.path for f in files if (f.line_count or 0) > LARGE_FILE_LINES
                        ][:5],
                    )
                )

        # Separation of concerns (check extension diversity)
        source_exts = {
            e for e in extensions if e in (".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs")
        }
        config_exts = {e for e in extensions if e in (".json", ".yaml", ".yml", ".toml")}
        style_exts = {e for e in extensions if e in (".css", ".scss", ".less")}
        if source_exts and (config_exts or style_exts):
            points.append(
                QualityPoint(
                    area="Separation of Concerns",
                    assessment="strong" if len(modules) > 3 else "adequate",
                    detail=(
                        f"Project uses {len(source_exts)} source languages, "
                        f"{len(config_exts)} config formats, and {len(style_exts)} style formats. "
                        f"Organized across {len(modules)} modules."
                    ),
                )
            )

        # Symbol export discipline
        exported = len([s for s in symbols if s.is_exported])
        total_sym = len(symbols)
        if total_sym > 0:
            export_ratio = exported / total_sym
            if 0.2 <= export_ratio <= 0.6:
                points.append(
                    QualityPoint(
                        area="Encapsulation",
                        assessment="strong",
                        detail=f"{export_ratio:.0%} of symbols are exported — indicates good encapsulation.",
                    )
                )
            elif export_ratio > 0.6:
                points.append(
                    QualityPoint(
                        area="Encapsulation",
                        assessment="weak",
                        detail=f"{export_ratio:.0%} of symbols are exported — too many public interfaces.",
                    )
                )

        return points

    # ──────────────────────── Complexity ────────────────────────

    @staticmethod
    def _assess_complexity(
        files: list[RepoFile],
        fan_in: dict[str, int],
        fan_out: dict[str, int],
        large_files: list[RepoFile],
        risk_areas: list[dict],
        graph_metrics: dict,
    ) -> tuple[str, list[ComplexityHotspot]]:
        high_fan_in_files = [(p, c) for p, c in fan_in.items() if c >= HIGH_FAN_IN]
        high_fan_out_files = [(p, c) for p, c in fan_out.items() if c >= HIGH_FAN_OUT]
        density = graph_metrics.get("density", 0)

        parts = []
        if high_fan_in_files:
            parts.append(
                f"{len(high_fan_in_files)} file(s) have high fan-in (≥{HIGH_FAN_IN} importers), "
                "making them risky to modify."
            )
        if high_fan_out_files:
            parts.append(
                f"{len(high_fan_out_files)} file(s) have high fan-out (≥{HIGH_FAN_OUT} dependencies), "
                "indicating tight coupling."
            )
        if large_files:
            parts.append(
                f"{len(large_files)} file(s) exceed {LARGE_FILE_LINES} lines — complexity hotspots."
            )
        if density > 0.1:
            parts.append(
                f"Graph density ({density:.3f}) is above average, suggesting interconnected code."
            )

        overview = (
            " ".join(parts)
            if parts
            else "Complexity appears manageable based on available metrics."
        )

        hotspots: list[ComplexityHotspot] = []
        seen = set()
        for risk in risk_areas:
            path = risk.get("path", "")
            if path in seen:
                continue
            seen.add(path)
            hotspots.append(
                ComplexityHotspot(
                    path=path,
                    reason=risk.get("reason", ""),
                    fan_in=fan_in.get(path, 0),
                    fan_out=fan_out.get(path, 0),
                    risk_score=risk.get("risk_score", 0),
                )
            )
        for path, count in high_fan_in_files:
            if path not in seen:
                seen.add(path)
                hotspots.append(
                    ComplexityHotspot(
                        path=path,
                        reason=f"High fan-in: {count} files depend on this",
                        fan_in=count,
                        fan_out=fan_out.get(path, 0),
                    )
                )
        for path, count in high_fan_out_files:
            if path not in seen:
                seen.add(path)
                hotspots.append(
                    ComplexityHotspot(
                        path=path,
                        reason=f"High fan-out: imports {count} dependencies",
                        fan_in=fan_in.get(path, 0),
                        fan_out=count,
                    )
                )

        hotspots.sort(key=lambda h: h.risk_score, reverse=True)
        return overview, hotspots[:20]

    # ──────────────────────── Optimization ────────────────────────

    @staticmethod
    def _assess_optimization(
        large_files: list[RepoFile],
        oversized_symbol_files: list[str],
        fan_out: dict[str, int],
        cycle_count: int,
        graph_metrics: dict,
    ) -> str:
        issues: list[str] = []

        if large_files:
            names = ", ".join(f.path for f in large_files[:3])
            issues.append(
                f"Oversized files ({len(large_files)} total, e.g. {names}) "
                "increase cognitive load and slow builds."
            )
        if oversized_symbol_files:
            issues.append(
                f"{len(oversized_symbol_files)} file(s) define >{MANY_SYMBOLS_PER_FILE} symbols. "
                "Consider splitting into focused modules."
            )
        if cycle_count > 0:
            issues.append(
                f"Circular dependencies ({cycle_count}) may cause increased bundle size "
                "and unpredictable initialization order."
            )
        heavy_importers = [(p, c) for p, c in fan_out.items() if c >= HIGH_FAN_OUT]
        if heavy_importers:
            issues.append(
                f"{len(heavy_importers)} file(s) import ≥{HIGH_FAN_OUT} modules. "
                "These are prime candidates for splitting or facade patterns."
            )

        return (
            " ".join(issues)
            if issues
            else "No obvious optimization issues detected from static analysis."
        )

    # ──────────────────────── Critique ────────────────────────

    @staticmethod
    def _build_critique(
        modules: list[dict],
        risk_areas: list[dict],
        cycle_count: int,
        large_files: list[RepoFile],
        oversized_symbol_files: list[str],
        fan_in: dict[str, int],
        fan_out: dict[str, int],
        graph_metrics: dict,
        insights: list[Insight],
        quality: list[QualityPoint],
    ) -> list[CritiquePoint]:
        critique: list[CritiquePoint] = []

        # Strengths
        strong_areas = [q for q in quality if q.assessment == "strong"]
        for q in strong_areas:
            critique.append(
                CritiquePoint(
                    kind="strength",
                    title=f"Strong: {q.area}",
                    detail=q.detail,
                    severity="low",
                    evidence_files=q.evidence_files,
                )
            )

        if modules and len(modules) >= 3:
            critique.append(
                CritiquePoint(
                    kind="strength",
                    title="Clear module boundaries",
                    detail=f"The project is organized into {len(modules)} distinct modules, aiding navigation.",
                )
            )

        # Weaknesses
        if cycle_count > 3:
            critique.append(
                CritiquePoint(
                    kind="weakness",
                    title=f"Significant circular dependencies ({cycle_count})",
                    detail=(
                        "Multiple circular dependency chains exist. This creates fragile coupling, "
                        "makes testing harder, and can cause runtime initialization issues."
                    ),
                    severity="high",
                )
            )
        elif cycle_count > 0:
            critique.append(
                CritiquePoint(
                    kind="weakness",
                    title=f"Minor circular dependencies ({cycle_count})",
                    detail="A few circular dependencies exist. Consider refactoring to break cycles.",
                    severity="medium",
                )
            )

        if large_files:
            critique.append(
                CritiquePoint(
                    kind="weakness",
                    title=f"{len(large_files)} oversized files",
                    detail=(
                        f"Files like {large_files[0].path} exceed {LARGE_FILE_LINES} lines. "
                        "Large files are harder to maintain, test, and review."
                    ),
                    severity="medium",
                    evidence_files=[f.path for f in large_files[:5]],
                )
            )

        # Risk areas
        high_risk = [r for r in risk_areas if r.get("risk_score", 0) > 0.6]
        if high_risk:
            critique.append(
                CritiquePoint(
                    kind="risk",
                    title=f"{len(high_risk)} high-risk files",
                    detail=(
                        f"Files like {high_risk[0]['path']} have high risk scores due to "
                        f"{high_risk[0].get('reason', 'multiple factors')}. "
                        "Changes to these files have a large blast radius."
                    ),
                    severity="high",
                    evidence_files=[r["path"] for r in high_risk[:5]],
                )
            )

        # Code smells
        if oversized_symbol_files:
            critique.append(
                CritiquePoint(
                    kind="smell",
                    title=f"God files detected ({len(oversized_symbol_files)})",
                    detail=(
                        f"Files with >{MANY_SYMBOLS_PER_FILE} symbols suggest classes/modules doing too much. "
                        "This violates single-responsibility and makes code harder to understand."
                    ),
                    severity="medium",
                    evidence_files=oversized_symbol_files[:5],
                )
            )

        # Low-cohesion modules
        low_cohesion = [m for m in modules if m.get("cohesion", 0) < 0.3]
        if low_cohesion:
            critique.append(
                CritiquePoint(
                    kind="weakness",
                    title=f"{len(low_cohesion)} weakly cohesive modules",
                    detail=(
                        f"Modules like '{low_cohesion[0]['name']}' have low internal cohesion, "
                        "meaning files in the module depend more on external code than on each other."
                    ),
                    severity="medium",
                )
            )

        density = graph_metrics.get("density", 0)
        if density > 0.15:
            critique.append(
                CritiquePoint(
                    kind="risk",
                    title="High dependency density",
                    detail=(
                        f"Graph density of {density:.3f} is unusually high. "
                        "Most files are interconnected, making isolated changes difficult."
                    ),
                    severity="high",
                )
            )

        # Weak areas
        weak_areas = [q for q in quality if q.assessment == "weak"]
        for q in weak_areas:
            critique.append(
                CritiquePoint(
                    kind="weakness",
                    title=f"Weak: {q.area}",
                    detail=q.detail,
                    severity="high",
                    evidence_files=q.evidence_files,
                )
            )

        return critique

    # ──────────────────────── Improvements ────────────────────────

    @staticmethod
    def _build_improvements(
        critique: list[CritiquePoint],
        quality: list[QualityPoint],
        modules: list[dict],
    ) -> list[Improvement]:
        improvements: list[Improvement] = []

        for c in critique:
            if c.kind == "strength":
                continue

            if "circular" in c.title.lower():
                improvements.append(
                    Improvement(
                        title="Break circular dependencies",
                        detail=(
                            "Introduce interface layers or extract shared logic into separate modules "
                            "to eliminate import cycles."
                        ),
                        effort="medium",
                        category="architecture",
                        evidence_files=c.evidence_files,
                    )
                )

            if "oversized" in c.title.lower() or "god file" in c.title.lower():
                improvements.append(
                    Improvement(
                        title="Split large files",
                        detail=(
                            "Break oversized files into smaller, focused modules. "
                            "Aim for <300 lines per file and single-responsibility per module."
                        ),
                        effort="medium",
                        category="refactor",
                        evidence_files=c.evidence_files,
                    )
                )

            if "high-risk" in c.title.lower():
                improvements.append(
                    Improvement(
                        title="Add tests for high-risk files",
                        detail=(
                            "High-risk files with large blast radius should have comprehensive "
                            "unit tests to prevent regressions."
                        ),
                        effort="medium",
                        category="testing",
                        evidence_files=c.evidence_files,
                    )
                )

            if "density" in c.title.lower():
                improvements.append(
                    Improvement(
                        title="Introduce layer boundaries",
                        detail=(
                            "Define clear architectural layers and limit cross-layer imports "
                            "to reduce coupling and graph density."
                        ),
                        effort="architectural",
                        category="architecture",
                    )
                )

            if "cohesi" in c.title.lower():
                improvements.append(
                    Improvement(
                        title="Restructure weakly cohesive modules",
                        detail=(
                            "Reorganize modules so that files within a module primarily depend "
                            "on each other rather than on external code."
                        ),
                        effort="architectural",
                        category="structure",
                    )
                )

        # Always-applicable quick wins
        weak = [q for q in quality if q.assessment == "weak"]
        if weak:
            improvements.append(
                Improvement(
                    title="Address critical quality gaps",
                    detail=f"Focus first on: {', '.join(q.area for q in weak)}.",
                    effort="quick-win",
                    category="quality",
                )
            )

        improvements.append(
            Improvement(
                title="Add project documentation",
                detail=(
                    "Ensure README covers setup, architecture overview, and contribution guidelines. "
                    "Add inline doc comments for public APIs."
                ),
                effort="quick-win",
                category="documentation",
            )
        )

        return improvements

    # ──────────────────────── Confidence Notes ────────────────────────

    @staticmethod
    def _build_confidence_notes(
        files: list[RepoFile],
        symbols: list[Symbol],
        edges: list[DependencyEdge],
        stack: list[StackItem],
        entry_points: list[dict],
    ) -> list[ConfidenceNote]:
        notes: list[ConfidenceNote] = []

        notes.append(
            ConfidenceNote(
                claim="Stack detection",
                confidence="high" if stack else "low",
                basis=(
                    f"Based on {len(stack)} detected technologies from package manifests and file analysis."
                    if stack
                    else "No package manifests found."
                ),
            )
        )

        notes.append(
            ConfidenceNote(
                claim="Architecture assessment",
                confidence="high" if len(edges) > 20 else ("medium" if edges else "low"),
                basis=f"Based on {len(edges)} dependency edges across {len(files)} files.",
            )
        )

        notes.append(
            ConfidenceNote(
                claim="Application flow",
                confidence="high" if entry_points else "low",
                basis=(
                    f"Based on {len(entry_points)} detected entry points."
                    if entry_points
                    else "No entry points detected — flow is speculative."
                ),
            )
        )

        notes.append(
            ConfidenceNote(
                claim="Code quality scores",
                confidence="medium",
                basis=(
                    "Scores are computed from structural heuristics (cohesion, coupling, file sizes, cycles). "
                    "They do not reflect runtime behavior, test coverage, or code correctness."
                ),
            )
        )

        return notes

    # ──────────────────────── Scores ────────────────────────

    @staticmethod
    def _compute_scores(
        modules: list[dict],
        cycle_count: int,
        risk_areas: list[dict],
        large_files: list[RepoFile],
        oversized_symbol_files: list[str],
        graph_metrics: dict,
        quality: list[QualityPoint],
    ) -> list[ScoreItem]:
        scores: list[ScoreItem] = []

        # Code Organization (0-10)
        org_score = 7.0
        if modules and len(modules) >= 3:
            avg_cohesion = sum(m.get("cohesion", 0) for m in modules) / len(modules)
            org_score = min(10, max(1, 5 + avg_cohesion * 5))
        if large_files:
            org_score = max(1, org_score - len(large_files) * 0.3)
        scores.append(
            ScoreItem(
                label="Code Organization",
                score=round(org_score, 1),
                confidence="high" if modules else "low",
                rationale=f"Based on {len(modules)} modules and file size distribution.",
            )
        )

        # Maintainability
        maint_score = 7.0
        if cycle_count > 0:
            maint_score -= min(3, cycle_count * 0.5)
        if oversized_symbol_files:
            maint_score -= min(2, len(oversized_symbol_files) * 0.4)
        maint_score = max(1, maint_score)
        scores.append(
            ScoreItem(
                label="Maintainability",
                score=round(maint_score, 1),
                confidence="medium",
                rationale=f"Adjusted for {cycle_count} cycles and {len(oversized_symbol_files)} oversized files.",
            )
        )

        # Complexity
        density = graph_metrics.get("density", 0)
        comp_score = max(1, 8 - density * 30 - len(large_files) * 0.2)
        comp_score = min(10, comp_score)
        scores.append(
            ScoreItem(
                label="Complexity",
                score=round(comp_score, 1),
                confidence="medium",
                rationale=f"Graph density {density:.3f}, {len(large_files)} large files.",
            )
        )

        # Architecture Clarity
        arch_score = 5.0
        if modules:
            arch_score = min(10, max(1, 3 + len(modules) * 0.5))
            if all(m.get("cohesion", 0) > 0.4 for m in modules[:5]):
                arch_score += 1.5
        weak_count = len([q for q in quality if q.assessment == "weak"])
        arch_score = max(1, arch_score - weak_count)
        scores.append(
            ScoreItem(
                label="Architecture Clarity",
                score=round(min(10, arch_score), 1),
                confidence="medium",
                rationale=f"Based on module count, cohesion, and {weak_count} weak quality areas.",
            )
        )

        # Risk Level (inverted: 10 = low risk, 1 = high risk)
        high_risk_count = len([r for r in risk_areas if r.get("risk_score", 0) > 0.6])
        risk_score = max(1, 10 - high_risk_count * 1.5 - cycle_count * 0.3)
        scores.append(
            ScoreItem(
                label="Risk Level",
                score=round(min(10, risk_score), 1),
                confidence="high" if risk_areas else "low",
                rationale=f"{high_risk_count} high-risk files, {cycle_count} cycles.",
            )
        )

        return scores

    # ──────────────────────── AI synthesis ────────────────────────

    async def _ai_synthesize(
        self,
        analysis: Analysis,
        repo: Repository,
        summary: dict,
        stack: list[StackItem],
        modules: list[dict],
        entry_points: list[dict],
        file_contents: dict[str, str],
        graph_metrics: dict,
    ) -> tuple[str, str, str]:
        """Use LLM to synthesize a natural summary. Falls back to heuristic."""

        stack_str = ", ".join(s.technology for s in stack[:15])
        module_str = ", ".join(m["name"] for m in modules[:10])
        ep_str = ", ".join(e["path"] for e in entry_points[:5])
        readme_content = file_contents.get("README.md", file_contents.get("readme.md", ""))[:1500]

        # Heuristic fallback
        framework = repo.detected_framework or "unknown framework"
        language = repo.detected_language or "unknown language"
        file_count = analysis.total_files or 0
        func_count = analysis.total_functions or 0

        heuristic_summary = (
            f"This is a {framework} project written primarily in {language}. "
            f"It contains {file_count} source files with {func_count} functions/methods. "
        )
        if modules:
            heuristic_summary += (
                f"The codebase is organized into {len(modules)} modules ({module_str}). "
            )
        if entry_points:
            heuristic_summary += f"Primary entry point(s): {ep_str}. "
        if readme_content:
            # Extract first line as a hint
            first_line = readme_content.strip().split("\n")[0].strip("#").strip()
            if first_line and len(first_line) > 10:
                heuristic_summary += f'The README describes it as: "{first_line}".'

        heuristic_project_type = (
            framework if framework != "unknown framework" else "Software project"
        )
        heuristic_domain = "Software development"

        # Try LLM synthesis
        if not settings.openai_api_key:
            return heuristic_summary, heuristic_project_type, heuristic_domain

        try:
            import openai

            client = openai.AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url or None,
            )

            prompt = f"""You are a senior software engineer reviewing a repository. Based ONLY on the evidence below, provide:
1. A concise 3-5 sentence summary of what this repository is and does.
2. The project type (e.g., "SaaS web application", "CLI tool", "API backend", "Component library").
3. The likely business/technical domain (e.g., "E-commerce", "Developer tools", "Healthcare").

Evidence:
- Framework: {framework}
- Language: {language}
- Stack: {stack_str}
- Modules: {module_str}
- Entry points: {ep_str}
- Files: {file_count}, Functions: {func_count}
- README excerpt: {readme_content[:800]}

Be direct and technical. Do NOT guess beyond the evidence. Do NOT use marketing language.
Format your response as three lines:
SUMMARY: <your summary>
TYPE: <project type>
DOMAIN: <domain>"""

            response = await client.chat.completions.create(
                model=settings.openai_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=500,
                timeout=12.0,
            )

            text = response.choices[0].message.content or ""
            summary_line = ""
            type_line = ""
            domain_line = ""
            for line in text.split("\n"):
                line = line.strip()
                if line.upper().startswith("SUMMARY:"):
                    summary_line = line[8:].strip()
                elif line.upper().startswith("TYPE:"):
                    type_line = line[5:].strip()
                elif line.upper().startswith("DOMAIN:"):
                    domain_line = line[7:].strip()

            return (
                summary_line or heuristic_summary,
                type_line or heuristic_project_type,
                domain_line or heuristic_domain,
            )

        except Exception as e:
            logger.warning("ai_synthesis_failed", error=str(e))
            return heuristic_summary, heuristic_project_type, heuristic_domain
