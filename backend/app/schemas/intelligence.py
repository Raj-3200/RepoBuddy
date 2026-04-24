"""Schemas for the Repository Intelligence Report feature."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# ─────────────────────────── Evidence / Confidence models ───────────────────────────


class EvidenceItemSchema(BaseModel):
    type: str
    description: str
    file_paths: list[str] = []
    line_ranges: list[list[int]] = []
    symbols: list[str] = []
    content_snippet: str | None = None
    weight: float = 1.0


class ClaimSchema(BaseModel):
    claim: str
    claim_type: str
    confidence_level: str  # high | medium | low | unknown
    confidence_score: float
    evidence_items: list[EvidenceItemSchema] = []
    is_deterministic: bool = False
    reasoning_summary: str = ""
    related_entities: list[str] = []
    caveats: list[str] = []


# ─────────────────────────── Stack ───────────────────────────


class StackItem(BaseModel):
    technology: str
    category: str
    confidence_level: str = "high"
    confidence_score: float = 1.0
    evidence_files: list[str] = []
    used_in_files: list[str] = []
    notes: str = ""
    evidence_items: list[EvidenceItemSchema] = []


# ─────────────────────────── Project Identity ───────────────────────────


class ProjectIdentitySchema(BaseModel):
    project_type: str
    display_name: str
    description: str
    confidence_level: str
    confidence_score: float
    confidence_label: str = ""
    domain_entities: list[str] = []
    likely_users: list[str] = []
    key_signals: list[str] = []
    alternative_types: list[dict[str, Any]] = []
    evidence_items: list[EvidenceItemSchema] = []


# ─────────────────────────── Quality ───────────────────────────


class ScoredMetricSchema(BaseModel):
    name: str
    score: float
    label: str
    reasons: list[str] = []
    evidence_files: list[str] = []
    caveats: list[str] = []
    raw_values: dict[str, Any] = {}


class FileRiskSchema(BaseModel):
    path: str
    risk_score: float
    risk_label: str
    fan_in: int = 0
    fan_out: int = 0
    line_count: int = 0
    symbol_count: int = 0
    betweenness: float = 0.0
    reasons: list[str] = []
    is_entry_point: bool = False


class AntiPatternSchema(BaseModel):
    kind: str
    title: str
    description: str
    severity: str
    affected_files: list[str] = []
    recommendation: str = ""


class QualityReportSchema(BaseModel):
    overall_score: float
    overall_label: str
    metrics: list[ScoredMetricSchema] = []
    file_risks: list[FileRiskSchema] = []
    anti_patterns: list[AntiPatternSchema] = []
    refactor_priorities: list[str] = []
    quick_wins: list[str] = []


# ─────────────────────────── Impact ───────────────────────────


class ImpactedFileSchema(BaseModel):
    path: str
    module: str
    impact_distance: int
    is_entry_point: bool = False
    is_test: bool = False


class ImpactedModuleSchema(BaseModel):
    name: str
    impacted_files: list[str] = []
    has_entry_points: bool = False
    max_distance: int = 1
    file_count: int = 0


class ImpactAnalysisSchema(BaseModel):
    target_path: str
    blast_radius: int
    blast_radius_score: float
    blast_radius_label: str
    direct_dependents: list[ImpactedFileSchema] = []
    second_order_dependents: list[ImpactedFileSchema] = []
    third_order_dependents: list[ImpactedFileSchema] = []
    affected_modules: list[ImpactedModuleSchema] = []
    affected_entry_points: list[str] = []
    affected_runtime_entry_points: list[dict[str, Any]] = []
    suggested_tests: list[dict[str, Any]] = []
    safe_to_change: bool = True
    change_risk_score: float = 0.0
    change_risk_label: str = "low"
    review_path: list[str] = []
    reasoning: list[str] = []
    # MVP "Change Impact + Review Guidance"
    file_summary: dict[str, Any] = {}
    impact_classification: list[dict[str, Any]] = []
    review_plan: list[dict[str, Any]] = []
    suggested_checks: list[dict[str, Any]] = []
    related_files: list[dict[str, Any]] = []
    verdict: dict[str, Any] = {}
    confidence: dict[str, Any] = {}


class ImpactCandidateSchema(BaseModel):
    path: str
    direct_dependents: int
    is_entry_point: bool = False
    runtime_kind: str | None = None
    primary_category: str
    role: str
    score: float


# ─────────────────────────── Legacy schemas (kept for compatibility) ───────────────────────────


class ScoreItem(BaseModel):
    label: str
    score: float = Field(..., ge=0, le=10)
    confidence: str = Field(..., pattern="^(high|medium|low)$")
    rationale: str


class ArchitectureLayer(BaseModel):
    name: str
    description: str
    key_files: list[str] = []


class FlowStep(BaseModel):
    step: int
    description: str
    evidence_files: list[str] = []
    confidence: str = "medium"


class QualityPoint(BaseModel):
    area: str
    assessment: str  # "strong" | "adequate" | "weak"
    detail: str
    evidence_files: list[str] = []


class ComplexityHotspot(BaseModel):
    path: str
    reason: str
    fan_in: int = 0
    fan_out: int = 0
    risk_score: float = 0


class CritiquePoint(BaseModel):
    kind: str  # "strength" | "weakness" | "risk" | "smell"
    title: str
    detail: str
    severity: str = "medium"  # "low" | "medium" | "high"
    evidence_files: list[str] = []


class Improvement(BaseModel):
    title: str
    detail: str
    effort: str  # "quick-win" | "medium" | "architectural"
    category: str
    evidence_files: list[str] = []


class ConfidenceNote(BaseModel):
    claim: str
    confidence: str  # "high" | "medium" | "low"
    basis: str


class IntelligenceReportResponse(BaseModel):
    """Full Repository Intelligence Report."""

    # A. Summary
    summary: str
    project_type: str
    likely_domain: str

    # B. Stack (now with evidence)
    stack: list[StackItem] = []

    # B2. Structured identity (new)
    identity: ProjectIdentitySchema | None = None

    # C. Architecture
    architecture_overview: str
    architecture_layers: list[ArchitectureLayer] = []

    # D. App / Website Flow
    app_flow: list[FlowStep] = []
    app_flow_notes: str = ""

    # E. Code Quality (legacy points + new graded report)
    quality_assessment: list[QualityPoint] = []
    quality_report: QualityReportSchema | None = None

    # F. Complexity
    complexity_overview: str = ""
    complexity_hotspots: list[ComplexityHotspot] = []

    # G. Optimization / Efficiency
    optimization_notes: str = ""

    # H. Senior-Level Critique
    critique: list[CritiquePoint] = []

    # I. Improvements
    improvements: list[Improvement] = []

    # J. Confidence / Evidence Notes
    confidence_notes: list[ConfidenceNote] = []

    # Scores
    scores: list[ScoreItem] = []

    # Metadata
    repo_name: str | None = None
    detected_framework: str | None = None
    detected_language: str | None = None
    total_files: int = 0
    total_lines: int = 0
    total_functions: int = 0
    total_classes: int = 0

    model_config = {"from_attributes": True}
