import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  FileCode,
  Loader2,
  Shield,
  Layers,
  Zap,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Minus,
  ChevronRight,
  ArrowUpRight,
  Target,
  Brain,
  Gauge,
  BarChart3,
  Package,
  Route,
  Search,
  Wrench,
  Eye,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  getIntelligenceReport,
  type IntelligenceReportResponse,
  type ScoreItem,
  type QualityPoint,
  type CritiquePoint,
  type ComplexityHotspot,
  type FlowStep,
  type StackItem,
  type ImprovementItem,
  type ConfidenceNote,
  type ArchitectureLayer,
} from "@/lib/api";

/* ── Shared UI ── */

function FadeIn({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function FileRef({ path }: { path: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1"
      style={{
        fontSize: 11,
        fontFamily: "monospace",
        color: "var(--rs-accent)",
        background: "rgba(124,108,245,0.1)",
        border: "1px solid rgba(124,108,245,0.2)",
        verticalAlign: "middle",
      }}
    >
      <FileCode size={9} />
      {path}
    </span>
  );
}

function SectionAnchor({
  id,
  title,
  icon: Icon,
  children,
  delay = 0,
}: {
  id: string;
  title: string;
  icon: any;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <FadeIn delay={delay}>
      <section id={id} className="scroll-mt-20" style={{ marginBottom: 48 }}>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 32,
              height: 32,
              background: "var(--rs-accent-dim)",
            }}
          >
            <Icon size={16} style={{ color: "var(--rs-accent)" }} />
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--rs-text-primary)",
              letterSpacing: "-0.03em",
            }}
          >
            {title}
          </h2>
        </div>
        {children}
      </section>
    </FadeIn>
  );
}

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const pct = score / 10;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color =
    score >= 7
      ? "var(--rs-green)"
      : score >= 4
        ? "var(--rs-amber)"
        : "var(--rs-red)";
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--rs-surface-3)"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={`${pct * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color,
          letterSpacing: "-0.02em",
        }}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function AssessmentBadge({
  assessment,
}: {
  assessment: "strong" | "adequate" | "weak";
}) {
  const cfg = {
    strong: {
      bg: "var(--rs-green-dim)",
      fg: "var(--rs-green)",
      label: "Strong",
    },
    adequate: {
      bg: "var(--rs-amber-dim)",
      fg: "var(--rs-amber)",
      label: "Adequate",
    },
    weak: { bg: "var(--rs-red-dim)", fg: "var(--rs-red)", label: "Weak" },
  }[assessment];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5"
      style={{
        fontSize: 11,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.fg,
      }}
    >
      {assessment === "strong" && <CheckCircle2 size={10} />}
      {assessment === "adequate" && <Minus size={10} />}
      {assessment === "weak" && <XCircle size={10} />}
      {cfg.label}
    </span>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: "high" | "medium" | "low" | string;
}) {
  const cfg = {
    high: { bg: "var(--rs-green-dim)", fg: "var(--rs-green)" },
    medium: { bg: "var(--rs-amber-dim)", fg: "var(--rs-amber)" },
    low: { bg: "var(--rs-red-dim)", fg: "var(--rs-red)" },
  }[confidence] ?? { bg: "var(--rs-surface-3)", fg: "var(--rs-text-muted)" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5"
      style={{
        fontSize: 10,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.fg,
      }}
    >
      {confidence}
    </span>
  );
}

