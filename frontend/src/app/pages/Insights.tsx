import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Compass,
  Loader2,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  getRepoHealth,
  type HealthDimension,
  type HealthSignal,
  type LongevityConcern,
  type PriorityFix,
  type RepoHealthResponse,
  type ReviewGuidanceStep,
} from "@/lib/api";
import {
  Card,
  ConfidenceNote,
  DotSep,
  EmptyState,
  Eyebrow,
  FadeIn,
  MetaText,
  MetricBar,
  PageHero,
  PageShell,
  Path,
  ScoreRing,
  Section,
  SectionNav,
  Skeleton,
  toConfidence,
  toSeverity,
  type Confidence,
  type Severity,
} from "../ds";

// ── helpers ────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  structure: "Structure",
  cohesion: "Cohesion",
  complexity: "Complexity",
  boundary: "Boundary",
  coupling: "Coupling",
  runtime: "Runtime",
  reviewability: "Reviewability",
  isolation: "Isolation",
  config: "Config sprawl",
  utility: "Utility dumping",
  surface: "Hidden surface",
};

const GRADE_LABEL: Record<string, string> = {
  strong: "Strong",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unknown: "Unknown",
};

const GRADE_TONE: Record<string, string> = {
  strong: "var(--rs-conf-deterministic)",
  good: "var(--rs-conf-strong)",
  fair: "var(--rs-conf-moderate)",
  poor: "var(--rs-sev-critical)",
  unknown: "var(--rs-text-muted)",
};

const SEV_TONE: Record<Severity, string> = {
  critical: "var(--rs-sev-critical)",
  high: "var(--rs-sev-high)",
  medium: "var(--rs-sev-medium)",
  low: "var(--rs-sev-low)",
  info: "var(--rs-text-muted)",
};

const PRESSURE_TONE: Record<string, Severity> = {
  high: "high",
  moderate: "medium",
  low: "low",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  deterministic: "Certain",
  strong: "Strong",
  moderate: "Moderate",
  weak: "Tentative",
  unknown: "Unknown",
};

function coerceConfidence(value: string | undefined | null): Confidence {
  return toConfidence(value);
}

function coerceSeverity(value: string | undefined | null): Severity {
  return toSeverity(value);
}

function categoryLabel(key: string): string {
  return (
    CATEGORY_LABEL[key] ??
    key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")
  );
}

function dimensionScoreColor(score: number): string {
  if (score >= 80) return "var(--rs-conf-deterministic)";
  if (score >= 60) return "var(--rs-conf-strong)";
  if (score >= 40) return "var(--rs-conf-moderate)";
  return "var(--rs-sev-critical)";
}

function humanEvidence(source: string, kind: string): string {
  // Translate a raw `source.kind` pair into a sentence that reads like
  // reviewer prose rather than a raw heuristic id.
  const s = source.toLowerCase();
  const k = kind.toLowerCase().replace(/_/g, " ");
  if (s.includes("graph")) return `Based on the import graph · ${k}`;
  if (s.includes("size") || s.includes("loc"))
    return `Based on file size · ${k}`;
  if (s.includes("complexity")) return `Based on complexity metrics · ${k}`;
  if (s.includes("coupling")) return `Based on coupling metrics · ${k}`;
  if (s.includes("hist") || s.includes("churn"))
    return `Based on change history · ${k}`;
  return `Based on ${s.replace(/_/g, " ")} · ${k}`;
}

// ── nav ────────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fix-first", label: "Fix first" },
  { id: "signals", label: "Signals" },
  { id: "longevity", label: "Long-term" },
  { id: "review", label: "Review guide" },
  { id: "coverage", label: "Methodology" },
];

// ── overview ───────────────────────────────────────────────────────────────

