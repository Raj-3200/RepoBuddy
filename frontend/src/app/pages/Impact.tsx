import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  ExternalLink,
  FileCode,
  Loader2,
  Package,
  Search,
  Zap,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  getImpactAnalysis,
  getImpactCandidates,
  listFiles,
  type FileItem,
  type ImpactAnalysisResponse,
  type ImpactCandidate,
  type ImpactedFileEvidence,
  type ReviewPlanStep,
} from "@/lib/api";
import {
  Card,
  ConfidenceNote,
  DotSep,
  EmptyState,
  EvidenceBlock,
  Eyebrow,
  FadeIn,
  MetaText,
  MetricBar,
  Mono,
  PageHero,
  PageShell,
  Path,
  Section,
  SectionNav,
  Skeleton,
  Tag,
  toConfidence,
  toSeverity,
  type Severity,
} from "../ds";

// ── helpers ────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  config: "Config",
  infra: "Infra",
  test: "Test",
  docs: "Docs",
  schema: "Schema",
  api: "API",
  ui: "UI",
  service: "Service",
  worker: "Worker",
  model: "Model",
  utility: "Utility",
  entrypoint: "Entrypoint",
};

function blastRadiusScore(impact: ImpactAnalysisResponse): number {
  return Math.round((impact.blast_radius_score ?? 0) * 100);
}

const SEV_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const SEV_TONE: Record<Severity, string> = {
  critical: "var(--rs-sev-critical)",
  high: "var(--rs-sev-high)",
  medium: "var(--rs-sev-medium)",
  low: "var(--rs-sev-low)",
  info: "var(--rs-text-muted)",
};

/** Map a raw change-risk label into a restrained composite headline. */
function compositeRiskHeadline(
  sev: Severity,
  blast: number,
  elevated: boolean,
): { label: string; tone: string; tag: string } {
  if (elevated && sev !== "critical") {
    return {
      label: "Elevated review attention",
      tone: SEV_TONE.high,
      tag: "elevated",
    };
  }
  if (sev === "critical") {
    return {
      label: "High overall change risk",
      tone: SEV_TONE.critical,
      tag: "critical",
    };
  }
  if (sev === "high") {
    return {
      label: "Elevated change risk",
      tone: SEV_TONE.high,
      tag: "high",
    };
  }
  if (sev === "medium" || blast >= 20) {
    return {
      label: "Moderate change risk",
      tone: SEV_TONE.medium,
      tag: "moderate",
    };
  }
  if (sev === "low" || blast > 0) {
    return {
      label: "Low change risk",
      tone: SEV_TONE.low,
      tag: "low",
    };
  }
  return {
    label: "Isolated change",
    tone: "var(--rs-conf-deterministic)",
    tag: "isolated",
  };
}

/**
 * Produce a single, plain-English sentence explaining why the composite
 * risk has been elevated above what blast radius alone would imply.
 * Returns null when the blast radius alone already justifies the label.
 */
function riskNarrative(
  impact: ImpactAnalysisResponse,
  headlineSev: Severity,
): string | null {
  const blast = blastRadiusScore(impact);
  const blastSev: Severity =
    blast >= 70
      ? "critical"
      : blast >= 45
        ? "high"
        : blast >= 20
          ? "medium"
          : blast > 0
            ? "low"
            : "info";
  if (SEV_RANK[headlineSev] <= SEV_RANK[blastSev]) return null;

  const fs = impact.file_summary;
  const runtime = impact.affected_runtime_entry_points?.length ?? 0;
  const userFacing = impact.affected_entry_points?.length ?? 0;
  const parts: string[] = [];

  if (fs?.is_entry_point) parts.push("the file is itself an entry point");
  if (runtime > 0)
    parts.push(
      `${runtime} runtime entry point${runtime === 1 ? "" : "s"} sit downstream`,
    );
  else if (userFacing > 0)
    parts.push(
      `${userFacing} user-facing surface${userFacing === 1 ? "" : "s"} depend${userFacing === 1 ? "s" : ""} on it`,
    );
  if (
    fs?.primary_category === "auth" ||
    fs?.primary_category === "security" ||
    fs?.primary_category === "payments"
  )
    parts.push("it sits on a sensitive trust boundary");
  if (!parts.length && impact.affected_modules?.length >= 4)
    parts.push(
      `${impact.affected_modules.length} modules reach it transitively`,
    );

  if (!parts.length) return null;
  return `Blast radius is ${impact.blast_radius_label.toLowerCase()}, but ${parts
    .slice(0, 2)
    .join(" and ")}.`;
}

