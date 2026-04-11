import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/AppShell";
import {
  ArrowUpRight,
  FileText,
  Network,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getDashboard, type DashboardData } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — RepoSage" },
      { name: "description", content: "Overview of your codebase analysis." },
    ],
  }),
  component: DashboardPage,
});

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="p-5 rounded-xl border border-border/40 bg-card/20">
      <span className="text-[11px] text-muted-foreground block mb-3">
        {label}
      </span>
      <span className="text-2xl font-semibold font-mono text-foreground tracking-tight">
        {value}
      </span>
      {sub && (
        <span className="text-[11px] text-muted-foreground/60 block mt-1">
          {sub}
        </span>
      )}
    </div>
  );
}

function DashboardPage() {
  const { activeRepoId } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRepoId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getDashboard(activeRepoId)
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load dashboard"),
      )
      .finally(() => setLoading(false));
  }, [activeRepoId]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!activeRepoId) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            No repository selected.{" "}
            <a href="/upload" className="text-primary hover:underline">
              Connect one
            </a>
            .
          </p>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </AppShell>
    );
  }

  const repoName = data?.repository.name ?? "Repository";
  const framework = data?.detected_framework;

  return (
    <AppShell>
      <div className="p-6 md:p-10 max-w-5xl">
        <div className="mb-10">
          <h1 className="text-xl font-semibold text-foreground tracking-tight mb-1">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            {repoName}
            {framework ? ` · ${framework}` : ""}
            {data?.analysis ? ` · ${data.analysis.status}` : ""}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <StatCard label="Files" value={String(data?.file_count ?? 0)} />
          <StatCard
            label="Functions"
            value={String(data?.function_count ?? 0)}
          />
          <StatCard label="Classes" value={String(data?.class_count ?? 0)} />
          <StatCard label="Lines" value={String(data?.total_lines ?? 0)} />
        </div>

        {/* Two columns */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Top modules */}
          <div className="rounded-xl border border-border/40 bg-card/20 p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-medium text-foreground">
                Top modules
              </h3>
              <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40" />
            </div>
            <div className="space-y-0">
              {(data?.top_modules ?? []).slice(0, 5).map((mod) => (
                <div
                  key={mod.name}
                  className="flex items-center gap-3 py-3 border-t border-border/30"
                >
                  <FileText
                    className="w-3.5 h-3.5 text-muted-foreground/40"
                    strokeWidth={1.5}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-mono text-foreground block truncate">
                      {mod.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {mod.count} symbols
                    </span>
                  </div>
                </div>
              ))}
              {(data?.top_modules ?? []).length === 0 && (
                <p className="text-[12px] text-muted-foreground py-3">
                  No module data yet.
                </p>
              )}
            </div>
          </div>

          {/* Central files & insights */}
          <div className="rounded-xl border border-border/40 bg-card/20 p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-medium text-foreground">
                Central files
              </h3>
              <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40" />
            </div>
            <div className="space-y-0">
              {(data?.central_files ?? []).slice(0, 5).map((file) => (
                <div
                  key={file.path}
                  className="flex items-start gap-3 py-3 border-t border-border/30"
                >
                  <Network
                    className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0"
                    strokeWidth={1.5}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-mono text-foreground block truncate">
                      {file.path}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {file.degree} connections
                    </span>
                  </div>
                </div>
              ))}
              {data?.cycle_count ? (
                <div className="flex items-start gap-3 py-3 border-t border-border/30">
                  <AlertCircle
                    className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0"
                    strokeWidth={1.5}
                  />
                  <span className="text-[13px] text-muted-foreground leading-relaxed">
                    {data.cycle_count} circular{" "}
                    {data.cycle_count === 1 ? "dependency" : "dependencies"}{" "}
                    detected
                  </span>
                </div>
              ) : null}
              {(data?.central_files ?? []).length === 0 &&
                !data?.cycle_count && (
                  <p className="text-[12px] text-muted-foreground py-3">
                    No graph data yet.
                  </p>
                )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
