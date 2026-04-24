import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  FileCode,
  GitBranch,
  Hash,
  Layers,
  Map,
  Zap,
  Play,
  ChevronDown,
  Loader2,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import { getDocumentation, type DocumentationResponse } from "@/lib/api";

interface DocSection {
  id: string;
  title: string;
  icon: any;
}

const DOC_SECTIONS: DocSection[] = [
  { id: "getting-started", title: "Getting Started", icon: Play },
  { id: "architecture", title: "Architecture", icon: Layers },
  { id: "key-modules", title: "Key Modules", icon: Hash },
  { id: "entry-points", title: "Entry Points", icon: Zap },
  { id: "risk-areas", title: "Risk Areas", icon: AlertTriangle },
  { id: "reading-path", title: "Reading Path", icon: Map },
];

/* â”€â”€ Shared UI Components â”€â”€ */

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontSize: 26,
        fontWeight: 700,
        color: "var(--rs-text-primary)",
        letterSpacing: "-0.03em",
        marginBottom: 8,
      }}
    >
      {children}
    </h1>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 18,
        fontWeight: 600,
        color: "var(--rs-text-primary)",
        letterSpacing: "-0.02em",
        marginBottom: 12,
        marginTop: 28,
      }}
    >
      {children}
    </h2>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
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
        {value}
      </div>
      <div
        style={{ fontSize: 11, color: "var(--rs-text-muted)", marginTop: 2 }}
      >
        {label}
      </div>
    </div>
  );
}

function ModuleCard({
  name,
  files,
  cohesion,
  externalDeps,
  color,
}: {
  name: string;
  files: number;
  cohesion: number;
  externalDeps: number;
  color: string;
}) {
  return (
    <div
      className="rounded-xl p-4 flex gap-3 transition-all"
      style={{
        background: "var(--rs-surface-2)",
        border: "1px solid var(--rs-border)",
      }}
    >
      <div
        className="rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ width: 28, height: 28, background: `${color}18` }}
      >
        <div
          className="rounded-full"
          style={{ width: 8, height: 8, background: color }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
            }}
          >
            {name}/
          </span>
          <span style={{ fontSize: 10, color: "var(--rs-text-muted)" }}>
            {files} files
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}>
            Cohesion: {Math.round(cohesion * 100)}%
          </span>
          <span style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>
            {externalDeps} external deps
          </span>
        </div>
      </div>
    </div>
  );
}

const MODULE_COLORS = [
  "#7C6CF5",
  "#5B9CF6",
  "#3DD68C",
  "#F5A051",
  "#F25353",
  "#E879F9",
  "#22D3EE",
  "#A3E635",
  "#FB923C",
  "#818CF8",
];

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
  return String(n);
}

/* â”€â”€ Section Renderers â”€â”€ */

