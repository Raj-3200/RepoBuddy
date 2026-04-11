import { Link, useLocation } from "@tanstack/react-router";
import {
  GitBranch,
  LayoutGrid,
  Network,
  FileText,
  Sparkles,
  BarChart3,
  BookOpen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { getRepository, listRepositories, type Repository } from "@/lib/api";

const navItems = [
  { to: "/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { to: "/files", icon: FileText, label: "Files" },
  { to: "/graph", icon: Network, label: "Graph" },
  { to: "/ai", icon: Sparkles, label: "AI" },
  { to: "/insights", icon: BarChart3, label: "Insights" },
  { to: "/docs", icon: BookOpen, label: "Docs" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { activeRepoId, setActiveRepo } = useAppStore();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);

  useEffect(() => {
    listRepositories()
      .then((data) => {
        setRepos(data.items);
        // Auto-select first repo if none active
        if (!activeRepoId && data.items.length > 0) {
          setActiveRepo(data.items[0].id);
        }
      })
      .catch(() => {});
  }, [activeRepoId, setActiveRepo]);

  useEffect(() => {
    if (!activeRepoId) return;
    getRepository(activeRepoId)
      .then(setRepo)
      .catch(() => {});
  }, [activeRepoId]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-14 md:w-56 border-r border-border/40 flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-border/40">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                className="text-primary"
              >
                <path
                  d="M2 7h3l2-4 2 8 2-4h3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-foreground hidden md:block">
              RepoSage
            </span>
          </Link>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] transition-smooth ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span className="hidden md:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Repo selector */}
        <div className="border-t border-border/40 p-3 hidden md:block">
          {repos.length > 1 ? (
            <select
              value={activeRepoId ?? ""}
              onChange={(e) => setActiveRepo(e.target.value || null)}
              className="w-full text-[11px] text-muted-foreground bg-secondary/30 border border-border/40 rounded-lg px-2 py-1.5 focus:outline-none"
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/30 border border-border/40">
              <GitBranch
                className="w-3.5 h-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-[11px] text-muted-foreground truncate">
                {repo?.name ?? "No repository"}
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
