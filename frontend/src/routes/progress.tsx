import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { Navigation } from "@/components/Navigation";
import { Check } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import {
  listAnalyses,
  getAnalysisProgress,
  type AnalysisProgress,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Analyzing — RepoSage" },
      { name: "description", content: "Your repository is being analyzed." },
    ],
  }),
  component: ProgressPage,
});

const stepOrder = [
  "pending",
  "cloning",
  "scanning",
  "parsing",
  "building_graph",
  "computing_insights",
  "generating_docs",
  "indexing",
  "completed",
];

const stepLabels: Record<string, string> = {
  cloning: "Cloning repository",
  scanning: "Scanning files",
  parsing: "Parsing file structure",
  building_graph: "Building dependency graph",
  computing_insights: "Analyzing patterns",
  generating_docs: "Generating documentation",
  indexing: "Indexing for search",
};

function getPhaseStatus(
  step: string,
  currentStatus: string,
): "done" | "active" | "pending" {
  const currentIdx = stepOrder.indexOf(currentStatus);
  const stepIdx = stepOrder.indexOf(step);
  if (currentStatus === "completed") return "done";
  if (currentStatus === "failed")
    return stepIdx <= currentIdx ? "done" : "pending";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

const displaySteps = [
  "cloning",
  "parsing",
  "building_graph",
  "computing_insights",
  "generating_docs",
];

function ProgressPage() {
  const navigate = useNavigate();
  const { activeRepoId, setActiveAnalysis } = useAppStore();
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRepoId) return;
    listAnalyses(activeRepoId)
      .then((analyses) => {
        if (analyses.length > 0) {
          const latest = analyses[analyses.length - 1];
          setAnalysisId(latest.id);
          setActiveAnalysis(latest.id);
        }
      })
      .catch(() => setError("Could not load analysis"));
  }, [activeRepoId, setActiveAnalysis]);

  const poll = useCallback(async () => {
    if (!analysisId) return;
    try {
      const p = await getAnalysisProgress(analysisId);
      setProgress(p);
      if (p.status === "completed") {
        setTimeout(() => navigate({ to: "/dashboard" }), 1000);
      } else if (p.status === "failed") {
        setError(p.error_message ?? "Analysis failed");
      }
    } catch {
      /* ignore transient errors */
    }
  }, [analysisId, navigate]);

  useEffect(() => {
    if (!analysisId) return;
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [analysisId, poll]);

  const currentStatus = progress?.status ?? "pending";
  const pct = progress?.progress ?? 0;
  const circumference = 2 * Math.PI * 42;

  return (
    <div className="relative min-h-screen bg-background">
      <Navigation />
      <div className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-sm text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground mb-2">
            Analyzing repository
          </h1>
          <p className="text-sm text-muted-foreground mb-12">
            {progress?.current_step
              ? (stepLabels[progress.current_step] ?? progress.current_step)
              : "Starting…"}
          </p>

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Progress ring */}
          <div className="mx-auto w-28 h-28 relative mb-14">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="oklch(0.25 0.01 260)"
                strokeWidth="3"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="oklch(0.72 0.12 180)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${circumference}`}
                strokeDashoffset={`${circumference * (1 - pct / 100)}`}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-mono font-medium text-foreground">
                {pct}%
              </span>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-0 text-left">
            {displaySteps.map((step) => {
              const status = getPhaseStatus(step, currentStatus);
              return (
                <div
                  key={step}
                  className={`flex items-center gap-3 py-3 border-t border-border/40 ${
                    status === "pending" ? "opacity-30" : ""
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      status === "done"
                        ? "bg-primary/15"
                        : status === "active"
                          ? "border border-primary/40"
                          : "border border-border/30"
                    }`}
                  >
                    {status === "done" && (
                      <Check className="w-3 h-3 text-primary" />
                    )}
                    {status === "active" && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-soft" />
                    )}
                  </div>
                  <span
                    className={`text-sm ${
                      status === "active"
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {stepLabels[step] ?? step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