function OverviewBlock({ report }: { report: RepoHealthResponse }) {
  const overallScore = useMemo(() => {
    if (!report.dimensions.length) return 0;
    return Math.round(
      report.dimensions.reduce((acc, d) => acc + d.score, 0) /
        report.dimensions.length,
    );
  }, [report.dimensions]);

  const grade = report.summary.overall_grade;
  const tone = GRADE_TONE[grade] ?? GRADE_TONE.unknown;

  return (
    <Section id="overview">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 28,
          alignItems: "center",
          padding: "18px 4px 22px",
          borderBottom: "1px solid var(--rs-hairline)",
        }}
      >
        <ScoreRing
          value={overallScore}
          size={96}
          stroke={6}
          tone={tone}
          label="overall"
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontSize: "var(--rs-text-eyebrow)",
              textTransform: "uppercase",
              letterSpacing: "var(--rs-tracking-eyebrow)",
              color: "var(--rs-text-muted)",
              fontWeight: 600,
            }}
          >
            Overall grade ·{" "}
            <span style={{ color: tone, fontWeight: 600 }}>
              {GRADE_LABEL[grade] ?? "Unknown"}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "var(--rs-text-body)",
              lineHeight: "var(--rs-leading-relaxed)",
              color: "var(--rs-text-secondary)",
              maxWidth: "62ch",
            }}
          >
            Composite of {report.dimensions.length} engineering dimensions over{" "}
            <span style={{ color: "var(--rs-text-primary)" }}>
              {report.summary.total_files.toLocaleString()}
            </span>{" "}
            files and{" "}
            <span style={{ color: "var(--rs-text-primary)" }}>
              {report.summary.total_edges.toLocaleString()}
            </span>{" "}
            dependency edges.
            {report.summary.signal_count > 0
              ? ` ${report.summary.signal_count} pattern${report.summary.signal_count === 1 ? "" : "s"} observed`
              : " No patterns fired"}
            {report.summary.critical_count > 0
              ? `, ${report.summary.critical_count} critical.`
              : "."}
          </p>
          <div
            style={{
              display: "flex",
              gap: 18,
              fontVariantNumeric: "tabular-nums",
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              marginTop: 4,
            }}
          >
            <Stat label="Signals" value={report.summary.signal_count} />
            <Stat
              label="Critical"
              value={report.summary.critical_count}
              tone={
                report.summary.critical_count > 0
                  ? "var(--rs-sev-critical)"
                  : undefined
              }
            />
            <Stat
              label="High"
              value={report.summary.high_count}
              tone={
                report.summary.high_count > 0 ? "var(--rs-sev-high)" : undefined
              }
            />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          columnGap: 28,
          rowGap: 0,
        }}
      >
        {report.dimensions.map((d, i) => (
          <FadeIn key={d.key} delay={i * 0.04}>
            <DimensionRow dim={d} />
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span
        style={{
          color: tone ?? "var(--rs-text-primary)",
          fontWeight: 500,
          fontSize: "var(--rs-text-body)",
        }}
      >
        {value}
      </span>
      <span style={{ color: "var(--rs-text-muted)" }}>{label}</span>
    </span>
  );
}

function DimensionRow({ dim }: { dim: HealthDimension }) {
  const [open, setOpen] = useState(false);
  const tone = dimensionScoreColor(dim.score);
  return (
    <div
      style={{
        padding: "10px 0",
        borderBottom: "1px solid var(--rs-hairline)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        className="flex items-center justify-between gap-3"
        style={{ minWidth: 0 }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "var(--rs-text-body)",
              fontWeight: 500,
              color: "var(--rs-text-primary)",
              lineHeight: "var(--rs-leading-snug)",
            }}
          >
            {dim.label}
          </div>
          <MetaText>
            {GRADE_LABEL[dim.grade] ?? dim.grade}
            <DotSep />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {Math.round(dim.score)} / 100
            </span>
          </MetaText>
        </div>
        <ScoreRing value={dim.score} size={36} stroke={3} tone={tone} />
      </div>
      <MetricBar value={dim.score} tone={tone} />
      {dim.measures.length > 0 && (
        <div
          style={{
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-secondary)",
            lineHeight: "var(--rs-leading-normal)",
          }}
        >
          {dim.measures[0]}
        </div>
      )}
      {(dim.contributing.length > 0 || dim.blind_spots.length > 0) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-muted)",
          }}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {open ? "Hide detail" : "Detail"}
        </button>
      )}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dim.contributing.length > 0 && (
            <div
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-secondary)",
                lineHeight: "var(--rs-leading-relaxed)",
                borderLeft: "2px solid var(--rs-hairline-strong)",
                paddingLeft: 10,
              }}
            >
              <div style={{ color: "var(--rs-text-muted)" }}>Drivers</div>
              {dim.contributing.map((c, i) => (
                <div key={i}>{c}</div>
              ))}
            </div>
          )}
          {dim.blind_spots.length > 0 && (
            <div
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-muted)",
                lineHeight: "var(--rs-leading-relaxed)",
                borderLeft: "2px solid var(--rs-hairline)",
                paddingLeft: 10,
              }}
            >
              <div>Blind spots</div>
              {dim.blind_spots.map((c, i) => (
                <div key={i}>{c}</div>
              ))}
            </div>
          )}
          <div
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
            }}
          >
            Confidence: {CONFIDENCE_LABEL[coerceConfidence(dim.confidence)]}
          </div>
        </div>
      )}
    </div>
  );
}

