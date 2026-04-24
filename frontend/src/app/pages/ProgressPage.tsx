import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Circle,
  Loader2,
  Lock,
  RefreshCw,
} from "lucide-react";
import {
  getAnalysisProgress,
  listAnalyses,
  retryAnalysis,
  type AnalysisProgress as AnalysisProgressType,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";
import {
  Callout,
  Card,
  Eyebrow,
  FadeIn,
  MetaText,
  Mono,
  PageHero,
  PageShell,
} from "../ds";

type StepKey =
  | "CLONING"
  | "SCANNING"
  | "PARSING"
  | "BUILDING_GRAPH"
  | "COMPUTING_INSIGHTS"
  | "GENERATING_DOCS"
  | "INDEXING";

const STEPS: { key: StepKey; label: string; blurb: string }[] = [
  {
    key: "CLONING",
    label: "Clone or unpack",
    blurb: "Pulling the source into an isolated workspace.",
  },
  {
    key: "SCANNING",
    label: "Scan files",
    blurb: "Walking the tree, classifying languages, ignoring vendored code.",
  },
  {
    key: "PARSING",
    label: "Parse symbols",
    blurb: "Tree-sitter extracts functions, classes, types, and imports.",
  },
  {
    key: "BUILDING_GRAPH",
    label: "Build the graph",
    blurb: "Imports become edges; we score centrality and find cycles.",
  },
  {
    key: "COMPUTING_INSIGHTS",
    label: "Compute insights",
    blurb: "Quality metrics, risk scoring, anti-pattern detection.",
  },
  {
    key: "GENERATING_DOCS",
    label: "Generate docs",
    blurb:
      "Architecture, getting-started, and entry-point summaries from the parsed shape.",
  },
  {
    key: "INDEXING",
    label: "Index for search",
    blurb: "Embed snippets and stash citations for grounded Q&A.",
  },
];

const STEP_INDEX: Record<string, number> = STEPS.reduce(
  (acc, s, i) => ({ ...acc, [s.key]: i }),
  {} as Record<string, number>,
);

type Status = "pending" | "running" | "completed" | "failed";

function statusOf(p: AnalysisProgressType | null): Status {
  const s = p?.status?.toLowerCase();
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  if (s === "running" || s === "in_progress") return "running";
  return "pending";
}

export function ProgressPage() {
  const navigate = useNavigate();
  const { activeRepoId, setActiveAnalysis } = useAppStore();
  const [progress, setProgress] = useState<AnalysisProgressType | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState("");
  const [retrying, setRetrying] = useState(false);

  // Locate the latest analysis for the active repo.
  useEffect(() => {
    if (!activeRepoId) {
      navigate("/app/upload");
      return;
    }
    listAnalyses(activeRepoId)
      .then((analyses) => {
        if (analyses.length > 0) {
          const latest = analyses[0];
          setAnalysisId(latest.id);
          setActiveAnalysis(latest.id);
        } else {
          setError("No analysis found for this repository yet.");
        }
      })
      .catch(() => setError("Could not load analyses for this repository."));
  }, [activeRepoId, navigate, setActiveAnalysis]);

  // Poll progress.
  useEffect(() => {
    if (!analysisId) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const p = await getAnalysisProgress(analysisId);
        setProgress(p);
        const s = p.status?.toLowerCase();
        if (s === "completed") {
          if (timer) clearInterval(timer);
          setTimeout(() => navigate("/app"), 1100);
        } else if (s === "failed") {
          if (timer) clearInterval(timer);
          setError(p.error_message || "Analysis failed.");
        }
      } catch {
        // transient — keep polling
      }
    };
    tick();
    timer = setInterval(tick, 2000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [analysisId, navigate]);

  const status = statusOf(progress);
  const pct = Math.max(0, Math.min(100, progress?.progress ?? 0));
  const currentStepKey = progress?.current_step ?? null;
  const currentIdx =
    currentStepKey && currentStepKey in STEP_INDEX
      ? STEP_INDEX[currentStepKey]
      : -1;

  const isAuthError = useMemo(
    () =>
      status === "failed" &&
      /private|authentication|access token|401|403/i.test(error ?? ""),
    [status, error],
  );

  const handleRetry = async () => {
    if (!analysisId) return;
    setRetrying(true);
    try {
      await retryAnalysis(
        analysisId,
        isAuthError && retryToken.trim() ? retryToken.trim() : undefined,
      );
      setError(null);
      setProgress({
        status: "pending",
        current_step: null,
        progress: 0,
        error_message: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  };

  const heroTitle =
    status === "completed"
      ? "Analysis complete."
      : status === "failed"
        ? "Analysis didn't finish."
        : "Reading the codebase.";

  const heroLede =
    status === "completed"
      ? "Everything is parsed, indexed, and ready. Taking you to the overview."
      : status === "failed"
        ? (error ?? "Something interrupted the run.")
        : "We'll keep you here while symbols, edges, and insights are being computed. This usually takes a couple of minutes.";

  return (
    <PageShell width="narrow">
      <PageHero
        eyebrow={
          status === "completed"
            ? "Done"
            : status === "failed"
              ? "Failed"
              : "Analysing"
        }
        title={heroTitle}
        lede={heroLede}
      />

      <FadeIn>
        <Card variant="raised" padding={24}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Eyebrow>Progress</Eyebrow>
            <MetaText>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {Math.round(pct)}%
              </span>
              {analysisId && (
                <>
                  <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                  <Mono>{analysisId.slice(0, 8)}</Mono>
                </>
              )}
            </MetaText>
          </div>

          <div
            style={{
              marginTop: 12,
              height: 4,
              borderRadius: 999,
              background: "var(--rs-surface-2)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background:
                  status === "failed"
                    ? "var(--rs-red)"
                    : status === "completed"
                      ? "var(--rs-green)"
                      : "var(--rs-accent)",
                transition:
                  "width var(--rs-dur-slow) var(--rs-ease-standard), background var(--rs-dur-fast) var(--rs-ease-standard)",
              }}
            />
          </div>

          <ol
            style={{
              listStyle: "none",
              margin: "20px 0 0",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {STEPS.map((step, i) => {
              let state: "done" | "active" | "todo" = "todo";
              if (status === "completed") state = "done";
              else if (currentIdx === -1)
                state = i === 0 && status !== "pending" ? "active" : "todo";
              else if (i < currentIdx) state = "done";
              else if (i === currentIdx)
                state = status === "failed" ? "todo" : "active";

              const failedHere = status === "failed" && i === currentIdx;

              return (
                <li
                  key={step.key}
                  className="flex items-start gap-3"
                  style={{
                    padding: "10px 0",
                    borderTop:
                      i === 0 ? "none" : "1px solid var(--rs-hairline)",
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      flexShrink: 0,
                      marginTop: 1,
                      background:
                        state === "done"
                          ? "rgba(61,214,140,0.12)"
                          : state === "active"
                            ? "rgba(124,108,245,0.12)"
                            : failedHere
                              ? "rgba(242,83,83,0.12)"
                              : "var(--rs-surface-2)",
                      border: `1px solid ${
                        state === "done"
                          ? "rgba(61,214,140,0.32)"
                          : state === "active"
                            ? "rgba(124,108,245,0.32)"
                            : failedHere
                              ? "rgba(242,83,83,0.32)"
                              : "var(--rs-hairline)"
                      }`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color:
                        state === "done"
                          ? "var(--rs-green)"
                          : state === "active"
                            ? "var(--rs-accent)"
                            : failedHere
                              ? "var(--rs-red)"
                              : "var(--rs-text-muted)",
                    }}
                  >
                    {state === "done" ? (
                      <Check size={11} strokeWidth={2.5} />
                    ) : state === "active" ? (
                      <Loader2 className="animate-spin" size={11} />
                    ) : failedHere ? (
                      <AlertCircle size={11} />
                    ) : (
                      <Circle size={6} fill="currentColor" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "var(--rs-text-body)",
                        fontWeight: 500,
                        color:
                          state === "todo" && !failedHere
                            ? "var(--rs-text-secondary)"
                            : "var(--rs-text-primary)",
                      }}
                    >
                      {step.label}
                    </div>
                    <p
                      style={{
                        margin: "2px 0 0",
                        fontSize: "var(--rs-text-meta)",
                        color: "var(--rs-text-muted)",
                        lineHeight: "var(--rs-leading-relaxed)",
                      }}
                    >
                      {step.blurb}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </FadeIn>

      {status === "failed" && (
        <FadeIn>
          <Card variant="feature" tone="danger" padding={20}>
            <Eyebrow>Recovery</Eyebrow>
            <p
              style={{
                margin: "8px 0 14px",
                fontSize: "var(--rs-text-body)",
                lineHeight: "var(--rs-leading-relaxed)",
                color: "var(--rs-text-primary)",
              }}
            >
              {progress?.error_message || error || "The analysis failed."}{" "}
              {isAuthError &&
                "It looks like the repo is private. Add a token and we'll retry the same job."}
            </p>

            {isAuthError && (
              <div style={{ marginBottom: 12 }}>
                <Eyebrow>Access token</Eyebrow>
                <div
                  style={{
                    marginTop: 6,
                    background: "var(--rs-surface-1)",
                    border: "1px solid var(--rs-hairline-strong)",
                    borderRadius: "var(--rs-radius-md)",
                    padding: "10px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Lock size={12} color="var(--rs-text-muted)" />
                  <input
                    type="password"
                    autoComplete="off"
                    value={retryToken}
                    onChange={(e) => setRetryToken(e.target.value)}
                    placeholder="ghp_…"
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      fontFamily: "var(--rs-font-mono)",
                      fontSize: "var(--rs-text-body)",
                      color: "var(--rs-text-primary)",
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleRetry}
                disabled={retrying || (isAuthError && !retryToken.trim())}
                style={{
                  all: "unset",
                  cursor:
                    retrying || (isAuthError && !retryToken.trim())
                      ? "not-allowed"
                      : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 14px",
                  fontSize: "var(--rs-text-body)",
                  fontWeight: 500,
                  background:
                    retrying || (isAuthError && !retryToken.trim())
                      ? "var(--rs-surface-2)"
                      : "var(--rs-text-primary)",
                  color:
                    retrying || (isAuthError && !retryToken.trim())
                      ? "var(--rs-text-muted)"
                      : "var(--rs-base)",
                  borderRadius: "var(--rs-radius-md)",
                }}
              >
                {retrying ? (
                  <Loader2 className="animate-spin" size={12} />
                ) : (
                  <RefreshCw size={12} />
                )}
                {retrying ? "Retrying…" : "Retry analysis"}
              </button>
              <button
                onClick={() => navigate("/app/upload")}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 14px",
                  fontSize: "var(--rs-text-body)",
                  fontWeight: 500,
                  background: "transparent",
                  color: "var(--rs-text-secondary)",
                  borderRadius: "var(--rs-radius-md)",
                  border: "1px solid var(--rs-hairline-strong)",
                }}
              >
                Add a different repository
                <ArrowRight size={12} />
              </button>
            </div>
          </Card>
        </FadeIn>
      )}

      {status === "completed" && (
        <Callout tone="success" title="All set">
          The overview is being prepared. If you aren't redirected
          automatically, head to <Mono>/app</Mono>.
        </Callout>
      )}
    </PageShell>
  );
}