const NAV_ITEMS = [
  { id: "target", label: "Diagnosis" },
  { id: "dependents", label: "Impact chain" },
  { id: "review", label: "Review plan" },
  { id: "checks", label: "Pre-merge" },
  { id: "verdict", label: "Verdict" },
];

// ── phase label ────────────────────────────────────────────────────────────

function PhaseLabel({ index, title }: { index: number; title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginTop: 12,
        marginBottom: -8,
        paddingTop: 4,
      }}
    >
      <span
        style={{
          fontSize: "var(--rs-text-eyebrow)",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "var(--rs-tracking-eyebrow)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        Phase {index} · {title}
      </span>
    </div>
  );
}

// ── file picker (compact control surface) ─────────────────────────────────

function FilePicker({
  files,
  candidates,
  selected,
  search,
  onSearch,
  onPick,
}: {
  files: FileItem[];
  candidates: ImpactCandidate[];
  selected: string | null;
  search: string;
  onSearch: (v: string) => void;
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(!selected);

  const filtered = useMemo(() => {
    if (!search.trim()) return files.slice(0, 60);
    const q = search.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 60);
  }, [files, search]);

  if (!open && selected) {
    return (
      <div
        className="flex items-center gap-3"
        style={{
          padding: "10px 14px",
          background: "var(--rs-surface-1)",
          border: "1px solid var(--rs-hairline)",
          borderRadius: "var(--rs-radius-md)",
          fontSize: "var(--rs-text-meta)",
          color: "var(--rs-text-muted)",
        }}
      >
        <FileCode size={12} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <Path value={selected} size={12} />
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-secondary)",
            textDecoration: "underline",
            textUnderlineOffset: 2,
            textDecorationColor: "var(--rs-hairline-strong)",
          }}
        >
          Change file
        </button>
      </div>
    );
  }

  return (
    <Card variant="flat" padding={0}>
      <div
        className="flex items-center gap-2"
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--rs-hairline)",
        }}
      >
        <Search size={14} color="var(--rs-text-muted)" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter files…"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: "var(--rs-text-body)",
            color: "var(--rs-text-primary)",
          }}
        />
        <MetaText>{files.length} files</MetaText>
        {selected && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              padding: "2px 6px",
            }}
            aria-label="Close picker"
          >
            ✕
          </button>
        )}
      </div>

      {candidates.length > 0 && !search && (
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--rs-hairline)",
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-muted)",
          }}
        >
          <span style={{ color: "var(--rs-text-secondary)" }}>Suggested: </span>
          {candidates.slice(0, 3).map((c, i) => (
            <span key={c.path}>
              {i > 0 && <DotSep />}
              <button
                type="button"
                onClick={() => onPick(c.path)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  color:
                    selected === c.path
                      ? "var(--rs-text-primary)"
                      : "var(--rs-text-secondary)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  textDecorationColor: "var(--rs-hairline-strong)",
                  fontFamily: "var(--rs-font-mono)",
                  fontSize: 11,
                }}
              >
                {c.path.split("/").pop()}
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "16px 14px" }}>
            <MetaText>No matching files.</MetaText>
          </div>
        ) : (
          filtered.map((f) => {
            const active = selected === f.path;
            return (
              <button
                key={f.id}
                onClick={() => {
                  onPick(f.path);
                  setOpen(false);
                }}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 14px",
                  background: active ? "var(--rs-surface-2)" : "transparent",
                  borderLeft: active
                    ? "2px solid var(--rs-accent)"
                    : "2px solid transparent",
                  transition:
                    "background var(--rs-dur-fast) var(--rs-ease-standard)",
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--rs-surface-2)";
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                }}
              >
                <FileCode size={11} color="var(--rs-text-muted)" />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <Path value={f.path} size={12} />
                </span>
                {f.is_entry_point && (
                  <Zap
                    size={10}
                    color="var(--rs-accent)"
                    aria-label="entry point"
                  />
                )}
                <MetaText>{f.line_count} LOC</MetaText>
              </button>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ── target + risk (intro) ──────────────────────────────────────────────────

function DiagnosisBlock({ impact }: { impact: ImpactAnalysisResponse }) {
  const fs = impact.file_summary;
  const sev = toSeverity(impact.change_risk_label);
  const blast = blastRadiusScore(impact);
  const runtime = impact.affected_runtime_entry_points?.length ?? 0;
  const userFacing = impact.affected_entry_points?.length ?? 0;
  const elevated =
    (runtime > 0 || userFacing > 0 || !!fs?.is_entry_point) && blast < 45;
  const composite = compositeRiskHeadline(sev, blast, elevated);
  const narrative = riskNarrative(
    impact,
    sev === "info" && elevated ? "high" : sev,
  );

  return (
    <Section id="target">
      <div
        style={{ display: "flex", flexDirection: "column", gap: 18 }}
        aria-label="Diagnosis"
      >
        {/* Target file block — the start of the story. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "var(--rs-text-display)",
              letterSpacing: "var(--rs-tracking-tight)",
              fontFamily: "var(--rs-font-mono)",
              lineHeight: 1.15,
            }}
          >
            {fs?.name ?? impact.target_path.split("/").pop()}
          </div>
          <Path value={impact.target_path} size={12} />
          {fs?.summary && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "var(--rs-text-body)",
                lineHeight: "var(--rs-leading-relaxed)",
                color: "var(--rs-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              {fs.summary}
            </p>
          )}
          <div
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginTop: 2,
            }}
          >
            {fs?.primary_category && (
              <span style={{ color: "var(--rs-text-secondary)" }}>
                {CATEGORY_LABEL[fs.primary_category] ?? fs.primary_category}
              </span>
            )}
            {fs?.module && (
              <>
                <DotSep />
                <span>module {fs.module}</span>
              </>
            )}
            {fs?.line_count ? (
              <>
                <DotSep />
                <span>{fs.line_count} LOC</span>
              </>
            ) : null}
            {fs?.is_entry_point && (
              <>
                <DotSep />
                <span
                  style={{
                    color: "var(--rs-accent)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Zap size={11} /> entry point
                </span>
              </>
            )}
            {fs?.runtime_kind && (
              <>
                <DotSep />
                <span style={{ color: "var(--rs-sev-high)" }}>
                  runtime · {fs.runtime_kind}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Composite risk readout. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 20,
            alignItems: "center",
            padding: "14px 16px",
            background: "var(--rs-surface-1)",
            border: "1px solid var(--rs-hairline)",
            borderLeft: `2px solid ${composite.tone}`,
            borderRadius: "var(--rs-radius-md)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "var(--rs-text-heading)",
                fontWeight: 500,
                color: "var(--rs-text-primary)",
                letterSpacing: "var(--rs-tracking-snug)",
              }}
            >
              {composite.label}
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-secondary)",
                lineHeight: "var(--rs-leading-relaxed)",
                maxWidth: "58ch",
              }}
            >
              {narrative ??
                `Blast radius ${impact.blast_radius_label.toLowerCase()} · ${impact.direct_dependents.length} direct dependent${impact.direct_dependents.length === 1 ? "" : "s"} · ${impact.affected_modules.length} module${impact.affected_modules.length === 1 ? "" : "s"} touched.`}
            </div>
          </div>
          <div
            style={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: 500,
                color: composite.tone,
                lineHeight: 1,
              }}
            >
              {blast}
            </div>
            <div
              style={{
                fontSize: "var(--rs-text-eyebrow)",
                textTransform: "uppercase",
                letterSpacing: "var(--rs-tracking-eyebrow)",
                color: "var(--rs-text-muted)",
                marginTop: 4,
              }}
            >
              Blast radius
            </div>
          </div>
        </div>

        <MetricBar value={blast} />

        {/* Three-up breakdown — supporting, light rows. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            borderTop: "1px solid var(--rs-hairline)",
            borderBottom: "1px solid var(--rs-hairline)",
          }}
        >
          <BreakdownCell
            label="Direct dependents"
            value={impact.direct_dependents.length}
            hint="one hop"
          />
          <BreakdownCell
            label="Affected modules"
            value={impact.affected_modules.length}
            hint={
              impact.affected_modules
                .slice(0, 2)
                .map((m) => m.name || "(root)")
                .join(", ") || "—"
            }
            divider
          />
          <BreakdownCell
            label="Entry points downstream"
            value={runtime + userFacing}
            hint={
              impact.affected_runtime_entry_points[0]?.kind ??
              impact.affected_entry_points[0] ??
              "—"
            }
            divider
            tone={runtime + userFacing > 0 ? "var(--rs-sev-high)" : undefined}
          />
        </div>

        {impact.reasoning.length > 0 && (
          <EvidenceBlock
            label="Why this level"
            items={impact.reasoning.map((r, i) => (
              <span key={i}>{r}</span>
            ))}
          />
        )}
      </div>
    </Section>
  );
}

function BreakdownCell({
  label,
  value,
  hint,
  divider,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  divider?: boolean;
  tone?: string;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderLeft: divider ? "1px solid var(--rs-hairline)" : undefined,
      }}
    >
      <div
        style={{
          fontSize: "var(--rs-text-eyebrow)",
          textTransform: "uppercase",
          letterSpacing: "var(--rs-tracking-eyebrow)",
          color: "var(--rs-text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: "var(--rs-text-title)",
          fontWeight: 500,
          color: tone ?? "var(--rs-text-primary)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            marginTop: 2,
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-muted)",
            lineHeight: "var(--rs-leading-normal)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ── dependents ─────────────────────────────────────────────────────────────

function DependentList({
  title,
  subtitle,
  files,
  onSelect,
  initial = 5,
}: {
  title: string;
  subtitle: string;
  files: ImpactedFileEvidence[];
  onSelect: (path: string) => void;
  initial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const visible = expanded ? files : files.slice(0, initial);
  const hiddenCount = files.length - visible.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        className="flex items-baseline justify-between gap-3"
        style={{ marginBottom: 2 }}
      >
        <div>
          <span
            style={{
              fontSize: "var(--rs-text-body)",
              fontWeight: 500,
              color: "var(--rs-text-primary)",
            }}
          >
            {title}
          </span>
          <span
            style={{
              marginLeft: 8,
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {files.length}
          </span>
        </div>
        <MetaText>{subtitle}</MetaText>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderTop: "1px solid var(--rs-hairline)",
        }}
      >
        {visible.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 0",
              borderBottom: "1px solid var(--rs-hairline)",
              transition: "background var(--rs-dur-fast)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--rs-surface-1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            <span style={{ flex: 1, minWidth: 0, paddingLeft: 2 }}>
              <Path value={f.path} size={12} />
            </span>
            <span
              className="flex items-center gap-2"
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-muted)",
              }}
            >
              {f.is_entry_point && (
                <Zap
                  size={10}
                  color="var(--rs-accent)"
                  aria-label="entry point"
                />
              )}
              <ArrowRight size={11} style={{ opacity: 0.5 }} />
            </span>
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            all: "unset",
            cursor: "pointer",
            alignSelf: "flex-start",
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 0",
          }}
        >
          Show {hiddenCount} more <ChevronDown size={11} />
        </button>
      )}
    </div>
  );
}

function ZeroDependents({ impact }: { impact: ImpactAnalysisResponse }) {
  const cats = impact.file_summary?.categories ?? [];
  let detail =
    "Nothing in the analysed graph imports this file — the change is isolated by current evidence.";
  if (cats.includes("config") || cats.includes("infra")) {
    detail =
      "No source file imports this directly, but config and infra are consumed at build or boot time. Verify the systems that read it still get valid values.";
  } else if (cats.includes("docs")) {
    detail =
      "Docs-only file. No runtime impact expected — render the markdown and check internal links.";
  } else if (cats.includes("test")) {
    detail =
      "This is a test file. Run it locally; nothing in the runtime depends on it.";
  }
  return (
    <EmptyState
      variant="no-data"
      tone="success"
      icon={<CheckCircle2 size={16} />}
      title="No static importers"
      detail={detail}
    />
  );
}

function DependentsBlock({
  impact,
  onSelectFile,
}: {
  impact: ImpactAnalysisResponse;
  onSelectFile: (path: string) => void;
}) {
  const empty =
    impact.direct_dependents.length === 0 &&
    impact.second_order_dependents.length === 0 &&
    impact.third_order_dependents.length === 0;

  return (
    <Section
      id="dependents"
      title="Who depends on this"
      description="Importers by distance from the target. Click a file to focus on it next."
    >
      {empty ? (
        <ZeroDependents impact={impact} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <DependentList
            title="Direct dependents"
            subtitle="one hop away"
            files={impact.direct_dependents}
            onSelect={onSelectFile}
          />
          <DependentList
            title="Second-order"
            subtitle="two hops"
            files={impact.second_order_dependents}
            onSelect={onSelectFile}
          />
          <DependentList
            title="Third-order"
            subtitle="three hops"
            files={impact.third_order_dependents}
            onSelect={onSelectFile}
            initial={3}
          />

          {impact.affected_modules.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Eyebrow>Affected modules</Eyebrow>
              <div
                style={{
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-relaxed)",
                  color: "var(--rs-text-secondary)",
                }}
              >
                {impact.affected_modules.map((m, i) => (
                  <span key={m.name || i}>
                    {i > 0 && (
                      <span
                        style={{
                          color: "var(--rs-text-muted)",
                          margin: "0 8px",
                        }}
                      >
                        ·
                      </span>
                    )}
                    <span
                      style={{
                        color: "var(--rs-text-primary)",
                      }}
                    >
                      {m.name || "(root)"}
                    </span>
                    <span
                      style={{
                        color: "var(--rs-text-muted)",
                        fontVariantNumeric: "tabular-nums",
                        marginLeft: 4,
                      }}
                    >
                      ×{m.file_count}
                    </span>
                    {m.has_entry_points && (
                      <span
                        title="Contains entry points"
                        style={{
                          marginLeft: 4,
                          color: "var(--rs-accent)",
                        }}
                      >
                        ◉
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── review path ────────────────────────────────────────────────────────────

function ReviewStep({
  step,
  onSelectFile,
}: {
  step: ReviewPlanStep;
  onSelectFile: (path: string) => void;
}) {
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: 14,
        padding: "14px 0",
        borderBottom: "1px solid var(--rs-hairline)",
      }}
    >
      <span
        style={{
          fontSize: "var(--rs-text-meta)",
          color: "var(--rs-text-muted)",
          fontVariantNumeric: "tabular-nums",
          paddingTop: 2,
        }}
      >
        {String(step.order).padStart(2, "0")}
      </span>
      <div>
        <div
          style={{
            fontSize: "var(--rs-text-body)",
            fontWeight: 500,
            color: "var(--rs-text-primary)",
            lineHeight: "var(--rs-leading-snug)",
          }}
        >
          {step.title}
        </div>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "var(--rs-text-body)",
            lineHeight: "var(--rs-leading-relaxed)",
            color: "var(--rs-text-secondary)",
            maxWidth: "62ch",
          }}
        >
          {step.detail}
        </p>
        {(step.files.length > 0 || (step.modules?.length ?? 0) > 0) && (
          <div
            style={{
              marginTop: 8,
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              lineHeight: "var(--rs-leading-relaxed)",
            }}
          >
            {step.files.length > 0 && (
              <span>
                Files:{" "}
                {step.files.slice(0, 4).map((f, i) => (
                  <span key={f}>
                    {i > 0 && ", "}
                    <button
                      type="button"
                      onClick={() => onSelectFile(f)}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        color: "var(--rs-text-secondary)",
                        fontFamily: "var(--rs-font-mono)",
                        textDecoration: "underline",
                        textUnderlineOffset: 2,
                        textDecorationColor: "var(--rs-hairline-strong)",
                      }}
                    >
                      {f.split("/").pop()}
                    </button>
                  </span>
                ))}
                {step.files.length > 4 && (
                  <span> · +{step.files.length - 4}</span>
                )}
              </span>
            )}
            {step.files.length > 0 && (step.modules?.length ?? 0) > 0 && (
              <span style={{ margin: "0 8px" }}>·</span>
            )}
            {(step.modules?.length ?? 0) > 0 && (
              <span>
                Modules:{" "}
                <span style={{ color: "var(--rs-text-secondary)" }}>
                  {(step.modules ?? []).slice(0, 3).join(", ")}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function ReviewPathBlock({
  impact,
  onSelectFile,
}: {
  impact: ImpactAnalysisResponse;
  onSelectFile: (path: string) => void;
}) {
  const steps = impact.review_plan;
  if (steps.length === 0) {
    return (
      <Section id="review" title="Review path">
        <ConfidenceNote>No follow-up review steps required.</ConfidenceNote>
      </Section>
    );
  }
  return (
    <Section id="review" title="Review path" description="Walk these in order.">
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          borderTop: "1px solid var(--rs-hairline)",
        }}
      >
        {steps.map((s) => (
          <ReviewStep key={s.order} step={s} onSelectFile={onSelectFile} />
        ))}
      </ol>
    </Section>
  );
}

// ── pre-merge ──────────────────────────────────────────────────────────────

function ChecksBlock({ impact }: { impact: ImpactAnalysisResponse }) {
  const hasChecks = impact.suggested_checks.length > 0;
  const hasRuntime = impact.affected_runtime_entry_points.length > 0;
  const hasTests = impact.suggested_tests.length > 0;

  if (!hasChecks && !hasRuntime && !hasTests) return null;

  return (
    <Section
      id="checks"
      title="Pre-merge checks"
      description="Run these before merging."
    >
      {hasRuntime && (
        <div
          style={{
            padding: "12px 14px",
            background: "rgba(245, 160, 81, 0.04)",
            border: "1px solid rgba(245, 160, 81, 0.18)",
            borderRadius: "var(--rs-radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              fontSize: "var(--rs-text-body)",
              fontWeight: 500,
              color: "var(--rs-sev-high)",
            }}
          >
            <Zap size={13} /> Runtime entry points downstream
          </div>
          <div
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-secondary)",
              lineHeight: "var(--rs-leading-relaxed)",
            }}
          >
            These run on their own triggers and can silently break without being
            imported into a test path:
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              paddingTop: 2,
            }}
          >
            {impact.affected_runtime_entry_points.map((r) => (
              <div
                key={r.path}
                className="flex items-center justify-between gap-3"
                style={{
                  padding: "4px 0",
                  fontSize: "var(--rs-text-meta)",
                }}
              >
                <Path value={r.path} size={12} />
                <span
                  style={{
                    color: "var(--rs-sev-high)",
                    fontFamily: "var(--rs-font-mono)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {r.kind}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasChecks && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Checks</Eyebrow>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {impact.suggested_checks.map((c) => (
              <li
                key={c.check}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--rs-hairline)",
                }}
              >
                <CheckCircle2
                  size={13}
                  style={{
                    color: "var(--rs-conf-deterministic)",
                    marginTop: 3,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: "var(--rs-text-body)",
                      color: "var(--rs-text-primary)",
                    }}
                  >
                    {c.check}
                  </div>
                  <MetaText>{c.reason}</MetaText>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasTests && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow>Tests to run</Eyebrow>
          <ol
            style={{
              listStyle: "decimal",
              margin: 0,
              paddingLeft: 20,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              color: "var(--rs-text-secondary)",
            }}
          >
            {impact.suggested_tests.map((s) => (
              <li key={s.path}>
                <Path value={s.path} size={12} />
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-muted)",
                  }}
                >
                  — {s.reason}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {impact.related_files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow>Related files</Eyebrow>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderTop: "1px solid var(--rs-hairline)",
            }}
          >
            {impact.related_files.slice(0, 6).map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => {
                  /* pivot via parent */
                }}
                style={{
                  all: "unset",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--rs-hairline)",
                }}
              >
                <ExternalLink size={11} color="var(--rs-text-muted)" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Path value={r.path} size={12} />
                </span>
                <span
                  style={{
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-muted)",
                  }}
                >
                  {r.reason}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ── verdict ────────────────────────────────────────────────────────────────

