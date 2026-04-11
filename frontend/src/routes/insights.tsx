import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/AppShell";
import {
  AlertTriangle,
  TrendingUp,
  GitBranch,
  Layers,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getInsights, type InsightItem } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — RepoSage" },
      {
        name: "description",
        content: "Code quality insights and architectural patterns.",
      },
    ],
  }),
  component: InsightsPage,
});

const severityIcons: Record<string, typeof AlertTriangle> = {
  high: AlertTriangle,
  medium: GitBranch,
  low: TrendingUp,
};

function InsightsPage() {
  const { activeAnalysisId, activeRepoId } = useAppStore();
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeAnalysisId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getInsights(activeAnalysisId)
      .then((data) => {
        setInsights(data.items);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeAnalysisId]);

  if (!activeRepoId || !activeAnalysisId) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            No analysis available.{" "}
            <a href="/upload" className="text-primary hover:underline">
              Connect a repository
            </a>
            .
          </p>
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const highCount = insights.filter((i) => i.severity === "high").length;
  const mediumCount = insights.filter((i) => i.severity === "medium").length;
  const lowCount = insights.filter((i) => i.severity === "low").length;

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-3xl">
        <div className="mb-10">
          <h1 className="text-xl font-semibold text-foreground tracking-tight mb-1">
            Insights
          </h1>
          <p className="text-sm text-muted-foreground">
            Architectural patterns and quality signals.
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          {[
            ["Total", String(total)],
            ["High severity", String(highCount)],
            ["Medium", String(mediumCount)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="p-4 rounded-xl border border-border/40 bg-card/20"
            >
              <span className="text-[10px] text-muted-foreground block mb-2">
                {label}
              </span>
              <span className="text-xl font-mono font-semibold text-foreground">
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Insight cards */}
        <div className="space-y-0">
          {insights.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No insights available yet.
            </p>
          )}
          {insights.map((insight) => {
            const Icon = severityIcons[insight.severity] ?? Layers;
            return (
              <div
                key={insight.id}
                className="flex items-start gap-4 py-5 border-t border-border/40 group transition-smooth hover:bg-secondary/10 -mx-3 px-3 rounded-lg"
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    insight.severity === "high"
                      ? "bg-destructive/10"
                      : insight.severity === "medium"
                        ? "bg-primary/10"
                        : "bg-secondary/40"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      insight.severity === "high"
                        ? "text-destructive"
                        : insight.severity === "medium"
                          ? "text-primary/70"
                          : "text-muted-foreground"
                    }`}
                    strokeWidth={1.5}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[13px] font-medium text-foreground">
                      {insight.title}
                    </h3>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        insight.severity === "high"
                          ? "bg-destructive/10 text-destructive"
                          : insight.severity === "medium"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary/30 text-muted-foreground"
                      }`}
                    >
                      {insight.severity}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    {insight.description}
                  </p>
                  {insight.affected_files &&
                    insight.affected_files.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {insight.affected_files.map((f) => (
                          <span
                            key={f}
                            className="text-[10px] font-mono text-muted-foreground/50 bg-secondary/20 px-1.5 py-0.5 rounded"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
