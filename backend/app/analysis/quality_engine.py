"""Quality and Risk Engine.

Computes explainable, evidence-backed quality and risk metrics for a repository.

Every score has:
  - numeric value (0-10)
  - label (poor / fair / good / excellent)
  - reasons explaining the score
  - evidence (file paths, metrics)
  - caveats

Metrics computed:
  - Maintainability Index (file sizes, complexity, cohesion)
  - Architecture Clarity (module structure, separation of concerns)
  - Dependency Risk (fan-in, fan-out, density, coupling)
  - Complexity Concentration (hotspot files, god files, centrality)
  - Anti-patterns detected (god files, cycle clusters, leaky layers)

Also provides:
  - Per-file risk scores with reasons
  - Module quality summaries
  - Refactor priorities
  - Anti-pattern list
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ─────────────────────────── Score data model ───────────────────────────


@dataclass
class ScoredMetric:
    """A single scored quality metric with full explanation."""

    name: str
    score: float  # 0.0 – 10.0 (10 = best)
    label: str  # poor | fair | good | excellent
    reasons: list[str] = field(default_factory=list)
    evidence_files: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    raw_values: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "score": round(self.score, 2),
            "label": self.label,
            "reasons": self.reasons,
            "evidence_files": self.evidence_files[:8],
            "caveats": self.caveats,
            "raw_values": self.raw_values,
        }


@dataclass
class FileRisk:
    """Risk assessment for a single file."""

    path: str
    risk_score: float  # 0.0 – 1.0
    risk_label: str  # low | moderate | high | critical
    fan_in: int = 0
    fan_out: int = 0
    line_count: int = 0
    symbol_count: int = 0
    betweenness: float = 0.0
    reasons: list[str] = field(default_factory=list)
    is_entry_point: bool = False

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "risk_score": round(self.risk_score, 3),
            "risk_label": self.risk_label,
            "fan_in": self.fan_in,
            "fan_out": self.fan_out,
            "line_count": self.line_count,
            "symbol_count": self.symbol_count,
            "betweenness": round(self.betweenness, 4),
            "reasons": self.reasons,
            "is_entry_point": self.is_entry_point,
        }


@dataclass
class AntiPattern:
    """An detected anti-pattern in the architecture."""

    kind: str  # god_file | mixed_concerns | leaky_layer | cycle_cluster | thin_wrapper
    title: str
    description: str
    severity: str  # low | medium | high
    affected_files: list[str] = field(default_factory=list)
    recommendation: str = ""

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "title": self.title,
            "description": self.description,
            "severity": self.severity,
            "affected_files": self.affected_files[:8],
            "recommendation": self.recommendation,
        }


@dataclass
class QualityReport:
    metrics: list[ScoredMetric] = field(default_factory=list)
    file_risks: list[FileRisk] = field(default_factory=list)
    anti_patterns: list[AntiPattern] = field(default_factory=list)
    overall_score: float = 0.0
    overall_label: str = "unknown"
    refactor_priorities: list[str] = field(default_factory=list)
    quick_wins: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "overall_score": round(self.overall_score, 2),
            "overall_label": self.overall_label,
            "metrics": [m.to_dict() for m in self.metrics],
            "file_risks": [f.to_dict() for f in self.file_risks[:20]],
            "anti_patterns": [a.to_dict() for a in self.anti_patterns],
            "refactor_priorities": self.refactor_priorities,
            "quick_wins": self.quick_wins,
        }


# ─────────────────────────── Engine ───────────────────────────


class QualityEngine:
    """Compute quality and risk metrics from analysis data.

    Inputs are plain dicts/lists (Celery-safe, no DB objects).
    """

    # Thresholds
    LARGE_FILE = 400  # lines
    VERY_LARGE_FILE = 800
    GOD_FILE_SYMBOLS = 30
    HIGH_FAN_IN = 6
    VERY_HIGH_FAN_IN = 12
    HIGH_FAN_OUT = 10
    VERY_HIGH_FAN_OUT = 20
    HIGH_CYCLE_COUNT = 3

    def __init__(
        self,
        file_infos: list[dict],
        edges: list[dict],  # [{source_path, target_path}, ...]
        symbols_per_file: dict[str, int],
        graph_metrics: dict,
        cycle_count: int,
        risk_scores: list[dict],  # from graph analyzer
        modules: list[dict],  # from graph analyzer
    ):
        self.file_infos = file_infos
        self.edges = edges
        self.symbols_per_file = symbols_per_file
        self.graph_metrics = graph_metrics
        self.cycle_count = cycle_count
        self.risk_scores = risk_scores
        self.modules = modules

        # Precompute
        self.file_map = {f["path"]: f for f in file_infos}
        self.fan_in, self.fan_out = self._compute_fans()

    def compute(self) -> QualityReport:
        metrics = [
            self._maintainability_metric(),
            self._architecture_clarity_metric(),
            self._dependency_risk_metric(),
            self._complexity_concentration_metric(),
            self._test_coverage_signal_metric(),
        ]

        overall = sum(m.score for m in metrics) / max(len(metrics), 1)
        overall_label = self._score_label(overall)

        file_risks = self._compute_file_risks()
        anti_patterns = self._detect_anti_patterns(file_risks)
        refactor_priorities = self._refactor_priorities(file_risks, anti_patterns)
        quick_wins = self._quick_wins(anti_patterns, metrics)

        return QualityReport(
            metrics=metrics,
            file_risks=file_risks,
            anti_patterns=anti_patterns,
            overall_score=overall,
            overall_label=overall_label,
            refactor_priorities=refactor_priorities,
            quick_wins=quick_wins,
        )

    # ─────────────────────────── Metrics ───────────────────────────

    def _maintainability_metric(self) -> ScoredMetric:
        reasons: list[str] = []
        evidence: list[str] = []
        deductions = 0.0

        large_files = [f for f in self.file_infos if (f.get("line_count") or 0) > self.LARGE_FILE]
        very_large = [f for f in large_files if (f.get("line_count") or 0) > self.VERY_LARGE_FILE]

        if very_large:
            deductions += min(len(very_large) * 1.5, 4.0)
            evidence.extend(f["path"] for f in very_large[:5])
            reasons.append(f"{len(very_large)} very large files (>{self.VERY_LARGE_FILE} lines)")
        elif large_files:
            deductions += min(len(large_files) * 0.5, 2.0)
            evidence.extend(f["path"] for f in large_files[:5])
            reasons.append(f"{len(large_files)} large files (>{self.LARGE_FILE} lines)")

        # God files (many symbols)
        god_files = [(p, c) for p, c in self.symbols_per_file.items() if c >= self.GOD_FILE_SYMBOLS]
        if god_files:
            deductions += min(len(god_files) * 1.0, 3.0)
            evidence.extend(p for p, _ in god_files[:3])
            reasons.append(
                f"{len(god_files)} 'god files' with {self.GOD_FILE_SYMBOLS}+ symbols each"
            )

        # Cycles
        if self.cycle_count > self.HIGH_CYCLE_COUNT:
            deductions += min(self.cycle_count * 0.5, 3.0)
            reasons.append(f"{self.cycle_count} circular dependencies detected")
        elif self.cycle_count > 0:
            deductions += self.cycle_count * 0.2
            reasons.append(f"{self.cycle_count} circular dependency(ies)")

        score = max(10.0 - deductions, 0.0)
        if not reasons:
            reasons.append("File sizes and symbol counts are within acceptable limits")

        return ScoredMetric(
            name="Maintainability",
            score=score,
            label=self._score_label(score),
            reasons=reasons,
            evidence_files=evidence,
            raw_values={
                "large_files": len(large_files),
                "very_large_files": len(very_large),
                "god_files": len(god_files),
                "cycle_count": self.cycle_count,
            },
        )

    def _architecture_clarity_metric(self) -> ScoredMetric:
        reasons: list[str] = []
        deductions = 0.0

        # Module cohesion
        low_cohesion = [
            m for m in self.modules if m.get("cohesion", 1.0) < 0.3 and m.get("file_count", 0) > 2
        ]
        if low_cohesion:
            deductions += min(len(low_cohesion) * 0.7, 3.0)
            reasons.append(f"{len(low_cohesion)} modules with low internal cohesion (<30%)")

        good_cohesion = [
            m for m in self.modules if m.get("cohesion", 0) >= 0.6 and m.get("file_count", 0) > 1
        ]

        # Structural organisation
        total_files = len(self.file_infos)
        root_files = sum(1 for f in self.file_infos if "/" not in f["path"])
        if total_files > 20 and root_files > 10:
            deductions += min((root_files - 10) * 0.2, 2.0)
            reasons.append(f"{root_files} files in root — consider deeper organisation")

        # Module diversity (many small single-file modules = poor structure)
        tiny_modules = [m for m in self.modules if m.get("file_count", 0) == 1]
        if len(tiny_modules) > len(self.modules) * 0.6 and len(self.modules) > 5:
            deductions += 1.5
            reasons.append("Most modules contain only 1 file — structure may be too flat")

        if good_cohesion and not reasons:
            reasons.append(f"{len(good_cohesion)} well-cohesive modules found")

        score = max(10.0 - deductions, 0.0)
        if not reasons:
            reasons.append("Module structure appears reasonable")

        return ScoredMetric(
            name="Architecture Clarity",
            score=score,
            label=self._score_label(score),
            reasons=reasons,
            raw_values={
                "total_modules": len(self.modules),
                "low_cohesion_modules": len(low_cohesion),
                "root_files": root_files,
            },
        )

    def _dependency_risk_metric(self) -> ScoredMetric:
        reasons: list[str] = []
        evidence: list[str] = []
        deductions = 0.0

        density = self.graph_metrics.get("density", 0)
        self.graph_metrics.get("total_nodes", 1)

        # High dependency density
        if density > 0.15:
            deductions += 2.5
            reasons.append(
                f"Very high dependency density ({density:.4f}) — tightly coupled codebase"
            )
        elif density > 0.08:
            deductions += 1.5
            reasons.append(f"Moderately high dependency density ({density:.4f})")

        # High fan-in files (many dependents)
        high_fi = [(p, c) for p, c in self.fan_in.items() if c >= self.HIGH_FAN_IN]
        if high_fi:
            deductions += min(len(high_fi) * 0.4, 2.5)
            evidence.extend(p for p, _ in sorted(high_fi, key=lambda x: x[1], reverse=True)[:5])
            reasons.append(f"{len(high_fi)} high fan-in files (risky to change)")

        # High fan-out files (many dependencies)
        high_fo = [(p, c) for p, c in self.fan_out.items() if c >= self.HIGH_FAN_OUT]
        if high_fo:
            deductions += min(len(high_fo) * 0.3, 2.0)
            reasons.append(f"{len(high_fo)} high fan-out files (tightly coupled)")

        # Cycles
        if self.cycle_count > 0:
            deductions += min(self.cycle_count * 0.4, 2.5)
            reasons.append(
                f"{self.cycle_count} circular dependenc{'y' if self.cycle_count == 1 else 'ies'}"
            )

        score = max(10.0 - deductions, 0.0)
        if not reasons:
            reasons.append("Dependency coupling appears manageable")

        return ScoredMetric(
            name="Dependency Risk",
            score=score,
            label=self._score_label(score),
            reasons=reasons,
            evidence_files=evidence,
            raw_values={
                "density": round(density, 6),
                "high_fan_in_count": len(high_fi),
                "high_fan_out_count": len(high_fo),
                "cycle_count": self.cycle_count,
            },
        )

    def _complexity_concentration_metric(self) -> ScoredMetric:
        reasons: list[str] = []
        evidence: list[str] = []
        deductions = 0.0

        total_files = max(len(self.file_infos), 1)

        # Top 10% of files by line count
        sorted_by_size = sorted(self.file_infos, key=lambda f: f.get("line_count", 0), reverse=True)
        top_10_pct = max(int(total_files * 0.1), 1)
        top_files = sorted_by_size[:top_10_pct]
        top_lines = sum(f.get("line_count", 0) for f in top_files)
        total_lines = sum(f.get("line_count", 0) for f in self.file_infos) or 1
        concentration = top_lines / total_lines

        if concentration > 0.7:
            deductions += 3.0
            evidence.extend(f["path"] for f in top_files[:5])
            reasons.append(
                f"Top {top_10_pct} file(s) contain {concentration:.0%} of all code (extreme concentration)"
            )
        elif concentration > 0.5:
            deductions += 1.5
            evidence.extend(f["path"] for f in top_files[:3])
            reasons.append(f"Top {top_10_pct} file(s) contain {concentration:.0%} of all code")

        # High-risk files from graph analysis
        critical_risks = [r for r in self.risk_scores if r.get("risk_score", 0) > 0.7]
        if critical_risks:
            deductions += min(len(critical_risks) * 0.5, 2.0)
            evidence.extend(r["path"] for r in critical_risks[:3])
            reasons.append(f"{len(critical_risks)} files at critical risk level")

        central_files = self.graph_metrics.get("central_files", [])
        if central_files and total_files > 10:
            # If top 3 files have vastly more connections than others, it's a bottleneck
            top_connections = central_files[0].get("connections", 0) if central_files else 0
            avg_connections = self.graph_metrics.get("avg_in_degree", 0) + self.graph_metrics.get(
                "avg_out_degree", 0
            )
            if avg_connections > 0 and top_connections > avg_connections * 5:
                deductions += 1.5
                evidence.append(central_files[0]["path"])
                reasons.append(
                    f"Extreme centrality hotspot: {central_files[0]['path']} ({top_connections} connections vs avg {avg_connections:.1f})"
                )

        score = max(10.0 - deductions, 0.0)
        if not reasons:
            reasons.append("Complexity appears reasonably distributed")

        return ScoredMetric(
            name="Complexity Distribution",
            score=score,
            label=self._score_label(score),
            reasons=reasons,
            evidence_files=evidence,
            raw_values={
                "top_10pct_concentration": round(concentration, 3),
                "critical_risk_files": len(critical_risks),
            },
        )

    def _test_coverage_signal_metric(self) -> ScoredMetric:
        """Signal-based test presence estimation (not true coverage)."""
        reasons: list[str] = []

        test_files = [
            f
            for f in self.file_infos
            if any(x in f["path"].lower() for x in ("test", "spec", "__tests__"))
            and f.get("extension") in (".ts", ".tsx", ".js", ".jsx", ".py")
        ]
        source_files = [
            f
            for f in self.file_infos
            if f.get("extension") in (".ts", ".tsx", ".js", ".jsx", ".py")
            and not any(x in f["path"].lower() for x in ("test", "spec", "__tests__"))
        ]

        total_source = max(len(source_files), 1)
        test_ratio = len(test_files) / total_source

        if test_ratio >= 0.3:
            score = 8.0
            reasons.append(f"{len(test_files)} test files found ({test_ratio:.0%} of source files)")
        elif test_ratio >= 0.1:
            score = 5.0
            reasons.append(
                f"{len(test_files)} test files found ({test_ratio:.0%} of source files) — limited test coverage"
            )
        elif test_ratio > 0:
            score = 3.0
            reasons.append(
                f"Only {len(test_files)} test file(s) found — very limited test presence"
            )
        else:
            score = 1.0
            reasons.append("No test files detected — testing setup unclear or absent")

        return ScoredMetric(
            name="Test Presence",
            score=score,
            label=self._score_label(score),
            reasons=reasons,
            caveats=["This metric detects test file presence only, not actual test coverage"],
            raw_values={
                "test_files": len(test_files),
                "source_files": total_source,
                "ratio": round(test_ratio, 3),
            },
        )

    # ─────────────────────────── File risks ───────────────────────────

    def _compute_file_risks(self) -> list[FileRisk]:
        risks: list[FileRisk] = []

        # Merge graph risk scores with file metadata
        risk_map = {r["path"]: r for r in self.risk_scores}

        # Also compute for high fan-in/out files not in risk_scores
        all_candidates = set(risk_map.keys())
        all_candidates.update(p for p, c in self.fan_in.items() if c >= self.HIGH_FAN_IN)
        all_candidates.update(p for p, c in self.fan_out.items() if c >= self.HIGH_FAN_OUT)
        all_candidates.update(
            p for p, c in self.symbols_per_file.items() if c >= self.GOD_FILE_SYMBOLS
        )
        large_paths = {
            f["path"] for f in self.file_infos if (f.get("line_count") or 0) > self.LARGE_FILE
        }
        all_candidates.update(large_paths)

        for path in all_candidates:
            fi = self.file_map.get(path, {})
            fi_deg = self.fan_in.get(path, 0)
            fo_deg = self.fan_out.get(path, 0)
            line_count = fi.get("line_count", 0) or 0
            sym_count = self.symbols_per_file.get(path, 0)
            graph_risk = risk_map.get(path, {})
            betweenness = graph_risk.get("betweenness", 0.0)

            # Compute composite risk
            risk_score = (
                min(fi_deg / self.VERY_HIGH_FAN_IN, 1.0) * 0.35
                + min(fo_deg / self.VERY_HIGH_FAN_OUT, 1.0) * 0.2
                + min(line_count / self.VERY_LARGE_FILE, 1.0) * 0.2
                + min(sym_count / self.GOD_FILE_SYMBOLS, 1.0) * 0.15
                + min(betweenness * 10, 1.0) * 0.1
            )

            reasons = []
            if fi_deg >= self.HIGH_FAN_IN:
                reasons.append(f"{fi_deg} files depend on this (high fan-in)")
            if fo_deg >= self.HIGH_FAN_OUT:
                reasons.append(f"imports {fo_deg} other files (high fan-out)")
            if line_count > self.VERY_LARGE_FILE:
                reasons.append(f"{line_count:,} lines (very large file)")
            elif line_count > self.LARGE_FILE:
                reasons.append(f"{line_count:,} lines (large file)")
            if sym_count >= self.GOD_FILE_SYMBOLS:
                reasons.append(f"{sym_count} symbols (potential god file)")
            if betweenness > 0.05:
                reasons.append("central bridge in dependency graph")

            if not reasons:
                continue

            risks.append(
                FileRisk(
                    path=path,
                    risk_score=round(risk_score, 3),
                    risk_label=self._risk_label(risk_score),
                    fan_in=fi_deg,
                    fan_out=fo_deg,
                    line_count=line_count,
                    symbol_count=sym_count,
                    betweenness=betweenness,
                    reasons=reasons,
                    is_entry_point=fi.get("is_entry_point", False),
                )
            )

        risks.sort(key=lambda r: r.risk_score, reverse=True)
        return risks[:25]

    # ─────────────────────────── Anti-patterns ───────────────────────────

    def _detect_anti_patterns(self, file_risks: list[FileRisk]) -> list[AntiPattern]:
        patterns: list[AntiPattern] = []

        # God files
        god_files = [r for r in file_risks if r.symbol_count >= self.GOD_FILE_SYMBOLS]
        if god_files:
            patterns.append(
                AntiPattern(
                    kind="god_file",
                    title="God File(s) Detected",
                    description=f"{len(god_files)} file(s) have {self.GOD_FILE_SYMBOLS}+ symbols, suggesting too many responsibilities in one place.",
                    severity="high" if len(god_files) > 2 else "medium",
                    affected_files=[r.path for r in god_files[:5]],
                    recommendation="Split large files into focused modules with single responsibilities.",
                )
            )

        # High fan-in hub files
        hub_files = [r for r in file_risks if r.fan_in >= self.VERY_HIGH_FAN_IN]
        if hub_files:
            patterns.append(
                AntiPattern(
                    kind="dependency_hub",
                    title="Dependency Hub(s)",
                    description=f"{len(hub_files)} file(s) are imported by {self.VERY_HIGH_FAN_IN}+ other files, creating fragile central points.",
                    severity="high" if len(hub_files) > 1 else "medium",
                    affected_files=[r.path for r in hub_files[:5]],
                    recommendation="Consider breaking hub files into smaller, more specific interfaces to reduce blast radius.",
                )
            )

        # Mixed concerns (UI files with too many symbols / large UI components)
        ui_files = [
            r
            for r in file_risks
            if any(kw in r.path.lower() for kw in ("component", "page", "view", "screen"))
            and r.symbol_count >= self.GOD_FILE_SYMBOLS // 2
        ]
        if ui_files:
            patterns.append(
                AntiPattern(
                    kind="mixed_concerns",
                    title="UI Files With Heavy Logic",
                    description=f"{len(ui_files)} UI/component file(s) have unusually many symbols, suggesting mixed UI and business logic.",
                    severity="medium",
                    affected_files=[r.path for r in ui_files[:5]],
                    recommendation="Extract business logic from UI components into separate service or hook files.",
                )
            )

        # Cycles
        if self.cycle_count >= self.HIGH_CYCLE_COUNT:
            patterns.append(
                AntiPattern(
                    kind="cycle_cluster",
                    title="Circular Dependency Cluster",
                    description=f"{self.cycle_count} circular dependencies detected. Circular dependencies make code harder to test, refactor, and understand.",
                    severity="high" if self.cycle_count > 5 else "medium",
                    affected_files=[],
                    recommendation="Resolve circular dependencies by extracting shared code into a lower-level module or using dependency inversion.",
                )
            )

        # Very high fan-out (utility sprawl)
        high_fo_files = [r for r in file_risks if r.fan_out >= self.VERY_HIGH_FAN_OUT]
        if high_fo_files:
            patterns.append(
                AntiPattern(
                    kind="utility_sprawl",
                    title="Over-Coupled Files",
                    description=f"{len(high_fo_files)} file(s) import {self.VERY_HIGH_FAN_OUT}+ other modules, indicating potential over-coupling.",
                    severity="medium",
                    affected_files=[r.path for r in high_fo_files[:5]],
                    recommendation="Reduce imports by introducing facade patterns or restructuring module responsibilities.",
                )
            )

        return patterns

    # ─────────────────────────── Recommendations ───────────────────────────

    def _refactor_priorities(
        self, file_risks: list[FileRisk], anti_patterns: list[AntiPattern]
    ) -> list[str]:
        priorities: list[str] = []

        high_risk = [r for r in file_risks if r.risk_score > 0.6]
        if high_risk:
            priorities.append(f"Reduce coupling in {high_risk[0].path} ({high_risk[0].reasons[0]})")

        for ap in anti_patterns:
            if ap.severity == "high":
                priorities.append(ap.recommendation)

        if self.cycle_count > 0:
            priorities.append(
                f"Break {self.cycle_count} circular dependency(ies) to improve testability"
            )

        return priorities[:5]

    def _quick_wins(
        self, anti_patterns: list[AntiPattern], metrics: list[ScoredMetric]
    ) -> list[str]:
        wins: list[str] = []
        for ap in anti_patterns:
            if ap.severity == "medium":
                wins.append(ap.recommendation)
        for m in metrics:
            if m.score <= 4.0 and m.name == "Test Presence":
                wins.append("Add test files for critical modules to improve confidence")
        return wins[:3]

    # ─────────────────────────── Helpers ───────────────────────────

    def _compute_fans(self) -> tuple[dict[str, int], dict[str, int]]:
        fan_in: dict[str, int] = {}
        fan_out: dict[str, int] = {}
        for edge in self.edges:
            src = edge.get("source_path", "")
            tgt = edge.get("target_path", "")
            if src:
                fan_out[src] = fan_out.get(src, 0) + 1
            if tgt:
                fan_in[tgt] = fan_in.get(tgt, 0) + 1
        return fan_in, fan_out

    @staticmethod
    def _score_label(score: float) -> str:
        if score >= 8.0:
            return "excellent"
        elif score >= 6.0:
            return "good"
        elif score >= 4.0:
            return "fair"
        else:
            return "poor"

    @staticmethod
    def _risk_label(score: float) -> str:
        if score >= 0.7:
            return "critical"
        elif score >= 0.5:
            return "high"
        elif score >= 0.3:
            return "moderate"
        else:
            return "low"