function EffortBadge({ effort }: { effort: string }) {
  const cfg = {
    "quick-win": {
      bg: "var(--rs-green-dim)",
      fg: "var(--rs-green)",
      label: "Quick Win",
    },
    medium: {
      bg: "var(--rs-amber-dim)",
      fg: "var(--rs-amber)",
      label: "Medium Effort",
    },
    architectural: {
      bg: "var(--rs-red-dim)",
      fg: "var(--rs-red)",
      label: "Architectural",
    },
  }[effort] ?? {
    bg: "var(--rs-surface-3)",
    fg: "var(--rs-text-muted)",
    label: effort,
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5"
      style={{
        fontSize: 10,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.fg,
      }}
    >
      {cfg.label}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const cfg = {
    strength: {
      bg: "var(--rs-green-dim)",
      fg: "var(--rs-green)",
      icon: CheckCircle2,
    },
    weakness: {
      bg: "var(--rs-amber-dim)",
      fg: "var(--rs-amber)",
      icon: AlertTriangle,
    },
    risk: { bg: "var(--rs-red-dim)", fg: "var(--rs-red)", icon: Shield },
    smell: { bg: "rgba(232,121,249,0.12)", fg: "#E879F9", icon: Search },
  }[kind] ?? {
    bg: "var(--rs-surface-3)",
    fg: "var(--rs-text-muted)",
    icon: Minus,
  };
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5"
      style={{
        fontSize: 10,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.fg,
        textTransform: "capitalize",
      }}
    >
      <Icon size={10} />
      {kind}
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
  return String(n);
}

/* ── Navigation ── */

const SECTIONS = [
  { id: "summary", label: "Summary", icon: Brain },
  { id: "scores", label: "Scores", icon: Gauge },
  { id: "stack", label: "Stack", icon: Package },
  { id: "architecture", label: "Architecture", icon: Layers },
  { id: "flow", label: "App Flow", icon: Route },
  { id: "quality", label: "Code Quality", icon: CheckCircle2 },
  { id: "complexity", label: "Complexity", icon: BarChart3 },
  { id: "critique", label: "Critique", icon: Eye },
  { id: "improvements", label: "Improvements", icon: Wrench },
  { id: "confidence", label: "Confidence", icon: Shield },
];

/* ── Section Components ── */

function SummarySection({ data }: { data: IntelligenceReportResponse }) {
  return (
    <SectionAnchor
      id="summary"
      title="Repository Summary"
      icon={Brain}
      delay={0.05}
    >
      <div
        className="rounded-xl p-6"
        style={{
          background: "var(--rs-surface-1)",
          border: "1px solid var(--rs-border)",
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <span
            className="rounded-full px-3 py-1"
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: "var(--rs-accent-dim)",
              color: "var(--rs-accent)",
            }}
          >
            {data.project_type}
          </span>
          <span
            className="rounded-full px-3 py-1"
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: "var(--rs-blue)" + "1a",
              color: "var(--rs-blue)",
            }}
          >
            {data.likely_domain}
          </span>
        </div>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.8,
          }}
        >
          {data.summary}
        </p>
      </div>
      {/* Quick stats */}
      <div
        className="grid gap-3 mt-5"
        style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
      >
        {[
          { label: "Files", value: formatNumber(data.total_files) },
          { label: "Lines", value: formatNumber(data.total_lines) },
          { label: "Functions", value: formatNumber(data.total_functions) },
          { label: "Classes", value: formatNumber(data.total_classes) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{
              background: "var(--rs-surface-2)",
              border: "1px solid var(--rs-border)",
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--rs-text-primary)",
                letterSpacing: "-0.03em",
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--rs-text-muted)",
                marginTop: 2,
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </SectionAnchor>
  );
}

function ScoresSection({ data }: { data: IntelligenceReportResponse }) {
  if (!data.scores.length) return null;
  return (
    <SectionAnchor
      id="scores"
      title="Assessment Scores"
      icon={Gauge}
      delay={0.1}
    >
      <p
        style={{
          fontSize: 13,
          color: "var(--rs-text-muted)",
          marginBottom: 16,
        }}
      >
        Scores are heuristic-based (0–10) and tied to structural evidence. They
        do not reflect runtime behavior.
      </p>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {data.scores.map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-4 flex items-center gap-4"
            style={{
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-border)",
            }}
          >
            <ScoreRing score={s.score} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--rs-text-primary)",
                  }}
                >
                  {s.label}
                </span>
                <ConfidenceBadge confidence={s.confidence} />
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--rs-text-muted)",
                  lineHeight: 1.5,
                }}
              >
                {s.rationale}
              </p>
            </div>
          </div>
        ))}
      </div>
    </SectionAnchor>
  );
}

