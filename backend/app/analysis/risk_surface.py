"""Operational Risk Surface.

Powers the Risk Areas page. Answers: "Across this repository, where are the
concrete operational risks, and which ones should a lead actually worry about?"

Distinct from:
  - Impact  — per-file blast radius for a specific change.
  - Insights — engineering signals & health trends.
  - Intelligence — strategic audit narrative.

Each RiskItem describes a concrete surface with:
  - risk category (what *kind* of risk)
  - why it is risky in plain language
  - what could go wrong
  - affected files
  - the type of review that is actually useful
  - evidence and confidence

Pure Python / plain dicts (Celery-safe).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@dataclass
class RiskItem:
    id: str
    category: str  # coupling | blast_radius | reviewability | fragility | runtime | boundary
    severity: str  # critical | high | medium | low
    title: str
    summary: str  # one-sentence plain-language description
    what_could_go_wrong: list[str] = field(default_factory=list)
    affected_files: list[str] = field(default_factory=list)
    affected_modules: list[str] = field(default_factory=list)
    review_type: str = ""
    evidence: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    confidence: str = "strong"  # deterministic | strong | moderate | weak

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "summary": self.summary,
            "what_could_go_wrong": self.what_could_go_wrong,
            "affected_files": self.affected_files[:10],
            "affected_modules": self.affected_modules[:6],
            "review_type": self.review_type,
            "evidence": self.evidence,
            "metrics": self.metrics,
            "confidence": self.confidence,
        }


@dataclass
class RiskSurfaceReport:
    items: list[RiskItem] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    checked: list[str] = field(default_factory=list)
    healthy_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "items": [i.to_dict() for i in self.items],
            "checked": self.checked,
            "healthy_notes": self.healthy_notes,
        }


class RiskSurfaceEngine:
    """Computes the operational risk surface of the repository."""

    # Thresholds — calibrated to fire only when there's real evidence.
    HUB_IN = 8
    CRITICAL_HUB_IN = 15
    HIGH_FAN_OUT = 12
    CRITICAL_FAN_OUT = 22
    OVERSIZED = 400
    VERY_OVERSIZED = 800
    GOD_SYMBOLS = 30
    BRIDGE_IN = 5
    BRIDGE_OUT = 8

    def __init__(
        self,
        edges: list[dict],
        file_infos: list[dict],
        symbols_per_file: dict[str, int] | None = None,
        cycles: list[list[str]] | None = None,
    ):
        self.files = {f["path"]: f for f in file_infos}
        self.symbols = symbols_per_file or {}
        self.cycles = cycles or []

        self.in_edges: dict[str, set[str]] = defaultdict(set)
        self.out_edges: dict[str, set[str]] = defaultdict(set)
        for e in edges:
            src, tgt = e.get("source_path"), e.get("target_path")
            if src and tgt and src != tgt:
                self.out_edges[src].add(tgt)
                self.in_edges[tgt].add(src)

    # ────── Public entry ──────

    def analyze(self) -> RiskSurfaceReport:
        items: list[RiskItem] = []

        items += self._blast_radius_risks()
        items += self._coupling_risks()
        items += self._reviewability_risks()
        items += self._fragility_risks()
        items += self._runtime_risks()
        items += self._boundary_risks()
        items += self._cycle_risks()

        items.sort(key=lambda i: (SEVERITY_ORDER.get(i.severity, 4), -len(i.affected_files)))

        summary = {
            "total": len(items),
            "critical": sum(1 for i in items if i.severity == "critical"),
            "high": sum(1 for i in items if i.severity == "high"),
            "medium": sum(1 for i in items if i.severity == "medium"),
            "low": sum(1 for i in items if i.severity == "low"),
        }

        checked = [
            "Blast radius (fan-in hubs)",
            "Coupling (fan-out)",
            "Reviewability (file size, symbol density)",
            "Fragility (bridge files, critical paths)",
            "Runtime criticality (entry-point proximity)",
            "Boundary weakness (UI/data mixing, low cohesion)",
            "Circular dependencies",
        ]

        healthy_notes = self._healthy_observations(items)

        return RiskSurfaceReport(
            items=items,
            summary=summary,
            checked=checked,
            healthy_notes=healthy_notes,
        )

    # ────── Categories ──────

    def _blast_radius_risks(self) -> list[RiskItem]:
        hubs = [
            (p, len(self.in_edges.get(p, ())))
            for p in self.files
            if len(self.in_edges.get(p, ())) >= self.HUB_IN
        ]
        if not hubs:
            return []
        hubs.sort(key=lambda x: -x[1])
        top = hubs[0]
        severity = "critical" if top[1] >= self.CRITICAL_HUB_IN else "high"
        return [
            RiskItem(
                id="blast_radius_hubs",
                category="blast_radius",
                severity=severity,
                title=f"{len(hubs)} file(s) sit on large dependency fan-in",
                summary=(
                    f"{top[0]} alone is imported by {top[1]} files. A regression here "
                    "propagates through most of the codebase."
                ),
                what_could_go_wrong=[
                    "Silent behaviour change ripples to many consumers.",
                    "A single typo / signature change breaks unrelated features.",
                    "Reverts become expensive once downstream code adapted.",
                ],
                affected_files=[p for p, _ in hubs[:10]],
                review_type="Contract review — treat each hub as a stable API. Require explicit sign-off.",
                evidence=[f"{p} imported by {n} file(s)" for p, n in hubs[:5]],
                metrics={"count": len(hubs), "max_fan_in": top[1]},
                confidence="deterministic",
            )
        ]

    def _coupling_risks(self) -> list[RiskItem]:
        coupled = [
            (p, len(self.out_edges.get(p, ())))
            for p in self.files
            if len(self.out_edges.get(p, ())) >= self.HIGH_FAN_OUT
        ]
        if not coupled:
            return []
        coupled.sort(key=lambda x: -x[1])
        top = coupled[0]
        severity = "high" if top[1] >= self.CRITICAL_FAN_OUT else "medium"
        return [
            RiskItem(
                id="coupling_high_fan_out",
                category="coupling",
                severity=severity,
                title=f"{len(coupled)} file(s) pull from many dependencies",
                summary=(
                    f"{top[0]} imports {top[1]} files. High fan-out makes behaviour brittle — "
                    "many unrelated pieces must stay compatible for it to work."
                ),
                what_could_go_wrong=[
                    "Upstream change in any of N dependencies can break it.",
                    "Unit testing is expensive — many collaborators need mocks.",
                    "Refactors tend to cascade.",
                ],
                affected_files=[p for p, _ in coupled[:10]],
                review_type="Coupling review — verify whether the dependencies are really all needed, or whether a facade would help.",
                evidence=[f"{p} imports {n} file(s)" for p, n in coupled[:5]],
                metrics={"count": len(coupled), "max_fan_out": top[1]},
                confidence="deterministic",
            )
        ]

    def _reviewability_risks(self) -> list[RiskItem]:
        huge = [
            (p, int(fi.get("line_count") or 0))
            for p, fi in self.files.items()
            if (fi.get("line_count") or 0) >= self.VERY_OVERSIZED
        ]
        god = [(p, n) for p, n in self.symbols.items() if n >= self.GOD_SYMBOLS]
        if not huge and not god:
            return []
        severity = (
            "high"
            if (huge and huge[0][1] >= 1500) or (god and any(n >= 60 for _, n in god))
            else "medium"
        )
        affected = sorted({p for p, _ in (huge + god)})
        ev = []
        if huge:
            huge.sort(key=lambda x: -x[1])
            ev += [f"{p} — {loc} lines" for p, loc in huge[:4]]
        if god:
            god.sort(key=lambda x: -x[1])
            ev += [f"{p} — {n} symbols" for p, n in god[:4]]
        return [
            RiskItem(
                id="reviewability_oversized",
                category="reviewability",
                severity=severity,
                title="Files that are hard to review safely",
                summary="Oversized and symbol-heavy files resist meaningful review. Diffs become unreadable; reviewers lose context.",
                what_could_go_wrong=[
                    "Subtle bugs slip past review because attention budget runs out.",
                    "Merge conflicts multiply; team velocity drops on these files.",
                    "New engineers avoid touching them, which compounds the problem.",
                ],
                affected_files=affected[:10],
                review_type="Split-first review — require a refactor proposal before any non-trivial change to these files.",
                evidence=ev,
                metrics={"oversized": len(huge), "god_files": len(god)},
                confidence="deterministic",
            )
        ]

    def _fragility_risks(self) -> list[RiskItem]:
        bridges = [
            (p, len(self.in_edges.get(p, ())), len(self.out_edges.get(p, ())))
            for p in self.files
            if len(self.in_edges.get(p, ())) >= self.BRIDGE_IN
            and len(self.out_edges.get(p, ())) >= self.BRIDGE_OUT
        ]
        if not bridges:
            return []
        bridges.sort(key=lambda x: -(x[1] + x[2]))
        severity = "high" if bridges[0][1] + bridges[0][2] >= 25 else "medium"
        return [
            RiskItem(
                id="fragility_bridges",
                category="fragility",
                severity=severity,
                title=f"{len(bridges)} bridge file(s) concentrate architectural risk",
                summary=(
                    "Bridge files both import heavily and are heavily imported. A defect here "
                    "propagates in two directions at once."
                ),
                what_could_go_wrong=[
                    "A single edit cascades upward and downward.",
                    "These files usually hide leaky abstractions.",
                    "Refactors here are rare because they feel too scary.",
                ],
                affected_files=[p for p, _i, _o in bridges[:8]],
                review_type="Interface review — narrow the bridge's API. Require an architectural note before landing changes.",
                evidence=[f"{p}: in={i}, out={o}" for p, i, o in bridges[:5]],
                metrics={"count": len(bridges)},
                confidence="strong",
            )
        ]

    def _runtime_risks(self) -> list[RiskItem]:
        entry_files = [p for p, fi in self.files.items() if fi.get("is_entry_point")]
        if not entry_files:
            return []
        # One-hop neighbours of entry points = runtime-critical layer.
        neighbours: set[str] = set()
        for e in entry_files:
            neighbours.update(self.out_edges.get(e, ()))
        neighbours -= set(entry_files)
        if not neighbours:
            return []
        severity = "medium" if len(neighbours) < 15 else "high"
        return [
            RiskItem(
                id="runtime_entry_neighbourhood",
                category="runtime",
                severity=severity,
                title=f"{len(entry_files)} entry point(s) with {len(neighbours)} direct runtime dependencies",
                summary=(
                    "Files imported directly by entry points run on every startup or request. "
                    "Breakage here is rarely graceful."
                ),
                what_could_go_wrong=[
                    "A bad import crashes the whole app at boot.",
                    "Silent misconfiguration propagates into every request path.",
                    "Rollbacks are needed quickly — there is no 'skip this feature'.",
                ],
                affected_files=sorted(neighbours)[:10],
                review_type="Runtime-safety review — check error handling, startup behaviour, and fallback paths.",
                evidence=[f"entry points: {', '.join(entry_files[:3])}"],
                metrics={"entry_points": len(entry_files), "neighbour_files": len(neighbours)},
                confidence="deterministic",
            )
        ]

    def _boundary_risks(self) -> list[RiskItem]:
        # UI files reaching into data/backend.
        bad_mix: list[tuple[str, list[str]]] = []
        for path, deps in self.out_edges.items():
            if not self._is_ui_file(path):
                continue
            rough = [d for d in deps if self._is_data_path(d)]
            if len(rough) >= 2:
                bad_mix.append((path, rough))
        if not bad_mix:
            return []
        bad_mix.sort(key=lambda x: -len(x[1]))
        severity = "medium"
        return [
            RiskItem(
                id="boundary_ui_data",
                category="boundary",
                severity=severity,
                title=f"UI layer reaches into data / backend in {len(bad_mix)} file(s)",
                summary=(
                    "Presentation code is calling directly into persistence or backend modules. "
                    "The architectural seam between UI and data has eroded."
                ),
                what_could_go_wrong=[
                    "Changing the persistence layer forces touching UI code.",
                    "Business logic drifts into components; testing gets harder.",
                    "New teams can't own 'UI' vs 'backend' cleanly.",
                ],
                affected_files=[p for p, _ in bad_mix[:8]],
                review_type="Boundary review — extract a thin application-service layer; UI talks to it, not to DB/backend.",
                evidence=[
                    f"{p} → {', '.join(d.split('/')[-1] for d in bd[:3])}" for p, bd in bad_mix[:5]
                ],
                metrics={"count": len(bad_mix)},
                confidence="moderate",
            )
        ]

    def _cycle_risks(self) -> list[RiskItem]:
        if not self.cycles:
            return []
        count = len(self.cycles)
        if count == 0:
            return []
        severity = "high" if count >= 5 else "medium"
        sample = self.cycles[:3]
        return [
            RiskItem(
                id="circular_dependencies",
                category="fragility",
                severity=severity,
                title=f"{count} circular dependency cluster(s)",
                summary=(
                    "Files that depend on each other in a loop cannot be reasoned about in isolation. "
                    "Initialisation order becomes accidental."
                ),
                what_could_go_wrong=[
                    "Import-time errors in some environments.",
                    "Refactoring one side without the other leaves broken state.",
                    "Tests may pass individually but fail when all loaded.",
                ],
                affected_files=sorted({f for cyc in sample for f in cyc})[:10],
                review_type="Dependency review — break the cycle via an intermediate module or interface.",
                evidence=[" → ".join(cyc[:4]) + (" → …" if len(cyc) > 4 else "") for cyc in sample],
                metrics={"cycle_count": count},
                confidence="deterministic",
            )
        ]

    # ────── Healthy-notes zero-state support ──────

    def _healthy_observations(self, items: list[RiskItem]) -> list[str]:
        """Things that look *good* — used when there are few/no high-severity items."""
        notes: list[str] = []
        in_max = max((len(s) for s in self.in_edges.values()), default=0)
        out_max = max((len(s) for s in self.out_edges.values()), default=0)
        if in_max and in_max < self.HUB_IN:
            notes.append(
                f"No file has dependency fan-in above {self.HUB_IN} — blast radius stays local."
            )
        if out_max and out_max < self.HIGH_FAN_OUT:
            notes.append(
                f"No file imports more than {self.HIGH_FAN_OUT} others — coupling is contained."
            )
        if not any(i.id == "circular_dependencies" for i in items):
            notes.append("No circular dependencies detected.")
        if not any(i.id == "reviewability_oversized" for i in items):
            notes.append("No oversized or symbol-heavy files — review cost stays bounded.")
        if not any(i.id == "boundary_ui_data" for i in items):
            notes.append("UI does not reach directly into data/backend — presentation seam holds.")
        return notes

    # ────── Helpers ──────

    @staticmethod
    def _is_ui_file(path: str) -> bool:
        p = path.lower()
        if p.endswith((".tsx", ".jsx", ".vue", ".svelte")):
            return True
        return any(seg in p for seg in ("/components/", "/pages/", "/views/", "/screens/", "/ui/"))

    @staticmethod
    def _is_data_path(path: str) -> bool:
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
                "/dao/",
                "/orm/",
                "/prisma/",
                "/drizzle/",
                "/backend/",
            )
        )