const CONFIDENCE_LABEL: Record<string, string> = {
  deterministic: "Certain",
  strong: "Strong",
  moderate: "Moderate",
  weak: "Tentative",
};

function VerdictBlock({ impact }: { impact: ImpactAnalysisResponse }) {
  const verdict = impact.verdict;
  if (!verdict?.headline) return null;

  const sev = toSeverity(impact.change_risk_label);
  const conf = toConfidence(impact.confidence?.level);
  const confLabel = CONFIDENCE_LABEL[conf] ?? "Moderate";
  const evidence = impact.confidence?.evidence ?? [];

  return (
    <Section id="verdict">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "20px 22px",
          background: "var(--rs-surface-2)",
          border: "1px solid var(--rs-hairline-strong)",
          borderLeft: `2px solid ${SEV_TONE[sev]}`,
          borderRadius: "var(--rs-radius-lg)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "var(--rs-text-eyebrow)",
              textTransform: "uppercase",
              letterSpacing: "var(--rs-tracking-eyebrow)",
              color: "var(--rs-text-muted)",
              fontWeight: 600,
            }}
          >
            Verdict
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: "var(--rs-text-title)",
              fontWeight: 500,
              color: "var(--rs-text-display)",
              letterSpacing: "var(--rs-tracking-tight)",
              lineHeight: 1.25,
              maxWidth: "52ch",
            }}
          >
            {verdict.headline}
          </div>
          {verdict.detail && (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--rs-text-body)",
                lineHeight: "var(--rs-leading-relaxed)",
                color: "var(--rs-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              {verdict.detail}
            </p>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid var(--rs-hairline)",
          }}
        >
          <span
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
            }}
          >
            Confidence
          </span>
          <span
            style={{
              fontSize: "var(--rs-text-body)",
              color: "var(--rs-text-primary)",
              fontWeight: 500,
            }}
          >
            {confLabel}
          </span>
          {evidence.length > 0 && (
            <span
              style={{
                color: "var(--rs-text-muted)",
                fontSize: "var(--rs-text-meta)",
              }}
            >
              · {evidence.length} supporting signal
              {evidence.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {impact.confidence?.note && (
          <div
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              lineHeight: "var(--rs-leading-relaxed)",
              maxWidth: "62ch",
            }}
          >
            {impact.confidence.note}
          </div>
        )}
      </div>
    </Section>
  );
}