function StackSection({ data }: { data: IntelligenceReportResponse }) {
  if (!data.stack.length) return null;

  const grouped: Record<string, StackItem[]> = {};
  for (const item of data.stack) {
    const cat = item.category.replace(/_/g, " ");
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  return (
    <SectionAnchor
      id="stack"
      title="Stack Detection"
      icon={Package}
      delay={0.15}
    >
      <div className="flex flex-col gap-5">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--rs-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 10,
              }}
            >
              {category}
            </h3>
            <div className="flex flex-wrap gap-2">
              {items.map((item) => (
                <div
                  key={`${item.technology}-${item.category}`}
                  className="rounded-xl px-4 py-3 flex flex-col gap-1"
                  style={{
                    background: "var(--rs-surface-1)",
                    border: "1px solid var(--rs-border)",
                    minWidth: 180,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--rs-text-primary)",
                    }}
                  >
                    {item.technology}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--rs-text-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.notes}
                  </span>
                  {item.evidence_files.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.evidence_files.slice(0, 3).map((f) => (
                        <FileRef key={f} path={f} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionAnchor>
  );
}

function ArchitectureSection({ data }: { data: IntelligenceReportResponse }) {
  return (
    <SectionAnchor
      id="architecture"
      title="Architecture Overview"
      icon={Layers}
      delay={0.2}
    >
      <p
        style={{
          fontSize: 14,
          color: "var(--rs-text-secondary)",
          lineHeight: 1.75,
          marginBottom: 20,
        }}
      >
        {data.architecture_overview}
      </p>
      {data.architecture_layers.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.architecture_layers.map((layer) => (
            <div
              key={layer.name}
              className="rounded-xl p-4"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-border)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Layers size={14} style={{ color: "var(--rs-accent)" }} />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--rs-text-primary)",
                  }}
                >
                  {layer.name}
                </span>
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--rs-text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                {layer.description}
              </p>
              {layer.key_files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {layer.key_files.slice(0, 5).map((f) => (
                    <FileRef key={f} path={f} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionAnchor>
  );
}

function FlowSection({ data }: { data: IntelligenceReportResponse }) {
  return (
    <SectionAnchor id="flow" title="Application Flow" icon={Route} delay={0.25}>
      {data.app_flow_notes && (
        <div
          className="rounded-xl px-4 py-3 mb-5 flex items-start gap-2"
          style={{
            background: "var(--rs-amber-dim)",
            border: "1px solid rgba(245,160,81,0.2)",
          }}
        >
          <AlertTriangle
            size={14}
            style={{ color: "var(--rs-amber)", marginTop: 2, flexShrink: 0 }}
          />
          <p
            style={{ fontSize: 13, color: "var(--rs-amber)", lineHeight: 1.6 }}
          >
            {data.app_flow_notes}
          </p>
        </div>
      )}
      {data.app_flow.length > 0 ? (
        <div className="relative">
          {/* timeline line */}
          <div
            className="absolute"
            style={{
              left: 15,
              top: 6,
              bottom: 6,
              width: 2,
              background: "var(--rs-border-strong)",
              borderRadius: 1,
            }}
          />
          <div className="flex flex-col gap-4">
            {data.app_flow.map((step) => (
              <div key={step.step} className="flex gap-4 relative">
                {/* dot */}
                <div
                  className="shrink-0 rounded-full z-10"
                  style={{
                    width: 32,
                    height: 32,
                    background: "var(--rs-surface-2)",
                    border: "2px solid var(--rs-accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--rs-accent)",
                  }}
                >
                  {step.step}
                </div>
                <div
                  className="flex-1 rounded-xl p-4"
                  style={{
                    background: "var(--rs-surface-1)",
                    border: "1px solid var(--rs-border)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--rs-text-primary)",
                        lineHeight: 1.5,
                      }}
                    >
                      {step.description}
                    </span>
                    <ConfidenceBadge confidence={step.confidence} />
                  </div>
                  {step.evidence_files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {step.evidence_files.map((f) => (
                        <FileRef key={f} path={f} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
          Insufficient evidence to determine application flow.
        </p>
      )}
    </SectionAnchor>
  );
}

function QualitySection({ data }: { data: IntelligenceReportResponse }) {
  if (!data.quality_assessment.length) return null;
  return (
    <SectionAnchor
      id="quality"
      title="Code Quality Assessment"
      icon={CheckCircle2}
      delay={0.3}
    >
      <div className="flex flex-col gap-3">
        {data.quality_assessment.map((q) => (
          <div
            key={q.area}
            className="rounded-xl p-4"
            style={{
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-border)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                }}
              >
                {q.area}
              </span>
              <AssessmentBadge assessment={q.assessment} />
            </div>
            <p
              style={{
                fontSize: 13,
                color: "var(--rs-text-secondary)",
                lineHeight: 1.6,
              }}
            >
              {q.detail}
            </p>
            {q.evidence_files.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {q.evidence_files.map((f) => (
                  <FileRef key={f} path={f} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionAnchor>
  );
}

function QualityReportSection({ data }: { data: IntelligenceReportResponse }) {
  const qr = data.quality_report;
  if (!qr) return null;
  const hasContent =
    (qr.metrics?.length ?? 0) > 0 ||
    (qr.file_risks?.length ?? 0) > 0 ||
    (qr.anti_patterns?.length ?? 0) > 0;
  if (!hasContent) return null;

  const riskTint = (label: string) => {
    switch (label) {
      case "critical":
        return {
          fg: "#ef4444",
          bg: "rgba(239,68,68,0.12)",
          bd: "rgba(239,68,68,0.3)",
        };
      case "high":
        return {
          fg: "#f97316",
          bg: "rgba(249,115,22,0.12)",
          bd: "rgba(249,115,22,0.3)",
        };
      case "moderate":
        return {
          fg: "#eab308",
          bg: "rgba(234,179,8,0.12)",
          bd: "rgba(234,179,8,0.3)",
        };
      default:
        return {
          fg: "#22c55e",
          bg: "rgba(34,197,94,0.12)",
          bd: "rgba(34,197,94,0.3)",
        };
    }
  };
  const severityTint = (sev: string) =>
    sev === "high"
      ? { fg: "#ef4444", bg: "rgba(239,68,68,0.12)" }
      : sev === "medium"
        ? { fg: "#f97316", bg: "rgba(249,115,22,0.12)" }
        : { fg: "#eab308", bg: "rgba(234,179,8,0.12)" };
  const metricTint = (label: string) =>
    label === "excellent"
      ? "#22c55e"
      : label === "good"
        ? "#3b82f6"
        : label === "fair"
          ? "#eab308"
          : "#ef4444";

  return (
    <SectionAnchor
      id="quality-report"
      title="Quality & Risk Report"
      icon={Gauge}
      delay={0.32}
    >
      <div
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--rs-surface-1)",
          border: "1px solid var(--rs-border)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              style={{
                fontSize: 11,
                color: "var(--rs-text-muted)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Overall quality
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: metricTint(qr.overall_label),
                lineHeight: 1.1,
                marginTop: 4,
              }}
            >
              {qr.overall_score.toFixed(1)}
              <span
                style={{
                  fontSize: 14,
                  color: "var(--rs-text-muted)",
                  marginLeft: 6,
                }}
              >
                / 10
              </span>
            </div>
          </div>
          <span
            className="rounded-md px-2 py-1"
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              color: metricTint(qr.overall_label),
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--rs-border)",
            }}
          >
            {qr.overall_label}
          </span>
        </div>
      </div>

      {qr.metrics && qr.metrics.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {qr.metrics.map((m) => (
            <div
              key={m.name}
              className="rounded-xl p-4"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-border)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--rs-text-primary)",
                  }}
                >
                  {m.name}
                </span>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: metricTint(m.label),
                  }}
                >
                  {m.score.toFixed(1)}
                </span>
              </div>
              {m.reasons.length > 0 && (
                <ul
                  className="flex flex-col gap-1"
                  style={{ listStyle: "disc", paddingLeft: 18 }}
                >
                  {m.reasons.map((r, i) => (
                    <li
                      key={i}
                      style={{
                        fontSize: 12,
                        color: "var(--rs-text-secondary)",
                        lineHeight: 1.55,
                      }}
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              {m.evidence_files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {m.evidence_files.slice(0, 6).map((f) => (
                    <FileRef key={f} path={f} />
                  ))}
                </div>
              )}
              {m.caveats.length > 0 && (
                <div
                  className="mt-3 rounded-md px-2 py-1.5"
                  style={{
                    fontSize: 11,
                    color: "var(--rs-text-muted)",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--rs-border)",
                    fontStyle: "italic",
                  }}
                >
                  Caveat: {m.caveats.join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {qr.anti_patterns && qr.anti_patterns.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginBottom: 4,
            }}
          >
            Detected anti-patterns
          </div>
          {qr.anti_patterns.map((ap, idx) => {
            const t = severityTint(ap.severity);
            return (
              <div
                key={idx}
                className="rounded-xl p-4"
                style={{
                  background: "var(--rs-surface-1)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--rs-text-primary)",
                    }}
                  >
                    {ap.title}
                  </span>
                  <span
                    className="rounded px-2 py-0.5"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: t.fg,
                      background: t.bg,
                    }}
                  >
                    {ap.severity}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 12.5,
                    color: "var(--rs-text-secondary)",
                    lineHeight: 1.55,
                  }}
                >
                  {ap.description}
                </p>
                {ap.recommendation && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--rs-text-muted)",
                      marginTop: 6,
                    }}
                  >
                    → {ap.recommendation}
                  </p>
                )}
                {ap.affected_files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {ap.affected_files.map((f) => (
                      <FileRef key={f} path={f} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {qr.file_risks && qr.file_risks.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginBottom: 4,
            }}
          >
            Highest-risk files
          </div>
          {qr.file_risks.slice(0, 10).map((fr) => {
            const t = riskTint(fr.risk_label);
            return (
              <div
                key={fr.path}
                className="rounded-lg p-3 flex items-center justify-between gap-3"
                style={{
                  background: "var(--rs-surface-1)",
                  border: `1px solid ${t.bd}`,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        fontSize: 13,
                        fontFamily: "monospace",
                        color: "var(--rs-text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={fr.path}
                    >
                      {fr.path}
                    </span>
                    {fr.is_entry_point && (
                      <span
                        className="rounded px-1.5 py-0.5"
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          color: "var(--rs-accent)",
                          background: "rgba(124,108,245,0.1)",
                        }}
                      >
                        entry
                      </span>
                    )}
                  </div>
                  {fr.reasons.length > 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--rs-text-muted)",
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {fr.reasons.join(" · ")}
                    </div>
                  )}
                </div>
                <span
                  className="rounded px-2 py-1"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: t.fg,
                    background: t.bg,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fr.risk_label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {(qr.refactor_priorities.length > 0 || qr.quick_wins.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {qr.refactor_priorities.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-border)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                  marginBottom: 8,
                }}
              >
                Refactor priorities
              </div>
              <ul
                className="flex flex-col gap-1.5"
                style={{ listStyle: "decimal", paddingLeft: 18 }}
              >
                {qr.refactor_priorities.map((p, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12.5,
                      color: "var(--rs-text-secondary)",
                      lineHeight: 1.55,
                    }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {qr.quick_wins.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-border)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                  marginBottom: 8,
                }}
              >
                Quick wins
              </div>
              <ul
                className="flex flex-col gap-1.5"
                style={{ listStyle: "disc", paddingLeft: 18 }}
              >
                {qr.quick_wins.map((w, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12.5,
                      color: "var(--rs-text-secondary)",
                      lineHeight: 1.55,
                    }}
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionAnchor>
  );
}

function ComplexitySection({ data }: { data: IntelligenceReportResponse }) {
  return (
    <SectionAnchor
      id="complexity"
      title="Complexity & Hotspots"
      icon={BarChart3}
      delay={0.35}
    >
      {data.complexity_overview && (
        <p
          style={{
            fontSize: 14,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.75,
            marginBottom: 16,
          }}
        >
          {data.complexity_overview}
        </p>
      )}
      {data.complexity_hotspots.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--rs-border)" }}
        >
          {/* header */}
          <div
            className="grid px-5 py-3"
            style={{
              gridTemplateColumns: "3fr 1fr 1fr 1fr",
              background: "var(--rs-surface-2)",
              borderBottom: "1px solid var(--rs-border)",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--rs-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
            }}
          >
            <span>File</span>
            <span>Fan In</span>
            <span>Fan Out</span>
            <span>Risk</span>
          </div>
          {data.complexity_hotspots.slice(0, 15).map((h, i) => (
            <div
              key={h.path}
              className="grid px-5 py-3 items-center"
              style={{
                gridTemplateColumns: "3fr 1fr 1fr 1fr",
                borderBottom:
                  i < Math.min(data.complexity_hotspots.length, 15) - 1
                    ? "1px solid var(--rs-border)"
                    : "none",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  color: "var(--rs-text-primary)",
                  fontSize: 12,
                }}
              >
                {h.path}
              </span>
              <span
                style={{
                  color:
                    h.fan_in >= 6
                      ? "var(--rs-amber)"
                      : "var(--rs-text-secondary)",
                }}
              >
                {h.fan_in}
              </span>
              <span
                style={{
                  color:
                    h.fan_out >= 10
                      ? "var(--rs-red)"
                      : "var(--rs-text-secondary)",
                }}
              >
                {h.fan_out}
              </span>
              <span
                style={{
                  fontWeight: 600,
                  color:
                    h.risk_score > 0.6
                      ? "var(--rs-red)"
                      : h.risk_score > 0.3
                        ? "var(--rs-amber)"
                        : "var(--rs-text-secondary)",
                }}
              >
                {(h.risk_score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
      {data.optimization_notes && (
        <div
          className="rounded-xl p-4 mt-5"
          style={{
            background: "var(--rs-surface-1)",
            border: "1px solid var(--rs-border)",
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginBottom: 8,
            }}
          >
            Optimization Notes
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--rs-text-secondary)",
              lineHeight: 1.7,
            }}
          >
            {data.optimization_notes}
          </p>
        </div>
      )}
    </SectionAnchor>
  );
}

function CritiqueSection({ data }: { data: IntelligenceReportResponse }) {
  if (!data.critique.length) return null;

  const strengths = data.critique.filter((c) => c.kind === "strength");
  const issues = data.critique.filter((c) => c.kind !== "strength");

  return (
    <SectionAnchor
      id="critique"
      title="Senior-Level Critique"
      icon={Eye}
      delay={0.4}
    >
      <p
        style={{
          fontSize: 13,
          color: "var(--rs-text-muted)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        An honest, evidence-based assessment of the repository's strengths and
        weaknesses.
      </p>

      {strengths.length > 0 && (
        <div className="mb-6">
          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--rs-green)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            Strengths
          </h3>
          <div className="flex flex-col gap-2">
            {strengths.map((c, i) => (
              <div
                key={i}
                className="rounded-xl p-4"
                style={{
                  background: "var(--rs-surface-1)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <KindBadge kind={c.kind} />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--rs-text-primary)",
                    }}
                  >
                    {c.title}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--rs-text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {c.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--rs-amber)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            Weaknesses, Risks & Code Smells
          </h3>
          <div className="flex flex-col gap-2">
            {issues.map((c, i) => (
              <div
                key={i}
                className="rounded-xl p-4"
                style={{
                  background: "var(--rs-surface-1)",
                  border: `1px solid ${
                    c.severity === "high"
                      ? "rgba(242,83,83,0.2)"
                      : "var(--rs-border)"
                  }`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <KindBadge kind={c.kind} />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--rs-text-primary)",
                    }}
                  >
                    {c.title}
                  </span>
                  {c.severity === "high" && (
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        background: "var(--rs-red-dim)",
                        color: "var(--rs-red)",
                      }}
                    >
                      High Severity
                    </span>
                  )}
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--rs-text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {c.detail}
                </p>
                {c.evidence_files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {c.evidence_files.slice(0, 5).map((f) => (
                      <FileRef key={f} path={f} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionAnchor>
  );
}

function ImprovementsSection({ data }: { data: IntelligenceReportResponse }) {
  if (!data.improvements.length) return null;

  const byEffort: Record<string, ImprovementItem[]> = {
    "quick-win": [],
    medium: [],
    architectural: [],
  };
  for (const item of data.improvements) {
    (byEffort[item.effort] ??= []).push(item);
  }

  const effortLabels: Record<string, string> = {
    "quick-win": "Quick Wins",
    medium: "Medium Effort",
    architectural: "Architectural Changes",
  };

  return (
    <SectionAnchor
      id="improvements"
      title="Improvement Recommendations"
      icon={Wrench}
      delay={0.45}
    >
      <div className="flex flex-col gap-6">
        {Object.entries(byEffort).map(
          ([effort, items]) =>
            items.length > 0 && (
              <div key={effort}>
                <h3
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--rs-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 10,
                  }}
                >
                  {effortLabels[effort] ?? effort}
                </h3>
                <div className="flex flex-col gap-2">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="rounded-xl p-4"
                      style={{
                        background: "var(--rs-surface-1)",
                        border: "1px solid var(--rs-border)",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <EffortBadge effort={item.effort} />
                        <span
                          className="rounded-full px-2 py-0.5"
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            background: "var(--rs-surface-3)",
                            color: "var(--rs-text-muted)",
                          }}
                        >
                          {item.category}
                        </span>
                      </div>
                      <h4
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--rs-text-primary)",
                          marginBottom: 4,
                        }}
                      >
                        {item.title}
                      </h4>
                      <p
                        style={{
                          fontSize: 13,
                          color: "var(--rs-text-secondary)",
                          lineHeight: 1.6,
                        }}
                      >
                        {item.detail}
                      </p>
                      {item.evidence_files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {item.evidence_files.slice(0, 3).map((f) => (
                            <FileRef key={f} path={f} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ),
        )}
      </div>
    </SectionAnchor>
  );
}

function ConfidenceSection({ data }: { data: IntelligenceReportResponse }) {
  if (!data.confidence_notes.length) return null;
  return (
    <SectionAnchor
      id="confidence"
      title="Confidence & Evidence Notes"
      icon={Shield}
      delay={0.5}
    >
      <div className="flex flex-col gap-2">
        {data.confidence_notes.map((n, i) => (
          <div
            key={i}
            className="rounded-xl p-4 flex items-start gap-3"
            style={{
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-border)",
            }}
          >
            <ConfidenceBadge confidence={n.confidence} />
            <div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                }}
              >
                {n.claim}
              </span>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--rs-text-muted)",
                  lineHeight: 1.5,
                  marginTop: 4,
                }}
              >
                {n.basis}
              </p>
            </div>
          </div>
        ))}
      </div>
    </SectionAnchor>
  );
}

/* ── Main Page ── */

export function IntelligenceReport() {
  const { activeAnalysisId, activeRepoId, user } = useAppStore();
  const [data, setData] = useState<IntelligenceReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("summary");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAnalysisId) return;
    setLoading(true);
    setError(null);
    getIntelligenceReport(activeAnalysisId)
      .then(setData)
      .catch((err) => setError(err.message ?? "Failed to generate report"))
      .finally(() => setLoading(false));
  }, [activeAnalysisId]);

  // Scroll-spy for section nav
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { root: el, rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    const sections = el.querySelectorAll("section[id]");
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [data]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Loader2
            size={32}
            className="animate-spin"
            style={{ color: "var(--rs-accent)" }}
          />
          <span style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
            Generating Intelligence Report...
          </span>
          <span style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>
            Gathering evidence and computing heuristics
          </span>
        </div>
      </div>
    );
  }

  if (!activeAnalysisId || !activeRepoId) {
    return (
      <div
        className="flex-1 flex items-center justify-center h-full"
        style={{ padding: 48 }}
      >
        <div style={{ maxWidth: 420, width: "100%" }}>
          <AnalyzePlaceholder
            title="No repository selected"
            detail="Analyze a repository to see further details."
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div
          className="rounded-xl p-6 flex flex-col items-center gap-3 max-w-md"
          style={{
            background: "var(--rs-red-dim)",
            border: "1px solid rgba(242,83,83,0.2)",
          }}
        >
          <AlertTriangle size={28} style={{ color: "var(--rs-red)" }} />
          <span
            style={{ fontSize: 14, color: "var(--rs-red)", fontWeight: 500 }}
          >
            Failed to generate report
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--rs-text-muted)",
              textAlign: "center",
            }}
          >
            {error}
          </span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Section navigation sidebar */}
      <nav
        className="shrink-0 flex flex-col py-5 overflow-y-auto"
        style={{
          width: 200,
          borderRight: "1px solid var(--rs-border)",
          background: "var(--rs-sidebar)",
        }}
      >
        <div className="px-4 mb-4">
          <h3
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--rs-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Report Sections
          </h3>
        </div>
        {SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const active = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => {
                const el = document.getElementById(sec.id);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="flex items-center gap-2.5 px-4 py-2 text-left transition-colors"
              style={{
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--rs-accent)" : "var(--rs-text-secondary)",
                background: active ? "var(--rs-accent-dim)" : "transparent",
                borderRight: active
                  ? "2px solid var(--rs-accent)"
                  : "2px solid transparent",
              }}
            >
              <Icon size={14} />
              {sec.label}
            </button>
          );
        })}
      </nav>

      {/* Main content */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto px-8 py-6"
        style={{ maxWidth: 860 }}
      >
        {/* Page header */}
        <FadeIn>
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <Brain size={14} style={{ color: "var(--rs-accent)" }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--rs-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Intelligence Report
              </span>
            </div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: "var(--rs-text-primary)",
                letterSpacing: "-0.04em",
                marginBottom: 4,
              }}
            >
              {data.repo_name ?? "Repository"} Audit
            </h1>
            <p style={{ fontSize: 13, color: "var(--rs-text-muted)" }}>
              Evidence-based repository analysis
              {data.detected_framework && ` · ${data.detected_framework}`}
              {data.detected_language && ` · ${data.detected_language}`}
            </p>
          </div>
        </FadeIn>

        <SummarySection data={data} />
        <ScoresSection data={data} />
        <StackSection data={data} />
        <ArchitectureSection data={data} />
        <FlowSection data={data} />
        <QualitySection data={data} />
        <QualityReportSection data={data} />
        <ComplexitySection data={data} />
        <CritiqueSection data={data} />
        <ImprovementsSection data={data} />
        <ConfidenceSection data={data} />
      </div>
    </div>
  );
}