// ── fix-first ──────────────────────────────────────────────────────────────

function FixFirstBlock({ priorities }: { priorities: PriorityFix[] }) {
  if (!priorities.length) {
    return (
      <Section
        id="fix-first"
        title="What to fix first"
        description="No prioritised fixes surfaced. The repository looks structurally calm."
      >
        <EmptyState
          variant="no-data"
          tone="success"
          title="Nothing to escalate"
          detail="Every signal scored either low severity or high confidence-of-no-issue."
        />
      </Section>
    );
  }

  return (
    <Section
      id="fix-first"
      title="What to fix first"
      description="Ranked by leverage — small changes with the biggest payoff."
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {priorities.map((p, i) => (
          <FadeIn key={`${p.rank}-${p.title}`} delay={i * 0.04}>
            <PriorityRow fix={p} featured={i === 0} />
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

function PriorityRow({
  fix,
  featured,
}: {
  fix: PriorityFix;
  featured: boolean;
}) {
  const sev = coerceSeverity(fix.severity);
  const tone = SEV_TONE[sev];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "36px 1fr",
        gap: 14,
        padding: featured ? "18px 18px" : "14px 16px",
        background: featured ? "var(--rs-surface-2)" : "var(--rs-surface-1)",
        border: "1px solid var(--rs-hairline)",
        borderLeft: `2px solid ${tone}`,
        borderRadius: "var(--rs-radius-md)",
      }}
    >
      <span
        style={{
          fontSize: featured ? 20 : 16,
          fontWeight: 500,
          color: "var(--rs-text-muted)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          paddingTop: 2,
        }}
      >
        {String(fix.rank).padStart(2, "0")}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          className="flex items-baseline justify-between gap-3"
          style={{ flexWrap: "wrap" }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: featured
                ? "var(--rs-text-title)"
                : "var(--rs-text-heading)",
              fontWeight: 500,
              color: "var(--rs-text-primary)",
              letterSpacing: "var(--rs-tracking-snug)",
              lineHeight: "var(--rs-leading-snug)",
              maxWidth: "48ch",
            }}
          >
            {fix.title}
          </h3>
          <span
            style={{
              fontSize: "var(--rs-text-meta)",
              color: tone,
              textTransform: "capitalize",
              fontWeight: 500,
            }}
          >
            {sev} severity
          </span>
        </div>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "var(--rs-text-body)",
            color: "var(--rs-text-secondary)",
            lineHeight: "var(--rs-leading-relaxed)",
            maxWidth: "62ch",
          }}
        >
          {fix.why_first}
        </p>
        {fix.first_action && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              background: "var(--rs-surface-1)",
              borderLeft: `2px solid ${tone}`,
              borderRadius: "var(--rs-radius-sm)",
              fontSize: "var(--rs-text-body)",
              color: "var(--rs-text-primary)",
              lineHeight: "var(--rs-leading-relaxed)",
              maxWidth: "62ch",
            }}
          >
            <span
              style={{
                fontSize: "var(--rs-text-eyebrow)",
                textTransform: "uppercase",
                letterSpacing: "var(--rs-tracking-eyebrow)",
                color: "var(--rs-text-muted)",
                fontWeight: 600,
                marginRight: 8,
              }}
            >
              First move
            </span>
            {fix.first_action}
          </div>
        )}
        {fix.affected_files.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <AffectedFileList files={fix.affected_files} />
          </div>
        )}
      </div>
    </div>
  );
}

