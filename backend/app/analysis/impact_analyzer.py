"""Change Impact Analyzer.

For any selected file or module, computes:
  - Direct dependents (files that directly import the target)
  - Second-order dependents (files that import the direct dependents)
  - Blast radius score (how broadly a change could ripple)
  - Affected modules (grouped by folder)
  - Affected entry points (pages, routes, main files)
  - Risk of change score
  - Recommended review path (what to check first)

The analysis is purely graph-driven — no LLM involved.

Usage:
    analyzer = ImpactAnalyzer(edges, file_infos, entry_points)
    result = analyzer.analyze(target_path)
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import PurePosixPath

# ─────────────────────────── Result models ───────────────────────────


@dataclass
class ImpactedFile:
    path: str
    module: str
    impact_distance: int  # 1 = direct, 2 = second-order, 3 = third-order
    is_entry_point: bool = False
    is_test: bool = False

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "module": self.module,
            "impact_distance": self.impact_distance,
            "is_entry_point": self.is_entry_point,
            "is_test": self.is_test,
        }


@dataclass
class ImpactedModule:
    name: str
    impacted_files: list[str] = field(default_factory=list)
    has_entry_points: bool = False
    max_distance: int = 1

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "impacted_files": self.impacted_files[:10],
            "has_entry_points": self.has_entry_points,
            "max_distance": self.max_distance,
            "file_count": len(self.impacted_files),
        }


@dataclass
class ImpactAnalysisResult:
    target_path: str
    blast_radius: int  # Total affected files (all distances)
    blast_radius_score: float  # 0.0–1.0
    blast_radius_label: str  # low | moderate | high | critical
    direct_dependents: list[ImpactedFile] = field(default_factory=list)
    second_order_dependents: list[ImpactedFile] = field(default_factory=list)
    third_order_dependents: list[ImpactedFile] = field(default_factory=list)
    affected_modules: list[ImpactedModule] = field(default_factory=list)
    affected_entry_points: list[str] = field(default_factory=list)
    affected_runtime_entry_points: list[dict] = field(default_factory=list)  # {path, kind}
    suggested_tests: list[dict] = field(default_factory=list)  # {path, reason}
    safe_to_change: bool = True
    change_risk_score: float = 0.0
    change_risk_label: str = "low"
    review_path: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)
    # New MVP fields — Change Impact + Review Guidance
    file_summary: dict = field(default_factory=dict)
    impact_classification: list[dict] = field(default_factory=list)
    review_plan: list[dict] = field(default_factory=list)
    suggested_checks: list[dict] = field(default_factory=list)
    related_files: list[dict] = field(default_factory=list)
    verdict: dict = field(default_factory=dict)
    confidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "target_path": self.target_path,
            "blast_radius": self.blast_radius,
            "blast_radius_score": round(self.blast_radius_score, 3),
            "blast_radius_label": self.blast_radius_label,
            "direct_dependents": [f.to_dict() for f in self.direct_dependents],
            "second_order_dependents": [f.to_dict() for f in self.second_order_dependents[:15]],
            "third_order_dependents": [f.to_dict() for f in self.third_order_dependents[:10]],
            "affected_modules": [m.to_dict() for m in self.affected_modules],
            "affected_entry_points": self.affected_entry_points,
            "affected_runtime_entry_points": self.affected_runtime_entry_points,
            "suggested_tests": self.suggested_tests,
            "safe_to_change": self.safe_to_change,
            "change_risk_score": round(self.change_risk_score, 3),
            "change_risk_label": self.change_risk_label,
            "review_path": self.review_path,
            "reasoning": self.reasoning,
            "file_summary": self.file_summary,
            "impact_classification": self.impact_classification,
            "review_plan": self.review_plan,
            "suggested_checks": self.suggested_checks,
            "related_files": self.related_files,
            "verdict": self.verdict,
            "confidence": self.confidence,
        }


# ─────────────────────────── Analyzer ───────────────────────────


class ImpactAnalyzer:
    """Graph-driven change impact analyzer.

    Works with plain dicts — no DB calls, usable in both async API and sync workers.
    """

    MAX_DEPTH = 3

    def __init__(
        self,
        edges: list[dict],  # [{source_path, target_path}, ...]
        file_infos: list[dict],  # [{path, is_entry_point, line_count, ...}, ...]
    ):
        self.file_infos = {f["path"]: f for f in file_infos}
        self.total_files = max(len(file_infos), 1)

        # Build reverse adjacency: target -> set of sources (who depends on target)
        self.dependents_of: dict[str, set[str]] = defaultdict(set)
        for edge in edges:
            src = edge.get("source_path", "")
            tgt = edge.get("target_path", "")
            if src and tgt:
                self.dependents_of[tgt].add(src)

    def analyze(self, target_path: str) -> ImpactAnalysisResult:
        """Compute full impact analysis for a target file."""

        # BFS up to MAX_DEPTH levels
        visited: dict[str, int] = {}  # path -> distance
        queue: deque[tuple[str, int]] = deque()

        # Start from direct dependents
        for dep in self.dependents_of.get(target_path, set()):
            if dep != target_path:
                queue.append((dep, 1))

        while queue:
            current, distance = queue.popleft()
            if current in visited or distance > self.MAX_DEPTH:
                continue
            visited[current] = distance

            if distance < self.MAX_DEPTH:
                for dep in self.dependents_of.get(current, set()):
                    if dep not in visited and dep != target_path:
                        queue.append((dep, distance + 1))

        # Classify files by distance
        by_distance: dict[int, list[ImpactedFile]] = defaultdict(list)
        for path, dist in visited.items():
            fi = self.file_infos.get(path, {})
            by_distance[dist].append(
                ImpactedFile(
                    path=path,
                    module=self._module_of(path),
                    impact_distance=dist,
                    is_entry_point=fi.get("is_entry_point", False)
                    or self._is_entry_point_name(path),
                    is_test=self._is_test(path),
                )
            )

        # Sort each level by entry_point first, then path
        for dist in by_distance:
            by_distance[dist].sort(key=lambda f: (not f.is_entry_point, f.path))

        direct = by_distance.get(1, [])
        second = by_distance.get(2, [])
        third = by_distance.get(3, [])
        all_impacted = direct + second + third
        blast_radius = len(all_impacted)

        # Affected modules
        module_map: dict[str, ImpactedModule] = {}
        for impacted in all_impacted:
            mod = impacted.module
            if mod not in module_map:
                module_map[mod] = ImpactedModule(name=mod)
            module_map[mod].impacted_files.append(impacted.path)
            if impacted.is_entry_point:
                module_map[mod].has_entry_points = True
            module_map[mod].max_distance = max(
                module_map[mod].max_distance, impacted.impact_distance
            )

        affected_modules = sorted(
            module_map.values(), key=lambda m: (not m.has_entry_points, -len(m.impacted_files))
        )

        affected_entry_points = [f.path for f in all_impacted if f.is_entry_point]

        # Runtime entry points (background jobs, HTTP routes, CLI commands, migrations)
        # are a distinct signal from "main.ts-style" static entry points. A change that
        # ripples into a Celery task or an API handler has real runtime blast radius
        # even if the file isn't the app's main() — this is the signal developers
        # repeatedly say they miss during code review.
        affected_runtime_entry_points: list[dict] = []
        runtime_seen: set[str] = set()
        for f in all_impacted:
            kind = self._runtime_entry_kind(f.path)
            if kind and f.path not in runtime_seen:
                runtime_seen.add(f.path)
                affected_runtime_entry_points.append({"path": f.path, "kind": kind})
        # Also check if the target itself is a runtime entry point
        self_kind = self._runtime_entry_kind(target_path)
        if self_kind and target_path not in runtime_seen:
            affected_runtime_entry_points.insert(
                0, {"path": target_path, "kind": self_kind + " (self)"}
            )

        # Suggested tests — covers the onboarding question
        # "which tests or checks should I run after editing this area?"
        suggested_tests = self._suggest_tests(target_path, all_impacted)

        # Risk scoring (now includes runtime entry points)
        blast_radius_score, blast_radius_label = self._blast_radius_score(
            blast_radius, self.total_files
        )
        change_risk_score, change_risk_label = self._change_risk_score(
            target_path,
            blast_radius,
            len(affected_entry_points) + len(affected_runtime_entry_points),
            direct,
        )
        safe_to_change = change_risk_score < 0.4

        # Review path
        review_path = self._build_review_path(direct, second, affected_entry_points)

        # Reasoning
        reasoning = self._build_reasoning(
            target_path,
            direct,
            second,
            affected_entry_points,
            affected_runtime_entry_points,
            suggested_tests,
            blast_radius,
            blast_radius_label,
        )

        return ImpactAnalysisResult(
            target_path=target_path,
            blast_radius=blast_radius,
            blast_radius_score=blast_radius_score,
            blast_radius_label=blast_radius_label,
            direct_dependents=direct,
            second_order_dependents=second,
            third_order_dependents=third,
            affected_modules=affected_modules,
            affected_entry_points=affected_entry_points,
            affected_runtime_entry_points=affected_runtime_entry_points,
            suggested_tests=suggested_tests,
            safe_to_change=safe_to_change,
            change_risk_score=change_risk_score,
            change_risk_label=change_risk_label,
            review_path=review_path,
            reasoning=reasoning,
            file_summary=self._build_file_summary(target_path),
            impact_classification=self._classify_impact(target_path),
            review_plan=self._build_review_plan(
                target_path,
                direct,
                second,
                affected_entry_points,
                affected_runtime_entry_points,
                affected_modules,
            ),
            suggested_checks=self._build_suggested_checks(
                target_path,
                direct,
                affected_entry_points,
                affected_runtime_entry_points,
            ),
            related_files=self._build_related_files(target_path, all_impacted),
            verdict=self._build_verdict(
                change_risk_label,
                blast_radius,
                len(direct),
                len(affected_entry_points) + len(affected_runtime_entry_points),
            ),
            confidence=self._build_confidence(
                target_path,
                direct,
                second,
                all_impacted,
                affected_runtime_entry_points,
            ),
        )

    # ─────────────────────────── Helpers ───────────────────────────

    @staticmethod
    def _module_of(path: str) -> str:
        parts = path.split("/")
        if len(parts) > 1:
            return parts[0]
        return "root"

    @staticmethod
    def _is_entry_point_name(path: str) -> bool:
        name = PurePosixPath(path).name.lower()
        return name in {
            "index.ts",
            "index.tsx",
            "index.js",
            "index.jsx",
            "main.ts",
            "main.tsx",
            "main.js",
            "app.ts",
            "app.tsx",
            "app.js",
            "server.ts",
            "server.js",
            "main.py",
            "app.py",
        }

    @staticmethod
    def _is_test(path: str) -> bool:
        return any(
            x in path.lower() for x in (".test.", ".spec.", "__tests__", "/tests/", "/test/")
        )

    def _blast_radius_score(self, blast_radius: int, total_files: int) -> tuple[float, str]:
        ratio = blast_radius / total_files
        if ratio >= 0.4 or blast_radius >= 30:
            return min(ratio, 1.0), "critical"
        elif ratio >= 0.2 or blast_radius >= 15:
            return ratio, "high"
        elif ratio >= 0.08 or blast_radius >= 5:
            return ratio, "moderate"
        else:
            return ratio, "low"

    def _change_risk_score(
        self,
        target_path: str,
        blast_radius: int,
        entry_point_count: int,
        direct_deps: list[ImpactedFile],
    ) -> tuple[float, str]:
        score = 0.0
        score += min(blast_radius / 30.0, 0.4)
        score += min(entry_point_count / 5.0, 0.3)
        score += min(len(direct_deps) / 10.0, 0.2)

        fi = self.file_infos.get(target_path, {})
        if fi.get("is_entry_point") or self._is_entry_point_name(target_path):
            score += 0.1

        score = min(score, 1.0)
        if score >= 0.7:
            label = "critical"
        elif score >= 0.5:
            label = "high"
        elif score >= 0.3:
            label = "moderate"
        else:
            label = "low"
        return score, label

    def _build_review_path(
        self,
        direct: list[ImpactedFile],
        second: list[ImpactedFile],
        entry_points: list[str],
    ) -> list[str]:
        path: list[str] = []
        seen: set[str] = set()

        # Entry points first (highest user-visible risk)
        for ep in entry_points[:3]:
            if ep not in seen:
                path.append(ep)
                seen.add(ep)

        # Then direct dependents
        for f in direct[:5]:
            if f.path not in seen and not f.is_test:
                path.append(f.path)
                seen.add(f.path)

        # Then second-order, non-test
        for f in second[:3]:
            if f.path not in seen and not f.is_test:
                path.append(f.path)
                seen.add(f.path)

        return path

    def _build_reasoning(
        self,
        target_path: str,
        direct: list[ImpactedFile],
        second: list[ImpactedFile],
        entry_points: list[str],
        runtime_entry_points: list[dict],
        suggested_tests: list[dict],
        blast_radius: int,
        blast_radius_label: str,
    ) -> list[str]:
        reasons: list[str] = []

        if not direct:
            reasons.append(f"No files import {target_path} — change is isolated.")
            if suggested_tests:
                reasons.append(
                    f"{len(suggested_tests)} nearby test file(s) worth running anyway "
                    f"(see Suggested tests)."
                )
            return reasons

        reasons.append(f"{len(direct)} file(s) directly import this file.")

        if second:
            reasons.append(
                f"{len(second)} additional file(s) are indirectly affected (second-order)."
            )

        if entry_points:
            reasons.append(
                f"{len(entry_points)} entry point(s) are in the blast radius: "
                f"{', '.join(entry_points[:3])}"
            )

        if runtime_entry_points:
            # Background jobs, API routes, CLI commands — easy to miss during review.
            kinds = sorted({r["kind"].split(" (")[0] for r in runtime_entry_points})
            reasons.append(
                f"{len(runtime_entry_points)} runtime entry point(s) affected "
                f"({', '.join(kinds[:4])}) — easy to miss in review."
            )

        if suggested_tests:
            reasons.append(
                f"{len(suggested_tests)} test file(s) suggested to run after this change."
            )

        reasons.append(f"Total blast radius: {blast_radius} file(s) ({blast_radius_label} impact).")

        return reasons

    # ─────────────────────────── Runtime entry points ───────────────────────────

    # Path patterns that strongly suggest a runtime entry point (not just a static
    # `main.ts` file). These are the signals developers repeatedly report missing
    # during code review: a change rippled into a Celery task, a FastAPI route, or
    # a cron job and nobody noticed until production.
    _RUNTIME_ENTRY_PATTERNS: tuple[tuple[str, str], ...] = (
        ("/workers/", "background worker"),
        ("/worker/", "background worker"),
        ("/tasks/", "background task"),
        ("/jobs/", "scheduled job"),
        ("/crons/", "cron job"),
        ("/cron/", "cron job"),
        ("/schedulers/", "scheduler"),
        ("/scheduler/", "scheduler"),
        ("/api/", "HTTP route"),
        ("/routes/", "HTTP route"),
        ("/handlers/", "HTTP handler"),
        ("/controllers/", "HTTP controller"),
        ("/endpoints/", "HTTP endpoint"),
        ("/cli/", "CLI command"),
        ("/commands/", "CLI command"),
        ("/migrations/", "database migration"),
        ("/migration/", "database migration"),
        ("/consumers/", "message consumer"),
        ("/listeners/", "event listener"),
        ("/webhooks/", "webhook handler"),
    )

    @classmethod
    def _runtime_entry_kind(cls, path: str) -> str | None:
        p = "/" + path.lower().lstrip("/")
        # Tests are not runtime entry points even if they live under /api/ etc.
        if any(x in p for x in (".test.", ".spec.", "/__tests__/", "/tests/", "/test/")):
            return None
        for needle, kind in cls._RUNTIME_ENTRY_PATTERNS:
            if needle in p:
                return kind
        return None

    # ─────────────────────────── Test suggestions ───────────────────────────

    def _suggest_tests(
        self,
        target_path: str,
        all_impacted: list[ImpactedFile],
    ) -> list[dict]:
        """Answer: "which tests or checks should I run after editing this area?"

        Priority order:
          1. Tests that directly import the target (strongest signal)
          2. Tests that import any file in the blast radius (indirectly cover)
          3. Tests in the same module folder as the target (proximity)
        """
        suggestions: list[dict] = []
        seen: set[str] = set()

        def add(path: str, reason: str) -> None:
            if path not in seen and path != target_path:
                seen.add(path)
                suggestions.append({"path": path, "reason": reason})

        # 1. Direct test dependents
        for f in all_impacted:
            if f.is_test and f.impact_distance == 1:
                add(f.path, "directly imports this file")

        # 2. Indirect test dependents (distance 2/3)
        for f in all_impacted:
            if f.is_test and f.impact_distance > 1:
                add(f.path, f"imports a file in the blast radius (distance {f.impact_distance})")

        # 3. Proximity — tests in the same module/folder when the signal above is thin
        if len(suggestions) < 3:
            target_module = self._module_of(target_path)
            target_parent = "/".join(target_path.split("/")[:-1])
            for path in self.file_infos:
                if not self._is_test(path) or path in seen:
                    continue
                # Prefer same parent directory, fall back to same top-level module
                same_parent = target_parent and path.startswith(target_parent + "/")
                same_module = self._module_of(path) == target_module
                if same_parent:
                    add(path, "lives in the same folder")
                elif same_module and len(suggestions) < 5:
                    add(path, f"lives in the same module ({target_module})")
                if len(suggestions) >= 8:
                    break

        return suggestions[:8]

    # ─────────────────────────── File classification ───────────────────────────
    #
    # The MVP "Change Impact + Review Guidance" feature classifies the target
    # file into one or more impact categories so the UI can give a developer
    # the right advice (e.g. "this is auth — verify the login flow").
    # Categories are inferred from path & extension only — no LLM, no guessing.

    _CATEGORY_PATTERNS: tuple[tuple[str, tuple[str, ...], str], ...] = (
        # category, path needles, human label
        ("test", ("/tests/", "/test/", "/__tests__/", ".test.", ".spec."), "Test code"),
        (
            "infra",
            (
                "dockerfile",
                "docker-compose",
                ".github/workflows/",
                "/k8s/",
                "/kubernetes/",
                "/terraform/",
                "/helm/",
                "/.devcontainer/",
            ),
            "Infrastructure / build",
        ),
        (
            "auth",
            (
                "/auth/",
                "/login",
                "/oauth",
                "/session",
                "/jwt",
                "/identity/",
                "/permission",
                "/rbac/",
            ),
            "Authentication / authorization",
        ),
        (
            "routing",
            (
                "/routes/",
                "/routing/",
                "/router/",
                "/api/",
                "/handlers/",
                "/controllers/",
                "/endpoints/",
            ),
            "HTTP routing",
        ),
        (
            "data",
            (
                "/models/",
                "/schemas/",
                "/db/",
                "/database/",
                "/migrations/",
                "/repositories/",
                "/repository/",
                "/dao/",
                "/orm/",
            ),
            "Data layer",
        ),
        (
            "worker",
            (
                "/workers/",
                "/worker/",
                "/tasks/",
                "/jobs/",
                "/cron/",
                "/crons/",
                "/consumers/",
                "/listeners/",
                "/webhooks/",
            ),
            "Background worker",
        ),
        (
            "ui",
            ("/components/", "/ui/", "/views/", "/pages/", "/screens/", "/layouts/"),
            "UI component",
        ),
        ("config", ("/config/", "/configs/", "/settings/"), "Configuration"),
    )

    _CONFIG_NAMES: frozenset[str] = frozenset(
        {
            "package.json",
            "tsconfig.json",
            "vite.config.ts",
            "vite.config.js",
            "next.config.js",
            "next.config.ts",
            "webpack.config.js",
            "tailwind.config.js",
            "tailwind.config.ts",
            "postcss.config.mjs",
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
            "requirements.txt",
            "alembic.ini",
            "pytest.ini",
            ".env",
            ".env.example",
            "docker-compose.yml",
            "docker-compose.yaml",
            "dockerfile",
            "makefile",
            "cargo.toml",
            "go.mod",
            "pom.xml",
            "build.gradle",
        }
    )

    _DOC_EXTS: frozenset[str] = frozenset({".md", ".mdx", ".rst", ".txt", ".adoc"})
    _CONFIG_EXTS: frozenset[str] = frozenset(
        {".json", ".yml", ".yaml", ".toml", ".ini", ".env", ".cfg", ".conf"}
    )
    _UI_EXTS: frozenset[str] = frozenset({".tsx", ".jsx", ".vue", ".svelte"})
    _CODE_EXTS: frozenset[str] = frozenset(
        {
            ".py",
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mjs",
            ".cjs",
            ".go",
            ".rs",
            ".java",
            ".kt",
            ".rb",
            ".php",
            ".cs",
            ".swift",
        }
    )

    @classmethod
    def _categorize_file(cls, path: str) -> tuple[list[str], str, str]:
        """Return (categories, primary_category, role_label)."""
        p = "/" + path.lower().lstrip("/")
        name = PurePosixPath(path).name.lower()
        ext = PurePosixPath(name).suffix

        cats: list[str] = []
        for cat, needles, _label in cls._CATEGORY_PATTERNS:
            if any(n in p for n in needles):
                cats.append(cat)

        # Extension-driven fallbacks (only if no path-derived signal already covers it)
        if name in cls._CONFIG_NAMES or ext in cls._CONFIG_EXTS:
            if "config" not in cats and "infra" not in cats:
                cats.append("config")
        if ext in cls._DOC_EXTS and "docs" not in cats:
            cats.append("docs")
        if ext in cls._UI_EXTS and "ui" not in cats and "test" not in cats:
            cats.append("ui")
        # Anything that is executable code and isn't already specialised → runtime
        if ext in cls._CODE_EXTS and not cats:
            cats.append("runtime")
        # Code that *is* in a specialised bucket (auth/routing/worker/ui/data) is
        # also runtime — surface that as a secondary tag so the verdict knows.
        if (
            ext in cls._CODE_EXTS
            and "runtime" not in cats
            and any(c in cats for c in ("auth", "routing", "worker", "data", "ui"))
        ):
            cats.append("runtime")
        if not cats:
            cats.append("supporting")

        # Pick a primary category (most specific wins)
        priority = [
            "auth",
            "routing",
            "data",
            "worker",
            "ui",
            "config",
            "infra",
            "test",
            "docs",
            "runtime",
            "supporting",
        ]
        primary = next((c for c in priority if c in cats), cats[0])

        role_labels = {
            "auth": "Authentication / authorization code",
            "routing": "HTTP route handler",
            "data": "Data / persistence layer",
            "worker": "Background worker / scheduled job",
            "ui": "UI component",
            "config": "Configuration file",
            "infra": "Infrastructure / build asset",
            "test": "Test file",
            "docs": "Documentation",
            "runtime": "Runtime application code",
            "supporting": "Supporting asset",
        }
        return cats, primary, role_labels[primary]

    def _build_file_summary(self, target_path: str) -> dict:
        cats, primary, role = self._categorize_file(target_path)
        name = PurePosixPath(target_path).name
        ext = PurePosixPath(name).suffix.lstrip(".") or "—"
        module = self._module_of(target_path)
        fi = self.file_infos.get(target_path, {})
        line_count = fi.get("line_count", 0)
        is_entry = bool(fi.get("is_entry_point") or self._is_entry_point_name(target_path))

        # Short factual summary — no guessing.
        bits: list[str] = [role]
        if is_entry:
            bits.append("flagged as an entry point")
        runtime_kind = self._runtime_entry_kind(target_path)
        if runtime_kind:
            bits.append(f"acts as a {runtime_kind}")
        if line_count:
            bits.append(f"~{line_count} LOC")
        summary = " · ".join(bits)

        return {
            "name": name,
            "path": target_path,
            "module": module,
            "extension": ext,
            "primary_category": primary,
            "categories": cats,
            "role": role,
            "summary": summary,
            "line_count": line_count,
            "is_entry_point": is_entry,
            "runtime_kind": runtime_kind,
        }

    def _classify_impact(self, target_path: str) -> list[dict]:
        """Tag the file with one or more impact types + the evidence for each."""
        cats, _primary, _role = self._categorize_file(target_path)
        p = "/" + target_path.lower().lstrip("/")
        name = PurePosixPath(target_path).name.lower()
        ext = PurePosixPath(name).suffix

        impact_meta: dict[str, tuple[str, str]] = {
            # category: (label, default reason)
            "auth": ("Authentication impact", "lives under an auth/identity path"),
            "routing": ("Routing impact", "lives under a routes/handlers path"),
            "data": ("Data layer impact", "lives under a models/db/migrations path"),
            "worker": ("Background job impact", "lives under a workers/tasks path"),
            "ui": ("UI impact", "is a UI component file"),
            "config": ("Configuration impact", "is a configuration file"),
            "infra": ("Infrastructure impact", "is a build / deployment asset"),
            "test": ("Test-only impact", "is a test file"),
            "docs": ("Documentation-only impact", "is a documentation file"),
            "runtime": ("Runtime impact", "is application source code"),
            "supporting": ("Supporting asset", "no specialised role detected"),
        }

        out: list[dict] = []
        seen: set[str] = set()
        for cat in cats:
            if cat in seen or cat not in impact_meta:
                continue
            seen.add(cat)
            label, default_reason = impact_meta[cat]
            # Try to attach a more specific reason for the well-known buckets.
            reason = default_reason
            for c, needles, _l in self._CATEGORY_PATTERNS:
                if c == cat:
                    hit = next((n for n in needles if n in p), None)
                    if hit:
                        reason = f"path contains '{hit.strip('/')}'"
                    break
            if cat == "config" and (name in self._CONFIG_NAMES or ext in self._CONFIG_EXTS):
                reason = f"config file ({name if name in self._CONFIG_NAMES else ext})"
            out.append({"type": cat, "label": label, "reason": reason})
        return out

    # ─────────────────────────── Review plan ───────────────────────────

    def _build_review_plan(
        self,
        target_path: str,
        direct: list[ImpactedFile],
        second: list[ImpactedFile],
        entry_points: list[str],
        runtime_entries: list[dict],
        modules: list[ImpactedModule],
    ) -> list[dict]:
        """Structured ordered review steps. Each step is shown as a card on the page."""
        plan: list[dict] = []
        order = 1

        non_test_direct = [f for f in direct if not f.is_test]

        if non_test_direct:
            plan.append(
                {
                    "order": order,
                    "title": "Review direct importers",
                    "detail": "These files import the target directly — any behaviour change here lands in them first.",
                    "files": [f.path for f in non_test_direct[:5]],
                }
            )
            order += 1

        if entry_points:
            plan.append(
                {
                    "order": order,
                    "title": "Trace user-facing entry points",
                    "detail": "App entry points sit inside the blast radius. Smoke-test the flows they expose.",
                    "files": entry_points[:5],
                }
            )
            order += 1

        if runtime_entries:
            plan.append(
                {
                    "order": order,
                    "title": "Verify runtime entry points",
                    "detail": "Background jobs, HTTP routes, and CLI commands inside the blast radius — these don't surface in unit tests.",
                    "files": [r["path"] for r in runtime_entries[:5]],
                }
            )
            order += 1

        non_test_second = [f for f in second if not f.is_test]
        if non_test_second:
            plan.append(
                {
                    "order": order,
                    "title": "Spot-check second-order consumers",
                    "detail": "These don't import the target directly, but they import something that does.",
                    "files": [f.path for f in non_test_second[:4]],
                }
            )
            order += 1

        cross_module = [m for m in modules if m.name != self._module_of(target_path)]
        if len(cross_module) >= 2:
            plan.append(
                {
                    "order": order,
                    "title": "Watch for cross-module spread",
                    "detail": f"Change crosses {len(cross_module)} module boundaries. Make sure the contract you change is owned by this module.",
                    "files": [],
                    "modules": [m.name for m in cross_module[:5]],
                }
            )
            order += 1

        if not plan:
            plan.append(
                {
                    "order": 1,
                    "title": "Safe to change in isolation",
                    "detail": "No file in the analysed graph imports this target. Verify deployment/build assumptions if this is a config or infra file; otherwise no follow-up is required.",
                    "files": [],
                }
            )
        return plan

    # ─────────────────────────── Suggested checks ───────────────────────────

    def _build_suggested_checks(
        self,
        target_path: str,
        direct: list[ImpactedFile],
        entry_points: list[str],
        runtime_entries: list[dict],
    ) -> list[dict]:
        """File-type-aware practical checks before merging the change."""
        cats, primary, _role = self._categorize_file(target_path)
        checks: list[dict] = []
        seen_keys: set[str] = set()

        def add(check: str, reason: str) -> None:
            key = check.lower()
            if key in seen_keys:
                return
            seen_keys.add(key)
            checks.append({"check": check, "reason": reason})

        # Category-specific
        if "auth" in cats:
            add("Test sign-in and protected-route flow", "auth/identity code is on the change path")
            add(
                "Verify session/token handling still parses correctly", "session/JWT logic in scope"
            )
        if "routing" in cats:
            add("Verify route paths and HTTP methods still resolve", "this is an HTTP routing file")
            add(
                "Check the response shape against API consumers",
                "downstream callers depend on this contract",
            )
        if "data" in cats:
            add(
                "Review schema/migration compatibility", "data layer change can break existing rows"
            )
            add("Run the ORM/integration tests for this module", "verify query shape is unchanged")
        if "worker" in cats or any(
            self._runtime_entry_kind(r["path"])
            in ("background worker", "background task", "scheduled job", "cron job")
            for r in runtime_entries
        ):
            add(
                "Trigger the worker manually after deploy", "background jobs don't surface in PR CI"
            )
            add(
                "Check the queue / scheduler health post-merge",
                "silent worker failures are easy to miss",
            )
        if "ui" in cats:
            add(
                "Smoke-test the affected screens in the browser",
                "UI changes need visual confirmation",
            )
        if "config" in cats:
            add(
                "Run the build with the new config locally",
                "config errors usually only show at boot",
            )
            add(
                "Confirm env-var consumers still receive valid values",
                "review who reads this config",
            )
        if "infra" in cats:
            add(
                "Run CI end-to-end and verify the container starts",
                "infra changes only fail at deploy time",
            )
        if "docs" in cats and not any(
            c in cats
            for c in ("runtime", "auth", "routing", "data", "ui", "config", "infra", "worker")
        ):
            add(
                "Render the markdown and check internal links",
                "docs-only change — no runtime impact expected",
            )

        # Generic, evidence-driven
        if direct:
            add(
                "Run the test suite for direct importers",
                f"{len(direct)} file(s) import this directly",
            )
        if entry_points:
            add(
                "Manually exercise the affected entry points",
                f"{len(entry_points)} entry point(s) are downstream",
            )
        if not direct and primary != "docs":
            add(
                "Confirm this file isn't loaded dynamically",
                "no static imports found — check for dynamic require/import",
            )

        return checks[:8]

    # ─────────────────────────── Related files ───────────────────────────

    def _build_related_files(
        self,
        target_path: str,
        all_impacted: list[ImpactedFile],
    ) -> list[dict]:
        """Files worth opening next that the dependents list doesn't already cover.

        Sources, in order of confidence:
          1. Same-folder neighbours (sibling files in the same directory)
          2. Same-module neighbours (one level up)
          3. Files this target itself imports (forward edges)
        """
        out: list[dict] = []
        seen: set[str] = {target_path, *(f.path for f in all_impacted)}

        target_parent = "/".join(target_path.split("/")[:-1])
        target_module = self._module_of(target_path)

        # 1. Same-folder
        if target_parent:
            for path in self.file_infos:
                if path in seen:
                    continue
                if (
                    path.startswith(target_parent + "/")
                    and "/" not in path[len(target_parent) + 1 :]
                ):
                    seen.add(path)
                    out.append(
                        {
                            "path": path,
                            "reason": "lives in the same folder",
                            "evidence": "module-derived",
                        }
                    )
                    if len(out) >= 4:
                        break

        # 2. Same-module
        if len(out) < 5:
            for path in self.file_infos:
                if path in seen:
                    continue
                if self._module_of(path) == target_module:
                    seen.add(path)
                    out.append(
                        {
                            "path": path,
                            "reason": f"same module ({target_module})",
                            "evidence": "module-derived",
                        }
                    )
                    if len(out) >= 5:
                        break

        # 3. Forward imports — what *this* file depends on (read from edges)
        # We only stored reverse edges; recompute forward on demand.
        forward: list[str] = []
        for tgt, sources in self.dependents_of.items():
            if target_path in sources and tgt != target_path and tgt not in seen:
                forward.append(tgt)
        for path in forward[:3]:
            seen.add(path)
            out.append({"path": path, "reason": "this file imports it", "evidence": "import-based"})

        return out[:8]

    # ─────────────────────────── Verdict ───────────────────────────

    def _build_verdict(
        self,
        risk_label: str,
        blast_radius: int,
        direct_count: int,
        entry_count: int,
    ) -> dict:
        if risk_label in ("high", "critical"):
            return {
                "label": "high_risk",
                "headline": "High risk — review the downstream graph carefully",
                "detail": (
                    f"{direct_count} direct importer(s) and {blast_radius} total file(s) in the blast radius, "
                    f"with {entry_count} entry point(s) downstream. Test the impacted flows before merge."
                ),
            }
        if risk_label == "moderate":
            return {
                "label": "moderate_risk",
                "headline": "Moderate risk — review affected modules",
                "detail": (
                    f"{direct_count} direct importer(s), {blast_radius} file(s) in blast radius. "
                    f"Walk the review path; pay attention to the modules tagged below."
                ),
            }
        if blast_radius == 0:
            return {
                "label": "isolated",
                "headline": "Safe to change in isolation",
                "detail": (
                    "No file in the analysed dependency graph imports this target. "
                    "If this is a config, infra, or docs file, still verify build/deploy assumptions."
                ),
            }
        return {
            "label": "low_risk",
            "headline": "Low risk — review nearby consumers",
            "detail": (
                f"Only {direct_count} direct importer(s) and {blast_radius} file(s) in blast radius. "
                f"Glance at the dependents list and you're done."
            ),
        }

    # ─────────────────────────── Confidence / evidence ───────────────────────────

    def _build_confidence(
        self,
        target_path: str,
        direct: list[ImpactedFile],
        second: list[ImpactedFile],
        all_impacted: list[ImpactedFile],
        runtime_entries: list[dict],
    ) -> dict:
        evidence: list[str] = ["module-derived"]
        if direct:
            evidence.append("import-based")
        if second or len(all_impacted) > len(direct):
            evidence.append("graph-traversal (≤3 hops)")
        if runtime_entries:
            evidence.append("entry-point evidence")
        if not direct:
            evidence.append("isolated by current graph evidence")

        # Confidence level — driven by data density.
        total_edges = sum(len(s) for s in self.dependents_of.values())
        if total_edges < 5:
            level = "low"
            note = "Repository has very few resolved imports; results are partial."
        elif direct:
            level = "high"
            note = "Verdict is grounded in real import edges."
        else:
            level = "medium"
            note = "No direct importers found in the static graph; dynamic imports (if any) won't be visible."

        return {
            "level": level,
            "evidence": evidence,
            "note": note,
        }

    # ─────────────────────────── Candidates (for "try a high-impact file") ───────────────────────────

    def top_candidates(self, limit: int = 6) -> list[dict]:
        """Return the most central / highest-impact files in the repo, for first-load demos.

        Score = direct dependents count + small bonus for entry points / runtime entries.
        Pure graph data — no LLM, no guessing.
        """
        scored: list[tuple[float, str, int, bool, str | None]] = []
        for path, fi in self.file_infos.items():
            if self._is_test(path):
                continue
            direct_count = len(self.dependents_of.get(path, set()))
            if direct_count == 0:
                continue
            is_entry = bool(fi.get("is_entry_point") or self._is_entry_point_name(path))
            runtime_kind = self._runtime_entry_kind(path)
            score = direct_count + (2 if is_entry else 0) + (1.5 if runtime_kind else 0)
            scored.append((score, path, direct_count, is_entry, runtime_kind))

        scored.sort(key=lambda x: (-x[0], x[1]))
        out: list[dict] = []
        for score, path, direct_count, is_entry, runtime_kind in scored[:limit]:
            _cats, primary, role = self._categorize_file(path)
            out.append(
                {
                    "path": path,
                    "direct_dependents": direct_count,
                    "is_entry_point": is_entry,
                    "runtime_kind": runtime_kind,
                    "primary_category": primary,
                    "role": role,
                    "score": round(float(score), 2),
                }
            )
        return out
