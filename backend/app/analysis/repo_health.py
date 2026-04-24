"""Repository Health & Engineering Signals Engine.

Produces the data that powers the Insights page. This is the *diagnostics* layer
of the product — distinct from the Intelligence Report, which is the strategic
audit layer.

Insights answers:
  "What structural mistakes is this repo making? What patterns are reducing
   long-term maintainability? What should be reviewed first? What will hurt
   later if ignored?"

Every finding is evidence-backed with traceable support. The engine never
produces narrative — it produces structured signals that the UI renders.

Pure Python / plain dicts only (Celery-safe).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import PurePosixPath

# ─────────────────────────── Data classes ───────────────────────────


@dataclass
class HealthDimension:
    key: str  # architecture | maintainability | change_safety | ...
    label: str
    score: float  # 0–100, higher is better
    grade: str  # poor | fair | good | strong
    measures: list[str] = field(default_factory=list)  # what this measures
    contributing: list[str] = field(default_factory=list)  # signals that moved the score
    blind_spots: list[str] = field(default_factory=list)  # what this does NOT cover
    confidence: str = "moderate"  # deterministic | strong | moderate | weak

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "score": round(self.score, 1),
            "grade": self.grade,
            "measures": self.measures,
            "contributing": self.contributing,
            "blind_spots": self.blind_spots,
            "confidence": self.confidence,
        }


@dataclass
class Signal:
    """A single pattern / mistake detected in the repository."""

    id: str
    category: str  # structure | cohesion | complexity | boundary | coupling | ...
    kind: str  # oversized_file | god_file | weak_module | ...
    severity: str  # critical | high | medium | low
    title: str
    why_it_matters: str
    affected_files: list[str] = field(default_factory=list)
    affected_modules: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)  # explanatory lines
    metrics: dict = field(default_factory=dict)  # raw numbers
    suggested_action: str = ""
    confidence: str = "strong"  # deterministic | strong | moderate | weak
    source: str = "graph+files"  # which heuristics produced this

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "kind": self.kind,
            "severity": self.severity,
            "title": self.title,
            "why_it_matters": self.why_it_matters,
            "affected_files": self.affected_files[:12],
            "affected_modules": self.affected_modules[:8],
            "evidence": self.evidence,
            "metrics": self.metrics,
            "suggested_action": self.suggested_action,
            "confidence": self.confidence,
            "source": self.source,
        }


@dataclass
class LongevityConcern:
    title: str
    detail: str
    pressure: str  # low | moderate | high
    grounded_on: list[str] = field(default_factory=list)  # signal ids

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "detail": self.detail,
            "pressure": self.pressure,
            "grounded_on": self.grounded_on,
        }


@dataclass
class PriorityFix:
    rank: int
    title: str
    severity: str
    why_first: str
    affected_files: list[str] = field(default_factory=list)
    first_action: str = ""
    signal_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "rank": self.rank,
            "title": self.title,
            "severity": self.severity,
            "why_first": self.why_first,
            "affected_files": self.affected_files[:8],
            "first_action": self.first_action,
            "signal_ids": self.signal_ids,
        }


@dataclass
class RepoHealthReport:
    dimensions: list[HealthDimension] = field(default_factory=list)
    signals: list[Signal] = field(default_factory=list)
    longevity: list[LongevityConcern] = field(default_factory=list)
    priorities: list[PriorityFix] = field(default_factory=list)
    review_guidance: list[dict] = field(default_factory=list)  # [{step, title, detail}]
    summary: dict = field(default_factory=dict)
    coverage: dict = field(default_factory=dict)  # what was and wasn't checked

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "dimensions": [d.to_dict() for d in self.dimensions],
            "signals": [s.to_dict() for s in self.signals],
            "longevity": [c.to_dict() for c in self.longevity],
            "priorities": [p.to_dict() for p in self.priorities],
            "review_guidance": self.review_guidance,
            "coverage": self.coverage,
        }


# ─────────────────────────── Engine ───────────────────────────


SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


class RepoHealthEngine:
    """Detects repo-wide engineering signals from graph + file metadata."""

    # Thresholds — conservative so signals only fire when there's real evidence.
    OVERSIZED_LOC = 400
    VERY_OVERSIZED_LOC = 800
    GOD_FILE_SYMBOLS = 30
    HUB_FAN_IN = 8
    VERY_HIGH_HUB_FAN_IN = 15
    HIGH_FAN_OUT = 12
    VERY_HIGH_FAN_OUT = 20
    LOW_COHESION = 0.45  # module cohesion ratio threshold
    MIN_MODULE_FILES = 3  # ignore tiny modules for cohesion signals

    def __init__(
        self,
        edges: list[dict],  # [{source_path, target_path}, ...]
        file_infos: list[dict],  # [{path, line_count, is_entry_point, ...}, ...]
        symbols_per_file: dict[str, int] | None = None,
    ):
        self.files = {f["path"]: f for f in file_infos}
        self.symbols = symbols_per_file or {}

        # Build adjacency structures.
        self.out_edges: dict[str, set[str]] = defaultdict(set)
        self.in_edges: dict[str, set[str]] = defaultdict(set)
        for e in edges:
            src, tgt = e.get("source_path"), e.get("target_path")
            if src and tgt and src != tgt:
                self.out_edges[src].add(tgt)
                self.in_edges[tgt].add(src)

        self.total_files = len(self.files)
        self.total_edges = sum(len(s) for s in self.out_edges.values())

    # ────── Public entry point ──────

    def analyze(self) -> RepoHealthReport:
        signals: list[Signal] = []

        signals += self._detect_oversized_files()
        signals += self._detect_god_files()
        signals += self._detect_hubs()
        signals += self._detect_coupling_heavy()
        signals += self._detect_weak_modules()
        signals += self._detect_orphans()
        signals += self._detect_config_sprawl()
        signals += self._detect_utility_dumps()
        signals += self._detect_bridge_fragility()
        signals += self._detect_ui_business_mixing()

        # Sort by severity then by count of affected files.
        signals.sort(key=lambda s: (SEVERITY_ORDER.get(s.severity, 4), -len(s.affected_files)))

        dimensions = self._compute_dimensions(signals)
        longevity = self._infer_longevity(signals, dimensions)
        priorities = self._rank_priorities(signals)
        review_guidance = self._build_review_guidance(signals, dimensions)

        summary = {
            "total_files": self.total_files,
            "total_edges": self.total_edges,
            "signal_count": len(signals),
            "critical_count": sum(1 for s in signals if s.severity == "critical"),
            "high_count": sum(1 for s in signals if s.severity == "high"),
            "overall_grade": self._overall_grade(dimensions),
        }

        coverage = {
            "checked": [
                "oversized files",
                "symbol-heavy god files",
                "dependency hubs",
                "high-coupling files",
                "module cohesion",
                "orphan / isolated files",
                "config sprawl",
                "utility dumping grounds",
                "bridge / articulation points",
                "UI / business-logic mixing",
            ],
            "not_yet_checked": [
                "test coverage ratio (no coverage data)",
                "git history / churn (no VCS signal yet)",
                "runtime error trends (no telemetry)",
            ],
        }

        return RepoHealthReport(
            dimensions=dimensions,
            signals=signals,
            longevity=longevity,
            priorities=priorities,
            review_guidance=review_guidance,
            summary=summary,
            coverage=coverage,
        )

    # ────── Detectors ──────

    def _detect_oversized_files(self) -> list[Signal]:
        big: list[tuple[str, int]] = []
        huge: list[tuple[str, int]] = []
        for path, fi in self.files.items():
            loc = int(fi.get("line_count") or 0)
            if loc >= self.VERY_OVERSIZED_LOC:
                huge.append((path, loc))
            elif loc >= self.OVERSIZED_LOC:
                big.append((path, loc))
        out: list[Signal] = []
        if huge:
            huge.sort(key=lambda x: -x[1])
            out.append(
                Signal(
                    id="oversized_files_critical",
                    category="complexity",
                    kind="oversized_file",
                    severity="high",
                    title=f"{len(huge)} file(s) exceed {self.VERY_OVERSIZED_LOC} lines",
                    why_it_matters=(
                        "Very large files are expensive to review, hard to test in isolation, and tend "
                        "to accumulate unrelated responsibilities over time."
                    ),
                    affected_files=[p for p, _ in huge[:12]],
                    evidence=[f"{p} has {loc} lines" for p, loc in huge[:6]],
                    metrics={"count": len(huge), "threshold": self.VERY_OVERSIZED_LOC},
                    suggested_action="Split by responsibility — extract the two or three most distinct concerns into sibling modules.",
                    confidence="deterministic",
                )
            )
        if big:
            big.sort(key=lambda x: -x[1])
            out.append(
                Signal(
                    id="oversized_files_warning",
                    category="complexity",
                    kind="oversized_file",
                    severity="medium",
                    title=f"{len(big)} file(s) over {self.OVERSIZED_LOC} lines",
                    why_it_matters="Above this size reviewability drops sharply and file-level cohesion usually weakens.",
                    affected_files=[p for p, _ in big[:12]],
                    evidence=[f"{p} has {loc} lines" for p, loc in big[:6]],
                    metrics={"count": len(big), "threshold": self.OVERSIZED_LOC},
                    suggested_action="Review each and decide whether it is really one concern or several.",
                    confidence="strong",
                )
            )
        return out

    def _detect_god_files(self) -> list[Signal]:
        heavy = [(p, n) for p, n in self.symbols.items() if n >= self.GOD_FILE_SYMBOLS]
        if not heavy:
            return []
        heavy.sort(key=lambda x: -x[1])
        return [
            Signal(
                id="god_files",
                category="complexity",
                kind="god_file",
                severity="high" if any(n >= 60 for _, n in heavy) else "medium",
                title=f"{len(heavy)} symbol-heavy 'god file(s)' detected",
                why_it_matters=(
                    "Files declaring dozens of functions/classes usually mix concerns. They become "
                    "coupling magnets and are hard to refactor safely."
                ),
                affected_files=[p for p, _ in heavy[:12]],
                evidence=[f"{p} defines {n} symbols" for p, n in heavy[:6]],
                metrics={"count": len(heavy), "threshold": self.GOD_FILE_SYMBOLS},
                suggested_action="Group symbols by theme and extract cohesive sibling modules.",
                confidence="deterministic",
            )
        ]

    def _detect_hubs(self) -> list[Signal]:
        hubs = [
            (p, len(importers))
            for p, importers in self.in_edges.items()
            if len(importers) >= self.HUB_FAN_IN
        ]
        if not hubs:
            return []
        hubs.sort(key=lambda x: -x[1])
        very_high = [h for h in hubs if h[1] >= self.VERY_HIGH_HUB_FAN_IN]
        severity = "high" if very_high else "medium"
        return [
            Signal(
                id="dependency_hubs",
                category="coupling",
                kind="dependency_hub",
                severity=severity,
                title=f"{len(hubs)} central file(s) have large fan-in",
                why_it_matters=(
                    "Hubs amplify the blast radius of every change landing on them. "
                    "Regressions here ripple through most of the codebase."
                ),
                affected_files=[p for p, _ in hubs[:10]],
                evidence=[f"{p} is imported by {n} file(s)" for p, n in hubs[:6]],
                metrics={"count": len(hubs), "threshold": self.HUB_FAN_IN, "max": hubs[0][1]},
                suggested_action="Treat these as contracts. Keep their APIs narrow; avoid adding unrelated helpers.",
                confidence="deterministic",
            )
        ]

    def _detect_coupling_heavy(self) -> list[Signal]:
        coupled = [
            (p, len(deps)) for p, deps in self.out_edges.items() if len(deps) >= self.HIGH_FAN_OUT
        ]
        if not coupled:
            return []
        coupled.sort(key=lambda x: -x[1])
        extreme = [c for c in coupled if c[1] >= self.VERY_HIGH_FAN_OUT]
        return [
            Signal(
                id="high_fan_out",
                category="coupling",
                kind="high_fan_out",
                severity="high" if extreme else "medium",
                title=f"{len(coupled)} file(s) import from {self.HIGH_FAN_OUT}+ other files",
                why_it_matters=(
                    "High fan-out means the file's behaviour depends on many moving parts. "
                    "It is fragile under refactors and expensive to test."
                ),
                affected_files=[p for p, _ in coupled[:10]],
                evidence=[f"{p} imports {n} file(s)" for p, n in coupled[:6]],
                metrics={"count": len(coupled), "threshold": self.HIGH_FAN_OUT},
                suggested_action="Introduce a narrower facade; hide the supporting imports behind a cohesive interface.",
                confidence="deterministic",
            )
        ]

    def _detect_weak_modules(self) -> list[Signal]:
        """Modules whose files depend more on outside modules than on peers."""
        # Group files by top-level directory.
        groups: dict[str, list[str]] = defaultdict(list)
        for path in self.files:
            parts = path.split("/")
            groups[parts[0] if len(parts) > 1 else "root"].append(path)

        weak: list[tuple[str, float, int, int]] = []
        for mod, members in groups.items():
            if len(members) < self.MIN_MODULE_FILES:
                continue
            inside = outside = 0
            member_set = set(members)
            for m in members:
                for dep in self.out_edges.get(m, ()):
                    if dep in member_set:
                        inside += 1
                    elif dep in self.files:  # only count resolved edges
                        outside += 1
            total = inside + outside
            if total < 3:
                continue
            cohesion = inside / total
            if cohesion < self.LOW_COHESION:
                weak.append((mod, cohesion, inside, outside))

        if not weak:
            return []
        weak.sort(key=lambda x: x[1])
        return [
            Signal(
                id="weak_modules",
                category="boundary",
                kind="weak_module_cohesion",
                severity="high" if weak[0][1] < 0.25 else "medium",
                title=f"{len(weak)} module(s) have weak internal cohesion",
                why_it_matters=(
                    "When a module depends more on outside code than on its own peers, the folder boundary "
                    "is a naming convention, not a real architectural seam."
                ),
                affected_modules=[m for m, *_ in weak[:8]],
                evidence=[
                    f"{m}: cohesion {c:.0%} (internal={i}, external={o})" for m, c, i, o in weak[:6]
                ],
                metrics={"count": len(weak), "threshold": self.LOW_COHESION},
                suggested_action="Either promote the external collaborators into this module, or re-home files that don't really belong here.",
                confidence="strong",
            )
        ]

    def _detect_orphans(self) -> list[Signal]:
        isolated = [
            p
            for p in self.files
            if not self.in_edges.get(p)
            and not self.out_edges.get(p)
            and not self._is_docs_or_config(p)
            and not self._is_test(p)
        ]
        if not isolated or len(isolated) < 3:
            return []
        # Only surface if a meaningful fraction of the repo is isolated.
        frac = len(isolated) / max(self.total_files, 1)
        if frac < 0.05 and len(isolated) < 10:
            return []
        severity = "medium" if frac > 0.15 else "low"
        return [
            Signal(
                id="orphan_files",
                category="structure",
                kind="orphan_file",
                severity=severity,
                title=f"{len(isolated)} source file(s) appear isolated in the import graph",
                why_it_matters=(
                    "Files the graph cannot reach are either dead code, loaded dynamically, "
                    "or miswired. In any case they're invisible to normal reasoning."
                ),
                affected_files=isolated[:12],
                metrics={"count": len(isolated), "fraction": round(frac, 3)},
                suggested_action="Audit each. If dead — delete. If dynamic — document how it's loaded.",
                confidence="moderate",
            )
        ]

    def _detect_config_sprawl(self) -> list[Signal]:
        configs = [p for p in self.files if self._is_config_like(p)]
        if len(configs) < 6:
            return []
        # Check how scattered they are across modules.
        modules_with_config = {p.split("/")[0] if "/" in p else "root" for p in configs}
        if len(modules_with_config) < 3:
            return []
        return [
            Signal(
                id="config_sprawl",
                category="structure",
                kind="config_sprawl",
                severity="medium" if len(modules_with_config) >= 5 else "low",
                title=f"{len(configs)} config-like files spread across {len(modules_with_config)} modules",
                why_it_matters=(
                    "Scattered configuration is a common source of drift — deployments silently disagree "
                    "with code because no one owns the full picture."
                ),
                affected_files=configs[:12],
                metrics={"count": len(configs), "modules": len(modules_with_config)},
                suggested_action="Centralise where possible; otherwise document who owns which config and which env consumes it.",
                confidence="moderate",
            )
        ]

    def _detect_utility_dumps(self) -> list[Signal]:
        """Files named `utils*` / `helpers*` / `common*` that declare many unrelated symbols."""
        dumps: list[tuple[str, int]] = []
        for path in self.files:
            name = PurePosixPath(path).stem.lower()
            if not any(
                name == k
                or name.startswith(k + ".")
                or name.startswith(k + "_")
                or name.endswith("_" + k)
                for k in ("utils", "util", "helpers", "helper", "common", "misc")
            ):
                continue
            n = self.symbols.get(path, 0)
            if n >= 10:
                dumps.append((path, n))
        if not dumps:
            return []
        dumps.sort(key=lambda x: -x[1])
        return [
            Signal(
                id="utility_dumps",
                category="structure",
                kind="utility_dump",
                severity="medium",
                title=f"{len(dumps)} generically-named utility file(s) with many symbols",
                why_it_matters=(
                    "`utils`/`helpers` files without a clear theme attract unrelated code. "
                    "They become cross-module back-doors that defeat your module boundaries."
                ),
                affected_files=[p for p, _ in dumps[:8]],
                evidence=[f"{p} declares {n} symbols" for p, n in dumps[:6]],
                suggested_action="Rename by theme or split by topic. A helper that ships with its consumer is cheaper than a giant shared dump.",
                confidence="strong",
            )
        ]

    def _detect_bridge_fragility(self) -> list[Signal]:
        """A bridge is a file that is *both* heavily imported and imports heavily itself."""
        bridges: list[tuple[str, int, int]] = []
        for path in self.files:
            in_c = len(self.in_edges.get(path, ()))
            out_c = len(self.out_edges.get(path, ()))
            if in_c >= 5 and out_c >= 8:
                bridges.append((path, in_c, out_c))
        if not bridges:
            return []
        bridges.sort(key=lambda x: -(x[1] + x[2]))
        return [
            Signal(
                id="fragile_bridges",
                category="coupling",
                kind="bridge_file",
                severity="high" if bridges[0][1] + bridges[0][2] >= 25 else "medium",
                title=f"{len(bridges)} bridge file(s) sit on critical dependency paths",
                why_it_matters=(
                    "Bridge files concentrate risk: a single edit travels in two directions — toward everyone "
                    "who imports them, and through everyone they import."
                ),
                affected_files=[p for p, _i, _o in bridges[:8]],
                evidence=[f"{p}: in={i}, out={o}" for p, i, o in bridges[:6]],
                suggested_action="Narrow the interface. Bridges should expose intentional, stable APIs — not leaky pass-throughs.",
                confidence="strong",
            )
        ]

    def _detect_ui_business_mixing(self) -> list[Signal]:
        """UI files that import from data/backend layers directly."""
        hits: list[tuple[str, list[str]]] = []
        for path, deps in self.out_edges.items():
            if not self._is_ui_file(path):
                continue
            bad_deps = [d for d in deps if self._is_data_or_backend_path(d)]
            if len(bad_deps) >= 2:
                hits.append((path, bad_deps))
        if len(hits) < 2:
            return []
        hits.sort(key=lambda x: -len(x[1]))
        return [
            Signal(
                id="ui_business_mixing",
                category="boundary",
                kind="ui_business_mixing",
                severity="medium",
                title=f"{len(hits)} UI file(s) reach directly into data/backend layers",
                why_it_matters=(
                    "UI files calling into DB, ORM, or backend modules couples presentation to storage. "
                    "It is the single most common cause of painful future migrations."
                ),
                affected_files=[p for p, _ in hits[:8]],
                evidence=[
                    f"{p} imports: {', '.join(d.split('/')[-1] for d in bd[:3])}"
                    for p, bd in hits[:5]
                ],
                suggested_action="Introduce a thin application-service layer. UI should talk to it, not to persistence primitives.",
                confidence="moderate",
            )
        ]

    # ────── Dimensions ──────

    def _compute_dimensions(self, signals: list[Signal]) -> list[HealthDimension]:
        """Score each health dimension 0–100 using the signals + raw metrics."""
        by_id = {s.id: s for s in signals}
        has = lambda sid: sid in by_id  # noqa: E731

        # Architecture: weak modules + bridges + cycles (cycles not passed here; covered by coupling).
        arch = 100.0
        if has("weak_modules"):
            arch -= 25 if by_id["weak_modules"].severity == "high" else 15
        if has("fragile_bridges"):
            arch -= 15
        if has("config_sprawl"):
            arch -= 8

        # Maintainability: file size + god files + utility dumps.
        maintain = 100.0
        if has("oversized_files_critical"):
            maintain -= 25
        if has("oversized_files_warning"):
            maintain -= 10
        if has("god_files"):
            maintain -= 20 if by_id["god_files"].severity == "high" else 12
        if has("utility_dumps"):
            maintain -= 10

        # Change safety: hubs, bridges, high fan-out.
        change_safety = 100.0
        if has("dependency_hubs"):
            change_safety -= 20 if by_id["dependency_hubs"].severity == "high" else 10
        if has("fragile_bridges"):
            change_safety -= 15
        if has("high_fan_out"):
            change_safety -= 10

        # Modularity: weak modules + UI/business mixing + utility dumps.
        modular = 100.0
        if has("weak_modules"):
            modular -= 30 if by_id["weak_modules"].severity == "high" else 18
        if has("ui_business_mixing"):
            modular -= 15
        if has("utility_dumps"):
            modular -= 10

        # Reviewability: oversized + god files + bridges + hubs.
        reviewability = 100.0
        if has("oversized_files_critical"):
            reviewability -= 25
        if has("oversized_files_warning"):
            reviewability -= 12
        if has("god_files"):
            reviewability -= 18
        if has("fragile_bridges"):
            reviewability -= 8

        # Onboarding: orphans + weak modules + utility dumps + god files.
        onboarding = 100.0
        if has("orphan_files"):
            onboarding -= 15
        if has("weak_modules"):
            onboarding -= 15
        if has("utility_dumps"):
            onboarding -= 10
        if has("god_files"):
            onboarding -= 10

        out = [
            HealthDimension(
                key="architecture",
                label="Architecture health",
                score=max(arch, 0),
                grade=self._grade(arch),
                measures=["module cohesion", "bridge concentration", "config sprawl"],
                contributing=self._contrib(
                    [
                        ("weak_modules", by_id.get("weak_modules")),
                        ("fragile_bridges", by_id.get("fragile_bridges")),
                        ("config_sprawl", by_id.get("config_sprawl")),
                    ]
                ),
                blind_spots=["runtime behaviour", "test architecture", "build topology"],
                confidence="strong",
            ),
            HealthDimension(
                key="maintainability",
                label="Maintainability",
                score=max(maintain, 0),
                grade=self._grade(maintain),
                measures=["file size distribution", "symbol density", "helper/utility sprawl"],
                contributing=self._contrib(
                    [
                        ("oversized_files_critical", by_id.get("oversized_files_critical")),
                        ("god_files", by_id.get("god_files")),
                        ("utility_dumps", by_id.get("utility_dumps")),
                    ]
                ),
                blind_spots=["cyclomatic complexity", "git churn"],
                confidence="strong",
            ),
            HealthDimension(
                key="change_safety",
                label="Change safety",
                score=max(change_safety, 0),
                grade=self._grade(change_safety),
                measures=["hub concentration", "bridge exposure", "fan-out distribution"],
                contributing=self._contrib(
                    [
                        ("dependency_hubs", by_id.get("dependency_hubs")),
                        ("fragile_bridges", by_id.get("fragile_bridges")),
                        ("high_fan_out", by_id.get("high_fan_out")),
                    ]
                ),
                blind_spots=["dynamic imports", "runtime DI"],
                confidence="strong",
            ),
            HealthDimension(
                key="modularity",
                label="Modularity",
                score=max(modular, 0),
                grade=self._grade(modular),
                measures=["internal vs external module edges", "UI / business separation"],
                contributing=self._contrib(
                    [
                        ("weak_modules", by_id.get("weak_modules")),
                        ("ui_business_mixing", by_id.get("ui_business_mixing")),
                    ]
                ),
                blind_spots=["runtime boundaries (DI, events)"],
                confidence="moderate",
            ),
            HealthDimension(
                key="reviewability",
                label="Reviewability",
                score=max(reviewability, 0),
                grade=self._grade(reviewability),
                measures=["file size", "symbol count", "bridge complexity"],
                contributing=self._contrib(
                    [
                        ("oversized_files_critical", by_id.get("oversized_files_critical")),
                        ("god_files", by_id.get("god_files")),
                        ("fragile_bridges", by_id.get("fragile_bridges")),
                    ]
                ),
                blind_spots=["documentation quality"],
                confidence="strong",
            ),
            HealthDimension(
                key="onboarding",
                label="Onboarding friction",
                score=max(onboarding, 0),
                grade=self._grade(onboarding),
                measures=["orphan files", "module clarity", "utility sprawl"],
                contributing=self._contrib(
                    [
                        ("orphan_files", by_id.get("orphan_files")),
                        ("weak_modules", by_id.get("weak_modules")),
                        ("utility_dumps", by_id.get("utility_dumps")),
                    ]
                ),
                blind_spots=["README / docs completeness (covered by Docs)"],
                confidence="moderate",
            ),
        ]
        return out

    @staticmethod
    def _contrib(items: list[tuple[str, Signal | None]]) -> list[str]:
        out = []
        for sid, sig in items:
            if sig:
                out.append(f"{sig.title}")
            else:
                out.append(f"no {sid.replace('_', ' ')} detected")
        return out

    @staticmethod
    def _grade(score: float) -> str:
        if score >= 85:
            return "strong"
        if score >= 70:
            return "good"
        if score >= 50:
            return "fair"
        return "poor"

    @staticmethod
    def _overall_grade(dims: list[HealthDimension]) -> str:
        if not dims:
            return "unknown"
        avg = sum(d.score for d in dims) / len(dims)
        if avg >= 85:
            return "strong"
        if avg >= 70:
            return "good"
        if avg >= 50:
            return "fair"
        return "poor"

    # ────── Longevity inference ──────

    def _infer_longevity(
        self,
        signals: list[Signal],
        dims: list[HealthDimension],
    ) -> list[LongevityConcern]:
        by_id = {s.id: s for s in signals}
        out: list[LongevityConcern] = []

        if "oversized_files_critical" in by_id or "god_files" in by_id:
            out.append(
                LongevityConcern(
                    title="Maintenance burden will compound",
                    detail=(
                        "Oversized and symbol-heavy files accumulate responsibilities faster than they shed them. "
                        "As the team grows, merge conflicts and reviewer fatigue on these files will rise."
                    ),
                    pressure="high",
                    grounded_on=[
                        sid for sid in ("oversized_files_critical", "god_files") if sid in by_id
                    ],
                )
            )
        if "dependency_hubs" in by_id:
            h = by_id["dependency_hubs"]
            out.append(
                LongevityConcern(
                    title="Change amplification risk will grow",
                    detail=(
                        f"Central hubs like {', '.join(h.affected_files[:2]) or '…'} already fan-in across the codebase. "
                        "Every new consumer added tomorrow multiplies the risk of changing them."
                    ),
                    pressure="high" if h.severity == "high" else "moderate",
                    grounded_on=["dependency_hubs"],
                )
            )
        if "weak_modules" in by_id:
            out.append(
                LongevityConcern(
                    title="Module boundaries will erode further",
                    detail=(
                        "Modules that already depend more on outside code than on their own peers tend to keep leaking. "
                        "Left alone, they become folders without architectural meaning."
                    ),
                    pressure="moderate",
                    grounded_on=["weak_modules"],
                )
            )
        if "ui_business_mixing" in by_id:
            out.append(
                LongevityConcern(
                    title="Future refactor cost is being banked",
                    detail=(
                        "UI files reaching into data layers couple presentation to storage. Every new screen "
                        "that follows this pattern makes a future migration (new DB, new backend) more expensive."
                    ),
                    pressure="moderate",
                    grounded_on=["ui_business_mixing"],
                )
            )
        if "orphan_files" in by_id:
            out.append(
                LongevityConcern(
                    title="Hidden surface area grows",
                    detail=(
                        "Files the graph cannot see are a liability — they may be dead, or they may be hot "
                        "code loaded dynamically. Either way, reasoning about the system becomes harder over time."
                    ),
                    pressure="moderate",
                    grounded_on=["orphan_files"],
                )
            )

        if not out:
            out.append(
                LongevityConcern(
                    title="No major long-term pressures detected",
                    detail=(
                        "Current structure does not show the classic degradation patterns. Keep an eye on file "
                        "size and module cohesion as the repo grows."
                    ),
                    pressure="low",
                )
            )
        return out

    # ────── Priority ranking ──────

    def _rank_priorities(self, signals: list[Signal]) -> list[PriorityFix]:
        # Score = severity weight + blast-radius-ish bonus for files with many dependents.
        sev_weight = {"critical": 100, "high": 70, "medium": 40, "low": 20}
        scored: list[tuple[int, Signal]] = []
        for s in signals:
            w = sev_weight.get(s.severity, 30)
            # Bonus if affected files are high-fan-in hubs (change amplifies).
            for f in s.affected_files[:5]:
                w += min(len(self.in_edges.get(f, ())), 10)
            scored.append((w, s))

        scored.sort(key=lambda x: -x[0])
        out: list[PriorityFix] = []
        for rank, (_w, s) in enumerate(scored[:5], 1):
            out.append(
                PriorityFix(
                    rank=rank,
                    title=s.title,
                    severity=s.severity,
                    why_first=s.why_it_matters,
                    affected_files=s.affected_files,
                    first_action=s.suggested_action,
                    signal_ids=[s.id],
                )
            )
        return out

    # ────── Review guidance ──────

    def _build_review_guidance(
        self,
        signals: list[Signal],
        dims: list[HealthDimension],
    ) -> list[dict]:
        by_id = {s.id: s for s in signals}
        steps: list[dict] = []
        order = 1

        if "weak_modules" in by_id:
            steps.append(
                {
                    "step": order,
                    "title": "Audit weak module boundaries first",
                    "detail": "Before fixing individual files, decide what each low-cohesion module is actually supposed to own.",
                }
            )
            order += 1
        if "oversized_files_critical" in by_id or "god_files" in by_id:
            steps.append(
                {
                    "step": order,
                    "title": "Split the largest / symbol-heaviest files",
                    "detail": "Target the top offenders — the rest of the cleanup is cheaper once these are broken up.",
                }
            )
            order += 1
        if "dependency_hubs" in by_id or "fragile_bridges" in by_id:
            steps.append(
                {
                    "step": order,
                    "title": "Narrow hub and bridge interfaces",
                    "detail": "Stabilise the most-depended-on files before touching anything they import.",
                }
            )
            order += 1
        if "ui_business_mixing" in by_id:
            steps.append(
                {
                    "step": order,
                    "title": "Isolate presentation from persistence",
                    "detail": "Introduce a thin application-service layer so UI stops calling DB/backend modules directly.",
                }
            )
            order += 1
        if "config_sprawl" in by_id:
            steps.append(
                {
                    "step": order,
                    "title": "Centralise configuration ownership",
                    "detail": "Pick one owner per config surface (build, runtime, env); document the consumers.",
                }
            )
            order += 1
        if not steps:
            steps.append(
                {
                    "step": 1,
                    "title": "Keep the current hygiene",
                    "detail": "No major structural actions needed. Re-run this page as the repo grows.",
                }
            )
        return steps

    # ────── Small helpers ──────

    @staticmethod
    def _is_test(path: str) -> bool:
        p = path.lower()
        return any(x in p for x in ("/tests/", "/test/", "/__tests__/", ".test.", ".spec."))

    @staticmethod
    def _is_docs_or_config(path: str) -> bool:
        name = PurePosixPath(path).name.lower()
        ext = PurePosixPath(name).suffix
        if ext in {
            ".md",
            ".mdx",
            ".rst",
            ".txt",
            ".json",
            ".yml",
            ".yaml",
            ".toml",
            ".ini",
            ".env",
            ".cfg",
        }:
            return True
        return name in {"dockerfile", "makefile"}

    @staticmethod
    def _is_config_like(path: str) -> bool:
        name = PurePosixPath(path).name.lower()
        ext = PurePosixPath(name).suffix
        if name in {
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
            "alembic.ini",
            "pytest.ini",
            "docker-compose.yml",
            "docker-compose.yaml",
            "dockerfile",
        }:
            return True
        return bool(ext in {".env"} or name.startswith(".env."))

    @staticmethod
    def _is_ui_file(path: str) -> bool:
        ext = PurePosixPath(path).suffix
        p = path.lower()
        if ext in {".tsx", ".jsx", ".vue", ".svelte"}:
            return True
        return any(seg in p for seg in ("/components/", "/ui/", "/views/", "/pages/", "/screens/"))

    @staticmethod
    def _is_data_or_backend_path(path: str) -> bool:
        p = "/" + path.lower().lstrip("/")
        return any(
            seg in p
            for seg in (
                "/models/",
                "/schema/",
                "/schemas/",
                "/db/",
                "/database/",
                "/migrations/",
                "/repositories/",
                "/repository/",
                "/dao/",
                "/orm/",
                "/prisma/",
                "/drizzle/",
            )
        )
