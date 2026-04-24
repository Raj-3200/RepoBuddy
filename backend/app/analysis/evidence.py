"""Core evidence and confidence data model.

Every major claim the system makes should be accompanied by an EvidenceBundle
that explains what data was used, how confident we are, and whether the finding
is deterministic or inferred.

Confidence Levels:
  HIGH    – Directly proven (config file, package.json dependency, explicit import)
  MEDIUM  – Supported by converging patterns but not explicit declaration
  LOW     – Plausible from one or two weak signals; label accordingly
  UNKNOWN – Insufficient data to make the claim
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

# ─────────────────────────── Enums ───────────────────────────


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class EvidenceType(str, Enum):
    FILE_EXISTS = "file_exists"  # A specific config / special file is present
    PACKAGE_DEPENDENCY = "package_dep"  # Listed in package.json / requirements.txt
    CONFIG_FILE = "config_file"  # Framework/tool config file found
    IMPORT_PATTERN = "import_pattern"  # Import statement detected in source code
    ROUTE_PATTERN = "route_pattern"  # Route/path definition detected
    FILE_PATTERN = "file_pattern"  # Naming/structural file pattern match
    SYMBOL_PATTERN = "symbol_pattern"  # Symbol names matching vocabulary
    CONTENT_MATCH = "content_match"  # Keyword / regex in file content
    DIRECTORY_STRUCTURE = "dir_structure"  # Folder organisation matches pattern
    GRAPH_RELATIONSHIP = "graph_rel"  # Derived from dependency-graph analysis
    README_MENTION = "readme_mention"  # Mentioned in README / docs


# ─────────────────────────── Data classes ───────────────────────────


@dataclass
class EvidenceItem:
    """A single piece of evidence supporting a claim."""

    evidence_type: EvidenceType
    description: str
    file_paths: list[str] = field(default_factory=list)
    line_ranges: list[tuple[int, int]] = field(default_factory=list)
    symbols: list[str] = field(default_factory=list)
    content_snippet: str | None = None
    weight: float = 1.0  # Contribution to overall confidence score

    def to_dict(self) -> dict:
        return {
            "type": self.evidence_type.value,
            "description": self.description,
            "file_paths": self.file_paths,
            "line_ranges": [list(r) for r in self.line_ranges],
            "symbols": self.symbols,
            "content_snippet": self.content_snippet,
            "weight": self.weight,
        }


@dataclass
class Claim:
    """A structured claim about the repository, with evidence and confidence."""

    claim: str
    claim_type: str  # e.g. "stack", "identity", "architecture", "quality"
    confidence_level: ConfidenceLevel
    confidence_score: float  # 0.0–1.0
    evidence_items: list[EvidenceItem] = field(default_factory=list)
    is_deterministic: bool = False  # True = computed directly, not inferred
    reasoning_summary: str = ""
    related_entities: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "claim": self.claim,
            "claim_type": self.claim_type,
            "confidence_level": self.confidence_level.value,
            "confidence_score": round(self.confidence_score, 3),
            "evidence_items": [e.to_dict() for e in self.evidence_items],
            "is_deterministic": self.is_deterministic,
            "reasoning_summary": self.reasoning_summary,
            "related_entities": self.related_entities,
            "caveats": self.caveats,
        }


@dataclass
class EvidenceBundle:
    """A collection of claims forming a complete report section."""

    section: str
    claims: list[Claim] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "section": self.section,
            "claims": [c.to_dict() for c in self.claims],
        }

    def highest_confidence(self) -> ConfidenceLevel:
        order = [
            ConfidenceLevel.HIGH,
            ConfidenceLevel.MEDIUM,
            ConfidenceLevel.LOW,
            ConfidenceLevel.UNKNOWN,
        ]
        for level in order:
            if any(c.confidence_level == level for c in self.claims):
                return level
        return ConfidenceLevel.UNKNOWN


# ─────────────────────────── Helpers ───────────────────────────


def compute_confidence(evidence_items: list[EvidenceItem]) -> tuple[ConfidenceLevel, float]:
    """Derive confidence level and score from a list of evidence items.

    Direct config/package evidence is strongest.
    Pattern/inferred evidence is weaker.
    Multiple converging signals increase confidence.
    """
    if not evidence_items:
        return ConfidenceLevel.UNKNOWN, 0.0

    total_weight = sum(e.weight for e in evidence_items)

    # Direct proof types add a bonus
    direct_weight = sum(
        e.weight
        for e in evidence_items
        if e.evidence_type
        in (
            EvidenceType.FILE_EXISTS,
            EvidenceType.PACKAGE_DEPENDENCY,
            EvidenceType.CONFIG_FILE,
        )
    )

    # Normalise score: 5 total weight = score 1.0
    score = min(total_weight / 5.0, 1.0)

    if direct_weight >= 2.0 or (total_weight >= 3.0 and direct_weight >= 1.0):
        return ConfidenceLevel.HIGH, max(score, 0.8)
    elif total_weight >= 2.0 or direct_weight >= 1.0:
        return ConfidenceLevel.MEDIUM, max(score, 0.5)
    elif total_weight >= 0.5:
        return ConfidenceLevel.LOW, max(score, 0.2)
    else:
        return ConfidenceLevel.UNKNOWN, score


def confidence_label(level: ConfidenceLevel) -> str:
    labels = {
        ConfidenceLevel.HIGH: "High confidence",
        ConfidenceLevel.MEDIUM: "Medium confidence",
        ConfidenceLevel.LOW: "Low confidence",
        ConfidenceLevel.UNKNOWN: "Unknown — insufficient evidence",
    }
    return labels.get(level, "Unknown")
