import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileCode,
  Flame,
  Layers,
  Loader2,
  ShieldCheck,
  Waypoints,
  Zap,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  getRiskSurface,
  type RiskItem,
  type RiskSurfaceResponse,
} from "@/lib/api";
import {
  Callout,
  Card,
  ConfidenceBadge,
  DotSep,
  EmptyState,
  EvidenceBlock,
  Eyebrow,
  FadeIn,
  MetaText,
  PageHero,
  PageShell,
  Path,
  Section,
  SectionNav,
  SeverityBadge,
  SeverityDot,
  Skeleton,
  Stat,
  StatStrip,
  Tag,
  toConfidence,
  toneFor,
  toSeverity,
  type Confidence,
  type Severity,
} from "../ds";

// ── meta ───────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  string,
  { label: string; icon: React.ElementType; hint: string }
> = {
  blast_radius: {
    label: "Blast radius",
    icon: Flame,
    hint: "A change here ripples to many files.",
  },
  coupling: {
    label: "Coupling",
    icon: Waypoints,
    hint: "This code depends on many moving parts.",
  },
  reviewability: {
    label: "Reviewability",
    icon: FileCode,
    hint: "Files too large or dense to review safely.",
  },
  fragility: {
    label: "Fragility",
    icon: AlertTriangle,
    hint: "Small edits can cause outsized breakage.",
  },
  runtime: {
    label: "Runtime",
    icon: Zap,
    hint: "Lives on the critical startup / request path.",
  },
  boundary: {
    label: "Boundary",
    icon: Layers,
    hint: "Architectural seams have eroded here.",
  },
};

function categoryMeta(key: string) {
  return (
    CATEGORY_META[key] ?? {
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "),
      icon: AlertTriangle,
      hint: "",
    }
  );
}

function coerceConfidence(value: string | undefined | null): Confidence {
  return toConfidence(value);
}

function coerceSeverity(value: string | undefined | null): Severity {
  return toSeverity(value);
}

// Surface the most informative single metric on the card's first row.
const KEY_METRIC_PRIORITY = [
  "fan_in",
  "fan_out",
  "depth",
  "max_depth",
  "complexity",
  "cycle_length",
  "duplicates",
  "lines",
  "size",
  "count",
];

function pickKeyMetric(
  metrics: Record<string, number | string> | undefined,
): { label: string; value: string } | null {
  if (!metrics) return null;
  for (const k of KEY_METRIC_PRIORITY) {
    if (k in metrics) {
      const v = metrics[k];
      return {
        label: k.replace(/_/g, " "),
        value: typeof v === "number" ? v.toLocaleString() : String(v),
      };
    }
  }
  const first = Object.entries(metrics)[0];
  if (!first) return null;
  return {
    label: first[0].replace(/_/g, " "),
    value:
      typeof first[1] === "number"
        ? first[1].toLocaleString()
        : String(first[1]),
  };
}

const NAV_ITEMS = [
  { id: "summary", label: "Summary" },
  { id: "areas", label: "Risk areas" },
  { id: "healthy", label: "Healthy patterns" },
  { id: "checked", label: "What we checked" },
];

// ── risk card ──────────────────────────────────────────────────────────────

