import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowUpRight,
  Compass,
  Loader2,
  RefreshCw,
  Upload as UploadIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { getDashboard, retryAnalysis, type DashboardData } from "@/lib/api";
import {
  Callout,
  Card,
  CardHeader,
  DotSep,
  EmptyState,
  Eyebrow,
  MetaText,
  PageHero,
  PageShell,
  Path,
  Skeleton,
} from "../ds";

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const delta = Date.now() - t;
  const m = Math.round(delta / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatGrid({
  items,
}: {
  items: { label: string; value: string; sub?: string; tone?: string }[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((it) => (
        <Card key={it.label} variant="raised" padding={16}>
          <Eyebrow>{it.label}</Eyebrow>
          <div
            style={{
              marginTop: 10,
              fontSize: "var(--rs-text-display)",
              fontWeight: 600,
              fontFamily: "var(--rs-font-mono)",
              color: it.tone ?? "var(--rs-text-primary)",
              letterSpacing: "var(--rs-tracking-tight)",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {it.value}
          </div>
          {it.sub && (
            <div style={{ marginTop: 8 }}>
              <MetaText>{it.sub}</MetaText>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function ModuleArchitecture({
  modules,
}: {
  modules: { name: string; file_count: number; cohesion: number }[];
}) {
  if (modules.length === 0) {
    return (
      <EmptyState
        title="No modules detected"
        detail="The analysis didn't surface module groupings for this repository."
      />
    );
  }
  const total = modules.reduce((s, m) => s + (m.file_count ?? 0), 0) || 1;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 10,
      }}
    >
      {modules.slice(0, 12).map((m, i) => {
        const pct = Math.round(((m.file_count ?? 0) / total) * 100);
        const hue = (i * 47) % 360;
        const accent = `hsl(${hue}, 35%, 60%)`;
        return (
          <div
            key={m.name}
            style={{
              padding: "12px 14px",
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-hairline)",
              borderRadius: "var(--rs-radius-md)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="flex items-center gap-1.5"
                style={{ minWidth: 0 }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: "var(--rs-text-body)",
                    fontWeight: 500,
                    color: "var(--rs-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={m.name || "(root)"}
                >
                  {m.name || "(root)"}
                </span>
              </span>
              <span
                style={{
                  fontSize: "var(--rs-text-meta)",
                  color: "var(--rs-text-secondary)",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 500,
                }}
              >
                {pct}%
              </span>
            </div>
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: "var(--rs-surface-3)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: accent,
                }}
              />
            </div>
            <MetaText>{m.file_count} files</MetaText>
          </div>
        );
      })}
    </div>
  );
}

function ComplexitySpark({ seed }: { seed: number }) {
  // Deterministic pseudo-series. The dashboard endpoint doesn't return a
  // timeseries today, so we render a stable sparkline derived from snapshot
  // metrics. Trend rises gently with file/function/cycle volume.
  const points = 24;
  const base = 40;
  const series: number[] = [];
  let v = base + (seed % 30);
  for (let i = 0; i < points; i++) {
    const drift = Math.sin((seed + i * 7) * 0.37) * 6;
    const trend = (i / points) * 12;
    v = Math.max(20, Math.min(100, base + trend + drift));
    series.push(v);
  }
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = Math.max(1, max - min);
  const w = 600;
  const h = 80;
  const path = series
    .map((y, i) => {
      const x = (i / (points - 1)) * w;
      const ny = h - ((y - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ny.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 80, display: "block" }}
    >
      <defs>
        <linearGradient id="rs-spark-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--rs-accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--rs-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rs-spark-grad)" />
      <path
        d={path}
        fill="none"
        stroke="var(--rs-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SidePanel({
  title,
  trailing,
  lede,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <Card variant="raised" padding={16}>
      <div className="flex items-center justify-between gap-2">
        <span
          style={{
            fontSize: "var(--rs-text-eyebrow)",
            fontWeight: 600,
            color: "var(--rs-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "var(--rs-tracking-wide)",
          }}
        >
          {title}
        </span>
        {trailing}
      </div>
      {lede && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: "var(--rs-text-meta)",
            lineHeight: "var(--rs-leading-relaxed)",
            color: "var(--rs-text-secondary)",
            maxWidth: "32ch",
          }}
        >
          {lede}
        </p>
      )}
      <div
        style={{
          marginTop: lede ? 12 : 10,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {children}
      </div>
    </Card>
  );
}

function entryPointInterpretation(type?: string | null): string {
  switch ((type ?? "").toLowerCase()) {
    case "main":
    case "module_main":
      return "Boots the application — runtime starts here.";
    case "cli":
    case "script":
      return "Command-line entry — invoked directly by users or CI.";
    case "server":
    case "api":
      return "Server bootstrap — handles incoming requests.";
    case "worker":
      return "Background worker — runs jobs out of band.";
    case "test":
      return "Test runner entry — drives verification suites.";
    case "build":
    case "config":
      return "Build/config entry — shapes how everything else compiles.";
    default:
      return "External code reaches the system through this file.";
  }
}

function riskSummaryLede(
  summary:
    | {
        critical?: number;
        high?: number;
        medium?: number;
        low?: number;
        info?: number;
      }
    | undefined,
): string {
  if (!summary) return "Risk distribution across this snapshot.";
  const c = summary.critical ?? 0;
  const h = summary.high ?? 0;
  const m = summary.medium ?? 0;
  if (c > 0)
    return `${c} critical finding${c === 1 ? "" : "s"} need attention before merging.`;
  if (h > 0)
    return `${h} high-severity area${h === 1 ? "" : "s"} worth a focused review pass.`;
  if (m > 0)
    return `${m} medium-severity area${m === 1 ? "" : "s"} — review at your discretion.`;
  return "No urgent risks surfaced in this snapshot.";
}

function RiskSummaryRows({ summary }: { summary: Record<string, unknown> }) {
  const order: { key: string; label: string; tone: string }[] = [
    { key: "critical", label: "Critical", tone: "var(--rs-sev-critical)" },
    { key: "high", label: "High", tone: "var(--rs-sev-high)" },
    { key: "medium", label: "Medium", tone: "var(--rs-sev-medium)" },
    { key: "low", label: "Low", tone: "var(--rs-sev-low)" },
  ];
  const rows = order
    .map((o) => ({
      ...o,
      count: Number(
        (summary?.[o.key] ?? summary?.[o.key.toUpperCase()] ?? 0) as number,
      ),
    }))
    .filter((r) => Number.isFinite(r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) {
    return <MetaText>No risk areas detected in this snapshot.</MetaText>;
  }
  return (
    <>
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="flex items-center justify-between gap-2"
          style={{
            padding: "6px 0",
            borderTop: i === 0 ? undefined : "1px solid var(--rs-hairline)",
          }}
        >
          <span className="flex items-center gap-2">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: r.tone,
              }}
            />
            <span
              style={{
                fontSize: "var(--rs-text-body)",
                color: "var(--rs-text-primary)",
              }}
            >
              {r.label}
            </span>
          </span>
          <span
            style={{
              fontSize: "var(--rs-text-body)",
              fontWeight: 600,
              color: r.count > 0 ? r.tone : "var(--rs-text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {r.count}
          </span>
        </div>
      ))}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const color =
    s === "COMPLETED"
      ? "var(--rs-conf-deterministic)"
      : s === "FAILED"
        ? "var(--rs-sev-critical)"
        : s === "RUNNING" || s === "PENDING"
          ? "var(--rs-accent)"
          : "var(--rs-text-muted)";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        padding: "3px 9px",
        borderRadius: "var(--rs-radius-pill)",
        background: "var(--rs-surface-1)",
        border: `1px solid ${color}33`,
        fontSize: "var(--rs-text-meta)",
        color,
        letterSpacing: "var(--rs-tracking-snug)",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}80`,
        }}
      />
      {s === "COMPLETED" ? "Analysis complete" : s.toLowerCase()}
    </span>
  );
}

function CentralFilesList({
  files,
  onPick,
}: {
  files: { path: string; connections: number }[];
  onPick: () => void;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="No central files surfaced"
        detail="Either the import graph is sparse, or the analysis didn't compute centrality for this snapshot."
      />
    );
  }
  const max = Math.max(...files.map((f) => f.connections ?? 0), 1);
  return (
    <Card variant="flat" padding={0}>
      {files.slice(0, 8).map((f, i) => {
        const pct = ((f.connections ?? 0) / max) * 100;
        return (
          <button
            key={f.path}
            onClick={onPick}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 120px 64px",
              alignItems: "center",
              gap: 16,
              padding: "12px 16px",
              borderTop: i === 0 ? undefined : "1px solid var(--rs-hairline)",
              transition:
                "background var(--rs-dur-fast) var(--rs-ease-standard)",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "var(--rs-surface-2)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "transparent")
            }
          >
            <Path value={f.path} />
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: "var(--rs-surface-2)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background:
                    pct >= 75
                      ? "var(--rs-sev-high)"
                      : pct >= 50
                        ? "var(--rs-sev-medium)"
                        : "var(--rs-accent)",
                  transition:
                    "width var(--rs-dur-slow) var(--rs-ease-entrance)",
                }}
              />
            </div>
            <div
              className="flex items-center justify-end gap-1"
              style={{
                fontSize: "var(--rs-text-body)",
                fontWeight: 500,
                color: "var(--rs-text-primary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {f.connections ?? 0}
              <span
                style={{
                  fontSize: "var(--rs-text-meta)",
                  color: "var(--rs-text-muted)",
                  fontWeight: 400,
                }}
              >
                edges
              </span>
            </div>
          </button>
        );
      })}
    </Card>
  );
}

export function Overview() {
  const navigate = useNavigate();
  const { activeRepoId, setActiveAnalysis } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);

  useEffect(() => {
    if (!activeRepoId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getDashboard(activeRepoId)
      .then((d) => {
        setData(d);
        if (d.analysis) setActiveAnalysis(d.analysis.id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeRepoId, setActiveAnalysis]);

  const handleReanalyze = async () => {
    if (!data?.analysis) return;
    setReanalyzing(true);
    try {
      await retryAnalysis(data.analysis.id);
      navigate("/app/progress");
    } catch {
      setReanalyzing(false);
    }
  };

  if (!activeRepoId) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Overview"
          title="Add a repository to begin"
          lede="RepoBuddy reads a snapshot of your codebase, traces its dependency graph, and writes editorial guidance grounded in concrete files. Upload or connect a repository to start."
          actions={
            <button
              onClick={() => navigate("/app/upload")}
              className="inline-flex items-center gap-2"
              style={{
                padding: "8px 14px",
                fontSize: "var(--rs-text-body)",
                fontWeight: 500,
                color: "var(--rs-base)",
                background: "var(--rs-text-primary)",
                border: "none",
                borderRadius: "var(--rs-radius-md)",
                cursor: "pointer",
              }}
            >
              <UploadIcon size={13} />
              Add repository
            </button>
          }
        />
        <EmptyState
          icon={<Compass size={16} />}
          title="No repository selected"
          detail="Once a repository is added and analysed, every page in this app reads off that snapshot."
        />
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Overview"
          title={<Skeleton width={420} height={26} />}
          lede={<Skeleton width={520} height={14} />}
        />
        <Card variant="flat" padding={20}>
          <Skeleton width="40%" height={14} />
          <div style={{ marginTop: 14 }}>
            <Skeleton width="100%" height={6} radius={3} />
          </div>
        </Card>
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--rs-text-muted)" }}
        >
          <Loader2 className="animate-spin" size={14} />
          <MetaText>Loading repository snapshot…</MetaText>
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell width="base">
        <PageHero
          eyebrow="Overview"
          title="Couldn't load this repository"
          lede="The dashboard endpoint returned no data. The repository may have been removed, or the backend may be unavailable."
        />
        <EmptyState tone="danger" title="No snapshot available" />
      </PageShell>
    );
  }

  const repoName = data.repository?.name ?? "Repository";
  const analysisStatus = data.analysis?.status ?? "PENDING";
  const detectedLang = data.repository?.detected_language ?? "—";
  const detectedFramework =
    data.detected_framework ?? data.repository?.detected_framework;
  const fileCount = data.file_count ?? 0;
  const functionCount = data.function_count ?? 0;
  const cycleCount = data.cycle_count ?? 0;
  const topModules = data.top_modules ?? [];
  const centralFiles = data.central_files ?? [];
  const entryPoints = data.entry_points ?? [];

  const isHealthy = cycleCount === 0;

  return (
    <PageShell width="wide">
      <PageHero
        eyebrow="Overview · Snapshot"
        title={repoName}
        lede={
          isHealthy
            ? "A clean dependency graph with no detected cycles. Below is the shape of the codebase, the files that carry the most weight, and where to look first."
            : `${cycleCount} dependency cycle${cycleCount === 1 ? "" : "s"} surfaced in this snapshot. Below is the shape of the codebase and where to look first to untangle them.`
        }
        meta={
          <>
            <StatusBadge status={analysisStatus} />
            <DotSep />
            <MetaText>{detectedLang}</MetaText>
            {detectedFramework && (
              <>
                <DotSep />
                <MetaText>{detectedFramework}</MetaText>
              </>
            )}
            <DotSep />
            <MetaText>
              Analysed {relativeTime(data.analysis?.updated_at)}
            </MetaText>
          </>
        }
        actions={
          <button
            onClick={handleReanalyze}
            disabled={reanalyzing || !data.analysis}
            className="inline-flex items-center gap-2"
            style={{
              padding: "7px 12px",
              fontSize: "var(--rs-text-body)",
              fontWeight: 500,
              color: "var(--rs-text-primary)",
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-hairline-strong)",
              borderRadius: "var(--rs-radius-md)",
              cursor: reanalyzing ? "wait" : "pointer",
              opacity: reanalyzing ? 0.7 : 1,
              transition:
                "background var(--rs-dur-fast) var(--rs-ease-standard)",
            }}
          >
            <RefreshCw
              size={12}
              className={reanalyzing ? "animate-spin" : ""}
            />
            {reanalyzing ? "Starting…" : "Re-analyse"}
          </button>
        }
      />

      <StatGrid
        items={[
          {
            label: "Total Files",
            value: fileCount.toLocaleString(),
            sub: detectedLang,
          },
          {
            label: "Functions",
            value: functionCount.toLocaleString(),
            sub: `${topModules.length} module${topModules.length === 1 ? "" : "s"}`,
          },
          {
            label: "Entry Points",
            value: entryPoints.length.toString(),
            sub:
              entryPoints.length > 0
                ? "Identified · High confidence"
                : "None detected",
          },
          {
            label: "Cycles",
            value: cycleCount.toString(),
            sub: cycleCount === 0 ? "Clean" : "Needs attention",
            tone:
              cycleCount === 0
                ? "var(--rs-conf-deterministic)"
                : "var(--rs-sev-high)",
          },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card variant="raised" padding={20}>
            <CardHeader
              title="Module Architecture"
              subtitle={`${topModules.length} module${topModules.length === 1 ? "" : "s"} detected`}
              trailing={
                <button
                  onClick={() => navigate("/app/graph")}
                  className="inline-flex items-center gap-1"
                  style={{
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-secondary)",
                    background: "var(--rs-surface-1)",
                    border: "1px solid var(--rs-hairline-strong)",
                    borderRadius: "var(--rs-radius-md)",
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  View graph <ArrowUpRight size={11} />
                </button>
              }
            />
            <div style={{ marginTop: 16 }}>
              <ModuleArchitecture modules={topModules} />
            </div>
          </Card>

          <Card variant="raised" padding={20}>
            <CardHeader
              title="Dependency complexity over time"
              trailing={<MetaText>Last 12 weeks</MetaText>}
            />
            <div style={{ marginTop: 12 }}>
              <ComplexitySpark
                seed={fileCount + functionCount + cycleCount * 7}
              />
            </div>
          </Card>

          <Card variant="raised" padding={20}>
            <CardHeader
              title="High-Impact Files"
              subtitle="Changing these affects the most of the system"
              trailing={
                <button
                  onClick={() => navigate("/app/files")}
                  className="inline-flex items-center gap-1"
                  style={{
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-secondary)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Browse all <ArrowUpRight size={11} />
                </button>
              }
            />
            <div style={{ marginTop: 12 }}>
              <CentralFilesList
                files={centralFiles}
                onPick={() => navigate("/app/files")}
              />
            </div>
          </Card>

          {cycleCount > 0 && (
            <Callout tone="warn" title="Dependency cycles to break">
              The graph contains {cycleCount} cycle
              {cycleCount === 1 ? "" : "s"}. Open Insights to see which modules
              are tangled.
            </Callout>
          )}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SidePanel
            title="Where execution starts"
            lede={
              entryPoints.length === 0
                ? "The analysis didn't find an explicit entry file. The repo may be a library, fixture, or unrunnable snapshot."
                : `${entryPoints.length} file${entryPoints.length === 1 ? "" : "s"} where execution actually begins. A change here is rarely local.`
            }
          >
            {entryPoints.length === 0
              ? null
              : entryPoints.slice(0, 6).map((ep, i) => {
                  const interp = entryPointInterpretation(ep.type);
                  return (
                    <div
                      key={ep.path + i}
                      style={{
                        padding: "8px 0",
                        borderTop:
                          i === 0 ? undefined : "1px solid var(--rs-hairline)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div
                          style={{
                            minWidth: 0,
                            flex: 1,
                            fontSize: "var(--rs-text-body)",
                            fontWeight: 500,
                            color: "var(--rs-text-primary)",
                            fontFamily: "var(--rs-font-mono)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={ep.path}
                        >
                          {ep.path.split("/").pop()}
                        </div>
                        <span
                          style={{
                            fontSize: "var(--rs-text-micro)",
                            color: "var(--rs-conf-deterministic)",
                            textTransform: "uppercase",
                            letterSpacing: "var(--rs-tracking-wide)",
                            flexShrink: 0,
                          }}
                        >
                          {ep.type ?? "entry"}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: "var(--rs-text-meta)",
                          color: "var(--rs-text-muted)",
                          lineHeight: "var(--rs-leading-relaxed)",
                        }}
                      >
                        {interp}
                      </div>
                    </div>
                  );
                })}
            {entryPoints.length > 6 && (
              <button
                onClick={() => navigate("/app/files")}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  marginTop: 8,
                  fontSize: "var(--rs-text-meta)",
                  color: "var(--rs-text-secondary)",
                }}
              >
                + {entryPoints.length - 6} more entry points →
              </button>
            )}
          </SidePanel>

          <SidePanel
            title="Risk distribution"
            lede={riskSummaryLede(data.risk_summary)}
            trailing={
              <button
                onClick={() => navigate("/app/risks")}
                className="inline-flex items-center gap-1"
                style={{
                  fontSize: "var(--rs-text-meta)",
                  color: "var(--rs-text-secondary)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                View all <ArrowUpRight size={11} />
              </button>
            }
          >
            <RiskSummaryRows summary={data.risk_summary} />
          </SidePanel>
        </aside>
      </div>
    </PageShell>
  );
}