function GettingStartedSection({ data }: { data: DocumentationResponse }) {
  const s = data.stats;
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SectionHeading>
          Onboarding Guide{data.repo_name ? `: ${data.repo_name}` : ""}
        </SectionHeading>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          {data.detected_framework && (
            <>
              This is a{" "}
              <strong
                style={{ color: "var(--rs-text-primary)", fontWeight: 500 }}
              >
                {data.detected_framework}
              </strong>{" "}
              project
              {data.detected_language && (
                <>
                  {" "}
                  written in{" "}
                  <strong
                    style={{ color: "var(--rs-text-primary)", fontWeight: 500 }}
                  >
                    {data.detected_language}
                  </strong>
                </>
              )}
              .{" "}
            </>
          )}
          This documentation was generated by RepoBuddy from a live analysis of
          the codebase.
        </p>
      </div>

      <SubHeading>Quick Stats</SubHeading>
      <div
        className="grid gap-3 my-5"
        style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
      >
        <StatCard label="Files" value={s.total_files} />
        <StatCard label="Total Lines" value={formatNumber(s.total_lines)} />
        <StatCard label="Modules" value={s.modules} />
        <StatCard label="Functions" value={s.total_functions} />
        <StatCard label="Classes" value={s.total_classes} />
        <StatCard label="Circular Deps" value={s.cycle_count} />
      </div>

      <SubHeading>Where to Start</SubHeading>
      {data.entry_points.length > 0 ? (
        <>
          <p
            style={{
              fontSize: 14,
              color: "var(--rs-text-secondary)",
              lineHeight: 1.75,
              marginBottom: 12,
            }}
          >
            Start by reading these entry point files:
          </p>
          <div className="flex flex-col gap-2">
            {data.entry_points.slice(0, 5).map((ep) => (
              <div
                key={ep.path}
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <FileCode
                  size={12}
                  style={{ color: "var(--rs-accent)", flexShrink: 0 }}
                />
                <FileRef path={ep.path} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p
          style={{
            fontSize: 14,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.75,
          }}
        >
          Look at the top-level files in the repository root for entry points.
        </p>
      )}

      {data.central_files.length > 0 && (
        <>
          <SubHeading>Central Files</SubHeading>
          <p
            style={{
              fontSize: 14,
              color: "var(--rs-text-secondary)",
              lineHeight: 1.75,
              marginBottom: 12,
            }}
          >
            These files are the most connected and should be understood early:
          </p>
          <div className="flex flex-col gap-2">
            {data.central_files.slice(0, 5).map((cf) => (
              <div
                key={cf.path}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <GitBranch
                    size={12}
                    style={{ color: "var(--rs-blue)", flexShrink: 0 }}
                  />
                  <FileRef path={cf.path} />
                </div>
                <span style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>
                  {cf.connections} connections
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ArchitectureSection({ data }: { data: DocumentationResponse }) {
  const gm = data.graph_metrics;
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SectionHeading>
          Architecture Overview{data.repo_name ? `: ${data.repo_name}` : ""}
        </SectionHeading>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          Module structure and dependency metrics generated from the actual
          import graph of the codebase.
        </p>
      </div>

      <SubHeading>Module Structure</SubHeading>
      {data.modules.length > 0 ? (
        <div
          className="rounded-xl overflow-hidden my-5"
          style={{ border: "1px solid var(--rs-border)" }}
        >
          {/* Table Header */}
          <div
            className="grid px-5 py-3"
            style={{
              gridTemplateColumns: "2fr 1fr 1fr 1fr",
              background: "var(--rs-surface-2)",
              borderBottom: "1px solid var(--rs-border)",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--rs-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
            }}
          >
            <span>Module</span>
            <span>Files</span>
            <span>Cohesion</span>
            <span>Ext. Deps</span>
          </div>
          {/* Table Rows */}
          {data.modules.slice(0, 15).map((mod, i) => (
            <div
              key={mod.name}
              className="grid px-5 py-3 items-center"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                borderBottom:
                  i < Math.min(data.modules.length, 15) - 1
                    ? "1px solid var(--rs-border)"
                    : "none",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                  fontFamily: "monospace",
                }}
              >
                {mod.name}/
              </span>
              <span style={{ color: "var(--rs-text-secondary)" }}>
                {mod.file_count}
              </span>
              <span
                style={{
                  color:
                    mod.cohesion > 0.5 ? "var(--rs-green)" : "var(--rs-amber)",
                }}
              >
                {Math.round(mod.cohesion * 100)}%
              </span>
              <span style={{ color: "var(--rs-text-muted)" }}>
                {mod.external_edges}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
          No modules detected.
        </p>
      )}

      <SubHeading>Dependency Metrics</SubHeading>
      <div
        className="grid gap-3 my-5"
        style={{ gridTemplateColumns: "repeat(2, 1fr)" }}
      >
        <StatCard label="Graph Density" value={gm.density?.toFixed(4) ?? "0"} />
        <StatCard label="Total Edges" value={gm.total_edges ?? 0} />
        <StatCard
          label="Avg In-Degree"
          value={(gm.avg_in_degree ?? 0).toFixed(2)}
        />
        <StatCard
          label="Avg Out-Degree"
          value={(gm.avg_out_degree ?? 0).toFixed(2)}
        />
      </div>

      {data.most_imported.length > 0 && (
        <>
          <SubHeading>Most Imported Files</SubHeading>
          <p
            style={{
              fontSize: 14,
              color: "var(--rs-text-secondary)",
              lineHeight: 1.75,
              marginBottom: 12,
            }}
          >
            These files are depended on by the most other files:
          </p>
          <div className="flex flex-col gap-2">
            {data.most_imported.slice(0, 10).map((mi) => (
              <div
                key={mi.path}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp
                    size={12}
                    style={{ color: "var(--rs-green)", flexShrink: 0 }}
                  />
                  <FileRef path={mi.path} />
                </div>
                <span style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>
                  imported by {mi.importers} files
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KeyModulesSection({ data }: { data: DocumentationResponse }) {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SectionHeading>Key Modules</SectionHeading>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          The most important modules in the codebase, sorted by file count.
          Understanding these gives you the full picture of the system.
        </p>
      </div>
      {data.modules.length > 0 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {data.modules.slice(0, 10).map((mod, i) => (
            <ModuleCard
              key={mod.name}
              name={mod.name}
              files={mod.file_count}
              cohesion={mod.cohesion}
              externalDeps={mod.external_edges}
              color={MODULE_COLORS[i % MODULE_COLORS.length]}
            />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
          No modules detected.
        </p>
      )}
    </div>
  );
}

function EntryPointsSection({ data }: { data: DocumentationResponse }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SectionHeading>Entry Points</SectionHeading>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          RepoBuddy identified entry points in this codebase with high
          confidence. These are the files that initiate execution and bootstrap
          the system.
        </p>
      </div>
      {data.entry_points.length > 0 ? (
        <div className="flex flex-col gap-6">
          {data.entry_points.map((ep, i) => {
            const isIndex = ep.name.startsWith("index.");
            const isMain =
              ep.name.startsWith("main.") || ep.name.startsWith("app.");
            const confidence = isIndex ? 98 : isMain ? 92 : 85;
            const role = isIndex
              ? "Primary entry point"
              : isMain
                ? "Application factory"
                : "Module entry";
            const lang = ep.language || "text";
            const ext = ep.name.split(".").pop() || "";
            const isTS = ["ts", "tsx"].includes(ext);
            const isJS = ["js", "jsx"].includes(ext);
            const isPy = ext === "py";

            const desc = isIndex
              ? `The root module. Imports the application factory, loads configuration, and calls startServer(). This is the file ${isTS || isJS ? "Node.js" : isPy ? "Python" : "the runtime"} executes when you run ${isTS || isJS ? "npm start" : isPy ? "python main" : "the start command"}.`
              : isMain
                ? `Creates and configures the ${data.detected_framework || "application"}. Wires the router, registers middleware, sets up error handling. Returns a configured app instance that can be used in tests or the main server.`
                : `Entry file for the ${ep.path.split("/").slice(0, -1).join("/") || "root"} module. Understanding this file gives context for related files in the same directory.`;

            return (
              <div
                key={ep.path}
                className="rounded-xl overflow-hidden"
                style={{
                  background: "var(--rs-surface-1)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                {/* Header */}
                <div
                  className="px-5 py-4 flex items-start justify-between"
                  style={{ borderBottom: "1px solid var(--rs-border)" }}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--rs-accent)",
                          fontFamily: "monospace",
                        }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--rs-text-primary)",
                          fontFamily: "monospace",
                        }}
                      >
                        {ep.path}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5"
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          background: "var(--rs-green-dim)",
                          color: "var(--rs-green)",
                        }}
                      >
                        {confidence}% confidence
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--rs-accent)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {role}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <div
                  className="px-5 py-4"
                  style={{
                    borderBottom: ep.snippet
                      ? "1px solid var(--rs-border)"
                      : "none",
                  }}
                >
                  <p
                    style={{
                      fontSize: 14,
                      color: "var(--rs-text-secondary)",
                      lineHeight: 1.7,
                    }}
                  >
                    {desc}
                  </p>
                </div>

                {/* Code Snippet */}
                {ep.snippet && (
                  <div>
                    <div
                      className="flex items-center justify-between px-4 py-2"
                      style={{
                        background: "#1a1a2e",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#ff5f57",
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#febc2e",
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#28c840",
                            display: "inline-block",
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            color: "rgba(255,255,255,0.35)",
                            fontFamily: "monospace",
                          }}
                        >
                          {lang}
                        </span>
                        <button
                          onClick={() => handleCopy(ep.snippet!, i)}
                          className="flex items-center gap-1 cursor-pointer"
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            color: "rgba(255,255,255,0.45)",
                            background: "none",
                            border: "none",
                            padding: 0,
                          }}
                        >
                          {copiedIdx === i ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: "16px 20px",
                        background: "#1a1a2e",
                        color: "#e0def4",
                        fontSize: 12.5,
                        lineHeight: 1.7,
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        overflowX: "auto",
                        borderRadius: "0 0 12px 12px",
                      }}
                    >
                      <code>{ep.snippet}</code>
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
          No entry points were detected. Check top-level files in the repository
          root.
        </p>
      )}
    </div>
  );
}
function RiskAreasSection({ data }: { data: DocumentationResponse }) {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SectionHeading>Risk Areas</SectionHeading>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          Files flagged by risk heuristics â€” heavily depended-on files, high
          coupling, or critical bridges in the dependency chain.
        </p>
      </div>
      {data.risk_areas.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.risk_areas.slice(0, 10).map((risk) => {
            const pct = Math.round(risk.risk_score * 100);
            const color =
              pct > 60 ? "var(--rs-red, #F25353)" : "var(--rs-amber)";
            return (
              <div
                key={risk.path}
                className="rounded-xl px-4 py-3"
                style={{
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={12} style={{ color, flexShrink: 0 }} />
                    <FileRef path={risk.path} />
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5"
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      background:
                        pct > 60
                          ? "rgba(242,83,83,0.12)"
                          : "rgba(245,160,81,0.12)",
                      color,
                    }}
                  >
                    Risk: {pct}%
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--rs-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {risk.reason}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
          No high-risk files detected. The codebase looks well-structured!
        </p>
      )}
    </div>
  );
}

function ReadingPathSection({ data }: { data: DocumentationResponse }) {
  const readingOrder = useMemo(() => {
    const seen = new Set<string>();
    const items: { path: string; tag: string; reason: string }[] = [];

    for (const ep of data.entry_points.slice(0, 3)) {
      if (!seen.has(ep.path)) {
        seen.add(ep.path);
        items.push({
          path: ep.path,
          tag: "Entry",
          reason:
            "Entry point â€” start here to understand how the system bootstraps.",
        });
      }
    }

    for (const cf of data.central_files.slice(0, 5)) {
      if (!seen.has(cf.path)) {
        seen.add(cf.path);
        items.push({
          path: cf.path,
          tag: `${cf.connections} deps`,
          reason: `Highly connected file â€” understanding this unlocks ${cf.connections} other files.`,
        });
      }
    }

    for (const mi of data.most_imported.slice(0, 3)) {
      if (!seen.has(mi.path)) {
        seen.add(mi.path);
        items.push({
          path: mi.path,
          tag: "Core",
          reason: `Imported by ${mi.importers} files â€” a foundational module.`,
        });
      }
    }

    return items.slice(0, 7);
  }, [data]);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SectionHeading>Recommended Reading Path</SectionHeading>
        <p
          style={{
            fontSize: 15,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.7,
          }}
        >
          If you are new to this codebase, this is the order RepoBuddy
          recommends reading the key files. Each step builds context for the
          next.
        </p>
      </div>

      {readingOrder.length > 0 ? (
        <div className="flex flex-col relative">
          <div
            className="absolute left-5 top-0 bottom-0"
            style={{ width: 1, background: "var(--rs-border)", zIndex: 0 }}
          />
          {readingOrder.map((item, i) => (
            <div key={item.path} className="relative flex gap-5 pb-6 z-10">
              <div
                className="flex items-center justify-center rounded-full shrink-0"
                style={{
                  width: 28,
                  height: 28,
                  background: "var(--rs-surface-3)",
                  border: "2px solid var(--rs-accent)",
                  zIndex: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--rs-accent)",
                  }}
                >
                  {i + 1}
                </span>
              </div>
              <div
                className="flex-1 rounded-xl p-4"
                style={{
                  background: "var(--rs-surface-1)",
                  border: "1px solid var(--rs-border)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileCode size={12} style={{ color: "var(--rs-accent)" }} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--rs-text-primary)",
                        fontFamily: "monospace",
                      }}
                    >
                      {item.path}
                    </span>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5"
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      background: "rgba(124,108,245,0.1)",
                      color: "var(--rs-accent)",
                    }}
                  >
                    {item.tag}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--rs-text-secondary)",
                    lineHeight: 1.55,
                  }}
                >
                  {item.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--rs-text-muted)" }}>
          Not enough data to generate a reading path. Upload and analyze a
          repository first.
        </p>
      )}
    </div>
  );
}

function NoDataPlaceholder() {
  return (
    <div className="flex flex-col items-center py-20">
      <div style={{ maxWidth: 420, width: "100%" }}>
        <AnalyzePlaceholder
          title="No repository selected"
          detail="Analyze a repository to see further details."
        />
      </div>
    </div>
  );
}

/* â”€â”€ Main Page Component â”€â”€ */

export function Docs() {
  const { activeAnalysisId } = useAppStore();
  const [activeSection, setActiveSection] = useState("getting-started");
  const [docData, setDocData] = useState<DocumentationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeAnalysisId) {
      setDocData(null);
      setLoading(false);
      return;
    }
    setDocData(null);
    setLoading(true);
    getDocumentation(activeAnalysisId)
      .then((data) => setDocData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeAnalysisId]);

  const renderContent = () => {
    if (!docData) return <NoDataPlaceholder />;

    switch (activeSection) {
      case "getting-started":
        return <GettingStartedSection data={docData} />;
      case "architecture":
        return <ArchitectureSection data={docData} />;
      case "key-modules":
        return <KeyModulesSection data={docData} />;
      case "entry-points":
        return <EntryPointsSection data={docData} />;
      case "risk-areas":
        return <RiskAreasSection data={docData} />;
      case "reading-path":
        return <ReadingPathSection data={docData} />;
      default:
        return <NoDataPlaceholder />;
    }
  };

  if (loading) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: "var(--rs-base)" }}
      >
        <Loader2
          size={24}
          style={{
            color: "var(--rs-accent)",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full" style={{ background: "var(--rs-base)" }}>
      {/* Sidebar */}
      <div
        className="flex flex-col shrink-0"
        style={{
          width: 224,
          borderRight: "1px solid var(--rs-border)",
          background: "var(--rs-sidebar)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2.5 px-4 py-4"
          style={{ borderBottom: "1px solid var(--rs-border)" }}
        >
          <BookOpen size={14} style={{ color: "var(--rs-accent)" }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
            }}
          >
            Docs
          </span>
          <span
            className="ml-auto rounded-full px-2 py-0.5"
            style={{
              fontSize: 9,
              fontWeight: 600,
              background: docData
                ? "var(--rs-green-dim)"
                : "rgba(255,255,255,0.06)",
              color: docData ? "var(--rs-green)" : "var(--rs-text-muted)",
            }}
          >
            {docData ? "Generated" : "No Data"}
          </span>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3 px-2">
          {DOC_SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors"
              style={{
                background:
                  activeSection === section.id
                    ? "rgba(124,108,245,0.1)"
                    : "transparent",
                color:
                  activeSection === section.id
                    ? "var(--rs-text-primary)"
                    : "var(--rs-text-secondary)",
              }}
              onMouseEnter={(e) => {
                if (activeSection !== section.id)
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                if (activeSection !== section.id)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <section.icon
                size={12}
                style={{
                  color:
                    activeSection === section.id
                      ? "var(--rs-accent)"
                      : "var(--rs-text-muted)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  flex: 1,
                  textAlign: "left",
                }}
              >
                {section.title}
              </span>
            </button>
          ))}
        </div>

        {/* Quick links */}
        <div
          className="px-3 py-4"
          style={{ borderTop: "1px solid var(--rs-border)" }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--rs-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              marginBottom: 8,
            }}
          >
            Quick Links
          </div>
          <div className="flex flex-col gap-1">
            {[
              { icon: FileCode, label: "Browse Files" },
              { icon: GitBranch, label: "View Graph" },
            ].map((item) => (
              <button
                key={item.label}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors w-full text-left"
                style={{
                  fontSize: 11,
                  color: "var(--rs-text-muted)",
                  background: "transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                  e.currentTarget.style.color = "var(--rs-text-secondary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--rs-text-muted)";
                }}
              >
                <item.icon size={11} style={{ color: "var(--rs-accent)" }} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="px-10 py-8 max-w-3xl"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