function RiskCard({ item }: { item: RiskItem }) {
  const [open, setOpen] = useState(false);
  const sev = coerceSeverity(item.severity);
  const conf = coerceConfidence(item.confidence);
  const meta = categoryMeta(item.category);
  const Icon = meta.icon;

  const tone = toneFor(sev);

  // Pick the most informative single metric to surface on row 1.
  const keyMetric = pickKeyMetric(item.metrics);
  const fileCount = item.affected_files.length;
  const moduleCount = item.affected_modules.length;
  const scopeText =
    moduleCount > 0
      ? `${moduleCount} module${moduleCount === 1 ? "" : "s"} · ${fileCount} file${fileCount === 1 ? "" : "s"}`
      : `${fileCount} file${fileCount === 1 ? "" : "s"}`;

  return (
    <Card variant="feature" tone={tone} padding={18}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "var(--rs-radius-md)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--rs-surface-2)",
            color: "var(--rs-text-secondary)",
            border: "1px solid var(--rs-hairline)",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <Icon size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: severity + title + scope + confidence + key metric */}
          <div
            className="flex items-center gap-2 flex-wrap"
            style={{ minHeight: 22 }}
          >
            <SeverityBadge severity={sev} />
            <span
              style={{
                fontSize: "var(--rs-text-heading)",
                fontWeight: 500,
                color: "var(--rs-text-primary)",
                letterSpacing: "var(--rs-tracking-snug)",
              }}
            >
              {item.title}
            </span>
            <DotSep />
            <MetaText>{scopeText}</MetaText>
            <DotSep />
            <span
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "var(--rs-tracking-wide)",
              }}
            >
              {conf}
            </span>
            {keyMetric && (
              <>
                <DotSep />
                <span
                  style={{
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-secondary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ color: "var(--rs-text-muted)" }}>
                    {keyMetric.label}
                  </span>{" "}
                  <span
                    style={{ color: "var(--rs-text-primary)", fontWeight: 500 }}
                  >
                    {keyMetric.value}
                  </span>
                </span>
              </>
            )}
            <span style={{ flex: 1 }} />
            {open ? (
              <ChevronDown size={14} color="var(--rs-text-muted)" />
            ) : (
              <ChevronRight size={14} color="var(--rs-text-muted)" />
            )}
          </div>

          {/* Row 2: one-line "why it matters" */}
          <p
            style={{
              margin: "8px 0 0",
              fontSize: "var(--rs-text-body)",
              lineHeight: "var(--rs-leading-relaxed)",
              color: "var(--rs-text-secondary)",
              maxWidth: "70ch",
            }}
          >
            {item.summary}
          </p>
        </div>
      </button>

      {open && (
        <div
          style={{
            marginTop: 14,
            paddingLeft: 44,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {item.what_could_go_wrong.length > 0 && (
            <EvidenceBlock
              label="What could go wrong"
              items={item.what_could_go_wrong.map((r, i) => (
                <span key={i}>{r}</span>
              ))}
            />
          )}

          {item.evidence.length > 0 && (
            <EvidenceBlock
              label="Evidence"
              items={item.evidence.slice(0, 8).map((e, i) => (
                <code
                  key={i}
                  style={{
                    fontFamily:
                      "'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
                    fontSize: 11,
                    color: "var(--rs-text-secondary)",
                  }}
                >
                  {e}
                </code>
              ))}
            />
          )}

          {Object.keys(item.metrics ?? {}).length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              {Object.entries(item.metrics).map(([k, v]) => (
                <Stat
                  key={k}
                  label={k.replace(/_/g, " ")}
                  value={typeof v === "number" ? v.toLocaleString() : v}
                />
              ))}
            </div>
          )}

          {item.affected_files.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Eyebrow>Affected files</Eyebrow>
              {item.affected_files.slice(0, 8).map((f) => (
                <Path key={f} value={f} />
              ))}
              {item.affected_files.length > 8 && (
                <MetaText>+{item.affected_files.length - 8} more</MetaText>
              )}
            </div>
          )}

          {item.affected_modules.length > 0 && (
            <div
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-muted)",
                lineHeight: "var(--rs-leading-relaxed)",
              }}
            >
              <Eyebrow>Modules</Eyebrow>{" "}
              <span
                style={{
                  fontFamily: "var(--rs-font-mono)",
                  color: "var(--rs-text-secondary)",
                }}
              >
                {item.affected_modules.map((m) => m || "(root)").join(" · ")}
              </span>
            </div>
          )}

          {item.review_type && (
            <Callout tone="info" title="How to review this">
              {item.review_type}
            </Callout>
          )}

          <ConfidenceBadge
            confidence={conf}
            rationale={meta.hint || `Category: ${meta.label}`}
          />
        </div>
      )}
    </Card>
  );
}

// ── healthy notes / what we checked ────────────────────────────────────────

function HealthyBlock({
  notes,
  checked,
}: {
  notes: string[];
  checked: string[];
}) {
  if (notes.length === 0) return null;
  return (
    <Section
      id="healthy"
      title="Healthy patterns observed"
      description="The analysis didn't only look for problems — these are signals where the repository is actively doing well."
    >
      <Card variant="outline" padding={18} tone="success">
        <div className="flex items-start gap-3">
          <ShieldCheck
            size={16}
            style={{ color: "var(--rs-conf-deterministic)", marginTop: 2 }}
          />
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flex: 1,
            }}
          >
            {notes.map((n, i) => (
              <li
                key={i}
                style={{
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-normal)",
                  color: "var(--rs-text-secondary)",
                }}
              >
                {n}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      {checked.length > 0 && (
        <MetaText>
          Grounded in {checked.length} dedicated heuristic
          {checked.length === 1 ? "" : "s"}.
        </MetaText>
      )}
    </Section>
  );
}

function CheckedBlock({ checked }: { checked: string[] }) {
  return (
    <Section
      id="checked"
      title="What we checked"
      description="Every claim above is grounded in one of these checks. If a category is missing, this snapshot didn't have enough signal to evaluate it."
    >
      <Card variant="flat" padding={16}>
        <div
          style={{
            fontSize: "var(--rs-text-body)",
            lineHeight: "var(--rs-leading-relaxed)",
            color: "var(--rs-text-secondary)",
          }}
        >
          {checked.join(" · ")}
        </div>
      </Card>
    </Section>
  );
}

// ── skeleton ───────────────────────────────────────────────────────────────