function AffectedFileList({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const initial = 4;
  const visible = expanded ? files : files.slice(0, initial);
  const hidden = files.length - visible.length;
  return (
    <div>
      <div
        style={{
          fontSize: "var(--rs-text-eyebrow)",
          textTransform: "uppercase",
          letterSpacing: "var(--rs-tracking-eyebrow)",
          color: "var(--rs-text-muted)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {files.length} affected file{files.length === 1 ? "" : "s"}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {visible.map((f) => (
          <Path key={f} value={f} size={12} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            all: "unset",
            cursor: "pointer",
            marginTop: 4,
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          Show {hidden} more <ChevronDown size={11} />
        </button>
      )}
    </div>
  );
}

// ── signals ────────────────────────────────────────────────────────────────

function SignalsBlock({ signals }: { signals: HealthSignal[] }) {
  const [filter, setFilter] = useState<string>("all");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of signals) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [signals]);

  const filtered = useMemo(() => {
    if (filter === "all") return signals;
    return signals.filter((s) => s.category === filter);
  }, [signals, filter]);

  if (!signals.length) {
    return (
      <Section
        id="signals"
        title="Signals behind the score"
        description="No objective patterns fired on this snapshot."
      >
        <EmptyState
          variant="no-data"
          tone="success"
          title="No signals fired"
          detail="None of the heuristics observed a pattern worth surfacing."
        />
      </Section>
    );
  }

  return (
    <Section
      id="signals"
      title="Signals behind the score"
      description="Objective patterns that informed the diagnosis."
    >
      <FilterBar
        counts={counts}
        total={signals.length}
        active={filter}
        onChange={setFilter}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderTop: "1px solid var(--rs-hairline)",
        }}
      >
        {filtered.map((s, i) => (
          <FadeIn key={s.id} delay={Math.min(i, 8) * 0.03}>
            <SignalRow signal={s} />
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

function FilterBar({
  counts,
  total,
  active,
  onChange,
}: {
  counts: [string, number][];
  total: number;
  active: string;
  onChange: (v: string) => void;
}) {
  const options: [string, number, string][] = [
    ["all", total, "All"],
    ...counts.map(
      (c) => [c[0], c[1], categoryLabel(c[0])] as [string, number, string],
    ),
  ];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 2,
        fontSize: "var(--rs-text-meta)",
      }}
    >
      {options.map(([key, n, label], i) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "6px 10px",
              color: isActive
                ? "var(--rs-text-primary)"
                : "var(--rs-text-muted)",
              borderBottom: isActive
                ? "1px solid var(--rs-text-primary)"
                : "1px solid transparent",
              marginRight: i < options.length - 1 ? 2 : 0,
              transition: "color var(--rs-dur-fast)",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--rs-text-secondary)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--rs-text-muted)";
            }}
          >
            {label}{" "}
            <span
              style={{
                color: "var(--rs-text-muted)",
                fontVariantNumeric: "tabular-nums",
                marginLeft: 2,
              }}
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SignalRow({ signal }: { signal: HealthSignal }) {
  const [open, setOpen] = useState(false);
  const sev = coerceSeverity(signal.severity);
  const tone = SEV_TONE[sev];
  const fileCount = signal.affected_files.length;
  const moduleCount = signal.affected_modules.length;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--rs-hairline)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "8px 1fr auto",
          gap: 12,
          width: "100%",
          padding: "12px 2px",
          alignItems: "flex-start",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: tone,
            marginTop: 8,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--rs-text-body)",
              fontWeight: 500,
              color: "var(--rs-text-primary)",
              lineHeight: "var(--rs-leading-snug)",
            }}
          >
            {signal.title}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--rs-text-secondary)" }}>
              {categoryLabel(signal.category)}
            </span>
            {fileCount > 0 && (
              <span>
                {fileCount} file{fileCount === 1 ? "" : "s"}
              </span>
            )}
            {moduleCount > 0 && (
              <span>
                {moduleCount} module{moduleCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={13}
          color="var(--rs-text-muted)"
          style={{
            marginTop: 4,
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform var(--rs-dur-fast)",
          }}
        />
      </button>

      {open && (
        <div
          style={{
            padding: "2px 2px 16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "var(--rs-text-body)",
              lineHeight: "var(--rs-leading-relaxed)",
              color: "var(--rs-text-secondary)",
              maxWidth: "62ch",
            }}
          >
            {signal.why_it_matters}
          </p>

          {signal.suggested_action && (
            <p
              style={{
                margin: 0,
                fontSize: "var(--rs-text-body)",
                lineHeight: "var(--rs-leading-relaxed)",
                color: "var(--rs-text-primary)",
                maxWidth: "62ch",
              }}
            >
              <span
                style={{
                  fontSize: "var(--rs-text-eyebrow)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--rs-tracking-eyebrow)",
                  color: "var(--rs-text-muted)",
                  fontWeight: 600,
                  marginRight: 8,
                }}
              >
                Suggested
              </span>
              {signal.suggested_action}
            </p>
          )}

          {signal.affected_files.length > 0 && (
            <AffectedFileList files={signal.affected_files} />
          )}

          {signal.evidence.length > 0 && (
            <div
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-muted)",
                lineHeight: "var(--rs-leading-relaxed)",
                paddingLeft: 10,
                borderLeft: "2px solid var(--rs-hairline)",
              }}
            >
              {humanEvidence(signal.source, signal.kind)}
              {signal.evidence.slice(0, 2).map((e, i) => (
                <div key={i} style={{ color: "var(--rs-text-secondary)" }}>
                  · {e}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── longevity (editorial) ──────────────────────────────────────────────────

function LongevityBlock({ items }: { items: LongevityConcern[] }) {
  if (!items.length) return null;
  return (
    <Section
      id="longevity"
      title="Long-term maintainability"
      description="Slower-burning concerns. Not urgent, but they compound."
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderTop: "1px solid var(--rs-hairline)",
        }}
      >
        {items.map((it, i) => (
          <FadeIn key={i} delay={i * 0.04}>
            <LongevityRow concern={it} />
          </FadeIn>
        ))}
      </div>
    </Section>
  );
}

function LongevityRow({ concern }: { concern: LongevityConcern }) {
  const sev = PRESSURE_TONE[concern.pressure] ?? "info";
  const tone = SEV_TONE[sev];
  return (
    <article
      style={{
        padding: "18px 4px",
        borderBottom: "1px solid var(--rs-hairline)",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          paddingTop: 2,
          minWidth: 76,
        }}
      >
        <span
          style={{
            fontSize: "var(--rs-text-eyebrow)",
            textTransform: "uppercase",
            letterSpacing: "var(--rs-tracking-eyebrow)",
            color: "var(--rs-text-muted)",
            fontWeight: 600,
          }}
        >
          {concern.pressure[0].toUpperCase() + concern.pressure.slice(1)}
        </span>
        <span
          style={{
            marginTop: 3,
            display: "inline-block",
            width: 22,
            height: 2,
            background: tone,
            borderRadius: 2,
          }}
        />
      </div>
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--rs-text-heading)",
            fontWeight: 500,
            color: "var(--rs-text-primary)",
            letterSpacing: "var(--rs-tracking-snug)",
            lineHeight: "var(--rs-leading-snug)",
          }}
        >
          {concern.title}
        </h3>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "var(--rs-text-body)",
            lineHeight: "var(--rs-leading-relaxed)",
            color: "var(--rs-text-secondary)",
            maxWidth: "62ch",
          }}
        >
          {concern.detail}
        </p>
        {concern.grounded_on.length > 0 && (
          <div
            style={{
              marginTop: 10,
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              lineHeight: "var(--rs-leading-normal)",
            }}
          >
            Based on {concern.grounded_on.slice(0, 3).join(", ")}
            {concern.grounded_on.length > 3
              ? ` · +${concern.grounded_on.length - 3}`
              : ""}
          </div>
        )}
      </div>
    </article>
  );
}