// ── skeleton ───────────────────────────────────────────────────────────────

function ImpactSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card variant="flat" padding={20}>
        <Skeleton width="50%" height={20} />
        <div style={{ marginTop: 8 }}>
          <Skeleton width="80%" height={12} />
        </div>
      </Card>
      <Card variant="flat" padding={16}>
        <Skeleton width="40%" height={12} />
        <div style={{ marginTop: 10 }}>
          <Skeleton width="100%" height={4} radius={4} />
        </div>
      </Card>
      <div
        className="flex items-center gap-2"
        style={{ color: "var(--rs-text-muted)" }}
      >
        <Loader2 className="animate-spin" size={14} />
        <MetaText>Tracing dependents…</MetaText>
      </div>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function Impact() {
  const { activeRepoId, activeAnalysisId } = useAppStore();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ImpactCandidate[]>([]);

  useEffect(() => {
    if (!activeRepoId) return;
    listFiles(activeRepoId)
      .then((list) => setFiles(list ?? []))
      .catch(() => {});
  }, [activeRepoId]);

  const runImpact = useCallback(
    async (path: string) => {
      if (!activeAnalysisId) return;
      setSelected(path);
      setLoading(true);
      setError(null);
      setImpact(null);
      try {
        const res = await getImpactAnalysis(activeAnalysisId, path);
        setImpact(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Impact analysis failed");
      } finally {
        setLoading(false);
      }
    },
    [activeAnalysisId],
  );

  useEffect(() => {
    if (!activeAnalysisId) return;
    let cancelled = false;
    getImpactCandidates(activeAnalysisId, 6)
      .then((list) => {
        if (cancelled) return;
        setCandidates(list ?? []);
        if ((list ?? []).length > 0 && !selected) {
          runImpact(list[0].path);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnalysisId]);

  if (!activeAnalysisId) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Change impact"
          title="No repository selected"
          lede="Analyze a repository to see further details."
        />
        <AnalyzePlaceholder
          title="No repository selected"
          detail="Analyze a repository to see further details."
        />
      </PageShell>
    );
  }

  // keep Tag / Mono symbols from being marked unused by linters if tree-shaken.
  void Tag;
  void Mono;

  return (
    <PageShell width="wide">
      <PageHero
        eyebrow="Change impact"
        title="Before you change a file, see what it touches"
        lede="What depends on it, what to review next, and what to double-check before merge."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 160px",
          gap: 32,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <FilePicker
            files={files}
            candidates={candidates}
            selected={selected}
            search={search}
            onSearch={setSearch}
            onPick={runImpact}
          />

          {loading && <ImpactSkeleton />}

          {error && !loading && (
            <EmptyState
              tone="danger"
              title="Impact analysis failed"
              detail={error}
            />
          )}

          {!impact && !loading && !error && (
            <EmptyState
              variant="no-data"
              icon={<Package size={16} />}
              title="Pick a file to plan your change"
              detail="Select a source file to see its dependents and what to check before merging."
            />
          )}

          {impact && !loading && (
            <FadeIn>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 32 }}
              >
                <PhaseLabel index={1} title="Diagnosis" />
                <DiagnosisBlock impact={impact} />

                <PhaseLabel index={2} title="Impact chain" />
                <DependentsBlock impact={impact} onSelectFile={runImpact} />

                <PhaseLabel index={3} title="Review plan" />
                <ReviewPathBlock impact={impact} onSelectFile={runImpact} />

                <PhaseLabel index={4} title="Pre-merge actions" />
                <ChecksBlock impact={impact} />

                <PhaseLabel index={5} title="Verdict" />
                <VerdictBlock impact={impact} />
              </div>
            </FadeIn>
          )}
        </div>

        <div className="hidden lg:block">
          {impact && <SectionNav items={NAV_ITEMS} />}
        </div>
      </div>
    </PageShell>
  );
}