function RiskSkeleton() {
  return (
    <PageShell width="wide">
      <PageHero
        eyebrow="Risk surface"
        title={<Skeleton width={520} height={26} />}
        lede={<Skeleton width={420} height={14} />}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} variant="flat" padding={16}>
            <Skeleton width="40%" height={14} />
            <div style={{ marginTop: 10 }}>
              <Skeleton width="80%" height={12} />
            </div>
          </Card>
        ))}
      </div>
      <div
        className="flex items-center gap-2"
        style={{ color: "var(--rs-text-muted)" }}
      >
        <Loader2 className="animate-spin" size={14} />
        <MetaText>Computing risk surface…</MetaText>
      </div>
    </PageShell>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function RiskAreas() {
  const activeAnalysisId = useAppStore((s) => s.activeAnalysisId);
  const [data, setData] = useState<RiskSurfaceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!activeAnalysisId) return;
    setLoading(true);
    setError(null);
    getRiskSurface(activeAnalysisId)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed to load risk surface."))
      .finally(() => setLoading(false));
  }, [activeAnalysisId]);

  const categories = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, number>();
    for (const it of data.items)
      m.set(it.category, (m.get(it.category) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.items;
    return data.items.filter((i) => i.category === filter);
  }, [data, filter]);

  if (!activeAnalysisId) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Risk surface"
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

  if (loading && !data) return <RiskSkeleton />;

  if (error) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Risk surface"
          title="Couldn't load risk surface"
          lede="The risk endpoint returned an error. The analysis may still be in progress, or the worker may be unavailable."
        />
        <EmptyState
          tone="danger"
          title="Risk surface unavailable"
          detail={error}
        />
      </PageShell>
    );
  }

  if (!data) return null;

  const hasItems = data.items.length > 0;
  const hasHigh = data.summary.critical + data.summary.high > 0;

  return (
    <PageShell width="wide">
      <PageHero
        eyebrow="Risk surface · Operational"
        title={
          hasHigh
            ? "Where you should worry first"
            : "Quiet repository — no urgent risk areas"
        }
        lede="Concrete operational risks the analysis surfaced — the things a team lead should know before planning a sprint. Each item names the files and metrics behind it."
        meta={
          <>
            <MetaText>
              {data.summary.total} risk area
              {data.summary.total === 1 ? "" : "s"}
            </MetaText>
            <DotSep />
            <span
              style={{
                color:
                  data.summary.critical > 0
                    ? "var(--rs-sev-critical)"
                    : "var(--rs-text-muted)",
                fontWeight: data.summary.critical > 0 ? 500 : 400,
              }}
            >
              {data.summary.critical} critical
            </span>
            <DotSep />
            <span
              style={{
                color:
                  data.summary.high > 0
                    ? "var(--rs-sev-high)"
                    : "var(--rs-text-muted)",
                fontWeight: data.summary.high > 0 ? 500 : 400,
              }}
            >
              {data.summary.high} high
            </span>
          </>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
          <Section
            id="summary"
            title="Severity at a glance"
            description="Counts by severity tier across all detected risk areas."
          >
            <StatStrip
              items={[
                { label: "Total", value: data.summary.total.toString() },
                {
                  label: "Critical",
                  value: data.summary.critical.toString(),
                  tone:
                    data.summary.critical > 0
                      ? "var(--rs-sev-critical)"
                      : undefined,
                },
                {
                  label: "High",
                  value: data.summary.high.toString(),
                  tone:
                    data.summary.high > 0 ? "var(--rs-sev-high)" : undefined,
                },
                {
                  label: "Medium",
                  value: data.summary.medium.toString(),
                  tone:
                    data.summary.medium > 0
                      ? "var(--rs-sev-medium)"
                      : undefined,
                },
                {
                  label: "Low",
                  value: data.summary.low.toString(),
                  tone: data.summary.low > 0 ? "var(--rs-sev-low)" : undefined,
                },
              ]}
            />
          </Section>

          <Section
            id="areas"
            title="Risk areas"
            description="Each item is grounded in concrete files and metrics. Confidence reflects how deterministic the underlying heuristic is — strong inference is not the same as truth."
            aside={
              hasItems ? (
                <MetaText>
                  {filtered.length} of {data.items.length}
                </MetaText>
              ) : undefined
            }
          >
            {!hasItems ? (
              <EmptyState
                variant="no-data"
                tone="success"
                icon={<ShieldCheck size={16} />}
                title="No risk areas surfaced"
                detail="None of the operational risk heuristics flagged this snapshot. The healthy notes below describe what the analysis looked at."
                whatChecked={data.checked.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              />
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag
                    active={filter === "all"}
                    onClick={() => setFilter("all")}
                  >
                    All ({data.items.length})
                  </Tag>
                  {categories.map(([c, n]) => (
                    <Tag
                      key={c}
                      active={filter === c}
                      onClick={() => setFilter(c)}
                      icon={
                        <span style={{ display: "inline-flex" }}>
                          <SeverityDot severity="info" size={4} />
                        </span>
                      }
                    >
                      {categoryMeta(c).label} ({n})
                    </Tag>
                  ))}
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  {filtered.map((item, i) => (
                    <FadeIn key={item.id} delay={Math.min(i, 6) * 0.04}>
                      <RiskCard item={item} />
                    </FadeIn>
                  ))}
                </div>
              </>
            )}
          </Section>

          <HealthyBlock notes={data.healthy_notes} checked={data.checked} />
          <CheckedBlock checked={data.checked} />
        </div>

        <div className="hidden lg:block">
          <SectionNav items={NAV_ITEMS} />
        </div>
      </div>
    </PageShell>
  );
}