// ── review ─────────────────────────────────────────────────────────────────

function ReviewBlock({ steps }: { steps: ReviewGuidanceStep[] }) {
  if (!steps.length) return null;
  return (
    <Section
      id="review"
      title="How to review this repo"
      description="The order a senior engineer would take to build a real mental model."
    >
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          borderTop: "1px solid var(--rs-hairline)",
        }}
      >
        {steps.map((s, i) => (
          <FadeIn key={s.step} delay={i * 0.04}>
            <li
              style={{
                display: "grid",
                gridTemplateColumns: "30px 1fr",
                gap: 14,
                padding: "14px 0",
                borderBottom: "1px solid var(--rs-hairline)",
              }}
            >
              <div
                style={{
                  fontSize: "var(--rs-text-meta)",
                  color: "var(--rs-text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  paddingTop: 2,
                }}
              >
                {String(s.step).padStart(2, "0")}
              </div>
              <div>
                <div
                  style={{
                    fontSize: "var(--rs-text-body)",
                    fontWeight: 500,
                    color: "var(--rs-text-primary)",
                    lineHeight: "var(--rs-leading-snug)",
                  }}
                >
                  {s.title}
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
                  {s.detail}
                </p>
              </div>
            </li>
          </FadeIn>
        ))}
      </ol>
    </Section>
  );
}

// ── coverage ───────────────────────────────────────────────────────────────

function CoverageBlock({
  coverage,
}: {
  coverage: RepoHealthResponse["coverage"];
}) {
  return (
    <Section
      id="coverage"
      title="What was checked"
      description="Inputs behind this report."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
        }}
      >
        <div>
          <Eyebrow>Checked</Eyebrow>
          <ul
            style={{
              margin: "8px 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {coverage.checked.map((c) => (
              <li
                key={c}
                style={{
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-normal)",
                  color: "var(--rs-text-secondary)",
                }}
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Eyebrow>Not yet checked</Eyebrow>
          {coverage.not_yet_checked.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <ConfidenceNote>
                Nothing material left in the queue.
              </ConfidenceNote>
            </div>
          ) : (
            <ul
              style={{
                margin: "8px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {coverage.not_yet_checked.map((c) => (
                <li
                  key={c}
                  style={{
                    fontSize: "var(--rs-text-body)",
                    lineHeight: "var(--rs-leading-normal)",
                    color: "var(--rs-text-muted)",
                  }}
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── loading skeleton ───────────────────────────────────────────────────────

function InsightsSkeleton() {
  return (
    <PageShell width="wide">
      <PageHero
        eyebrow="Insights"
        title={<Skeleton width={520} height={26} />}
        lede={<Skeleton width={380} height={14} />}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} variant="flat" padding={16}>
            <Skeleton width="60%" height={14} />
            <div style={{ marginTop: 10 }}>
              <Skeleton width="100%" height={4} radius={4} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Skeleton width="80%" height={11} />
            </div>
          </Card>
        ))}
      </div>
      <div
        className="flex items-center gap-2"
        style={{ color: "var(--rs-text-muted)" }}
      >
        <Loader2 className="animate-spin" size={14} />
        <MetaText>Running diagnostics…</MetaText>
      </div>
    </PageShell>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function Insights() {
  const activeAnalysisId = useAppStore((s) => s.activeAnalysisId);
  const [report, setReport] = useState<RepoHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAnalysisId) return;
    setLoading(true);
    setError(null);
    getRepoHealth(activeAnalysisId)
      .then((r) => setReport(r))
      .catch((e) => setError(e?.message ?? "Failed to load repository health."))
      .finally(() => setLoading(false));
  }, [activeAnalysisId]);

  if (!activeAnalysisId) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Insights"
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

  if (loading && !report) return <InsightsSkeleton />;

  if (error) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Insights"
          title="Couldn't load the health report"
          lede="The report endpoint returned an error. The analysis may still be in progress."
        />
        <EmptyState tone="danger" title="Report unavailable" detail={error} />
      </PageShell>
    );
  }

  if (!report) return null;

  return (
    <PageShell width="wide">
      <PageHero
        eyebrow="Engineering health"
        title="A review memo for this repository"
        lede="What's healthy, what deserves attention first, and why."
        actions={
          <a
            href="#fix-first"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById("fix-first");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-primary)",
              background: "var(--rs-surface-2)",
              border: "1px solid var(--rs-hairline-strong)",
              borderRadius: "var(--rs-radius-md)",
              textDecoration: "none",
            }}
          >
            Jump to fixes
            <ArrowUpRight size={12} />
          </a>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 160px",
          gap: 32,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
          <OverviewBlock report={report} />
          <FixFirstBlock priorities={report.priorities} />
          <SignalsBlock signals={report.signals} />
          <LongevityBlock items={report.longevity} />
          <ReviewBlock steps={report.review_guidance} />
          <CoverageBlock coverage={report.coverage} />
        </div>
        <div className="hidden lg:block">
          <SectionNav items={NAV_ITEMS} />
        </div>
      </div>
    </PageShell>
  );
}
