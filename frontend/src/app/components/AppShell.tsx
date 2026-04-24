import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard,
  FolderOpen,
  GitBranch,
  Sparkles,
  Lightbulb,
  BookOpen,
  Brain,
  Search,
  Bell,
  Plus,
  Check,
  ChevronsUpDown,
  LogOut,
  Target,
  ShieldAlert,
} from "lucide-react";
import { listRepositories, listAnalyses, type Repository } from "@/lib/api";
import { useAppStore } from "@/lib/store";

const navItems = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/files", label: "Files", icon: FolderOpen },
  { to: "/app/graph", label: "Graph", icon: GitBranch },
  { to: "/app/impact", label: "Impact", icon: Target },
  { to: "/app/risk", label: "Risk Areas", icon: ShieldAlert },
  { to: "/app/ai", label: "AI Workspace", icon: Sparkles },
  { to: "/app/insights", label: "Insights", icon: Lightbulb },
  { to: "/app/docs", label: "Docs", icon: BookOpen },
  { to: "/app/intelligence", label: "Intelligence", icon: Brain },
];

export function AppShell() {
  const {
    activeRepoId,
    setActiveRepo: setStoreRepo,
    setActiveAnalysis,
    user,
    signOut,
  } = useAppStore();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoOpen, setRepoOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Auth guard — redirect to sign in if not authenticated
  useEffect(() => {
    if (!user) navigate("/signin", { replace: true });
  }, [user]);

  useEffect(() => {
    listRepositories()
      .then((data) => {
        setRepos(data.items);
        if (!activeRepoId && data.items.length > 0) {
          setStoreRepo(data.items[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeRepoId) return;
    listAnalyses(activeRepoId)
      .then((analyses) => {
        const completed = analyses.filter((a) => a.status === "completed");
        if (completed.length > 0) {
          setActiveAnalysis(completed[0].id);
        }
      })
      .catch(() => {});
  }, [activeRepoId]);

  const activeRepo = repos.find((r) => r.id === activeRepoId) ?? repos[0];

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ background: "var(--rs-base)", color: "var(--rs-text-primary)" }}
    >
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 h-full"
        style={{
          width: 220,
          background: "var(--rs-sidebar)",
          borderRight: "1px solid var(--rs-border)",
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 px-5 py-5"
          style={{ borderBottom: "1px solid var(--rs-border)" }}
        >
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
            className="flex items-center gap-2.5"
            style={{
              textDecoration: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <div
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{
                width: 28,
                height: 28,
                background: "var(--rs-accent)",
                boxShadow: "0 0 16px rgba(124,108,245,0.35)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 1L12.5 4.5V10.5L7 14L1.5 10.5V4.5L7 1Z"
                  stroke="white"
                  strokeWidth="1.2"
                  fill="none"
                />
                <circle cx="7" cy="7" r="2" fill="white" fillOpacity="0.9" />
                <path
                  d="M7 1V5M7 9V13M1.5 4.5L5 6.5M9 7.5L12.5 9.5M1.5 10.5L5 8.5M9 5.5L12.5 4.5"
                  stroke="white"
                  strokeWidth="0.8"
                  strokeOpacity="0.7"
                />
              </svg>
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "var(--rs-text-primary)",
              }}
            >
              RepoBuddy
            </span>
          </a>
        </div>

        {/* Repo switcher */}
        <div
          className="px-3 py-3 relative"
          style={{ borderBottom: "1px solid var(--rs-border)" }}
        >
          <button
            onClick={() => setRepoOpen(!repoOpen)}
            className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors relative"
            style={{
              background: repoOpen ? "rgba(255,255,255,0.06)" : "transparent",
              border: "1px solid var(--rs-border)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(255,255,255,0.06)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = repoOpen
                ? "rgba(255,255,255,0.06)"
                : "transparent")
            }
          >
            <div
              className="shrink-0 rounded"
              style={{
                width: 20,
                height: 20,
                background: "var(--rs-surface-3)",
                border: "1px solid var(--rs-border-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: "var(--rs-accent)",
                  fontFamily: "monospace",
                }}
              >
                {activeRepo?.name?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <div className="flex-1 text-left overflow-hidden">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--rs-text-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeRepo?.name ?? "No repo"}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--rs-text-muted)",
                  marginTop: 1,
                }}
              >
                {activeRepo?.detected_language ?? activeRepo?.source ?? ""}
              </div>
            </div>
            <ChevronsUpDown
              size={12}
              style={{ color: "var(--rs-text-muted)", flexShrink: 0 }}
            />
          </button>

          <AnimatePresence>
            {repoOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute z-50 mt-1"
                style={{
                  width: 196,
                  background: "var(--rs-surface-3)",
                  border: "1px solid var(--rs-border-strong)",
                  borderRadius: 8,
                  padding: "4px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => {
                      setStoreRepo(repo.id);
                      setRepoOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors"
                    style={{
                      background:
                        activeRepo?.id === repo.id
                          ? "rgba(124,108,245,0.12)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (activeRepo?.id !== repo.id)
                        e.currentTarget.style.background =
                          "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (activeRepo?.id !== repo.id)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--rs-text-primary)",
                        }}
                      >
                        {repo.name}
                      </div>
                      <div
                        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
                      >
                        {repo.detected_language ?? repo.source}
                      </div>
                    </div>
                    {activeRepo?.id === repo.id && (
                      <Check size={11} style={{ color: "var(--rs-accent)" }} />
                    )}
                  </button>
                ))}
                <div
                  style={{
                    borderTop: "1px solid var(--rs-border)",
                    margin: "4px 0",
                  }}
                />
                <button
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors"
                  style={{ color: "var(--rs-text-secondary)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.05)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <Plus size={11} />
                  <span
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      setRepoOpen(false);
                      navigate("/app/upload");
                    }}
                  >
                    Add repository
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          <div style={{ marginBottom: 6 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--rs-text-muted)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "0 8px 6px",
              }}
            >
              Workspace
            </div>
            <div className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-150 ${isActive ? "active-nav" : ""}`
                  }
                  style={({ isActive }) => ({
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive
                      ? "var(--rs-text-primary)"
                      : "var(--rs-text-secondary)",
                    background: isActive
                      ? "rgba(124,108,245,0.1)"
                      : "transparent",
                    textDecoration: "none",
                  })}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.classList.contains("active-nav")) {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.04)";
                      e.currentTarget.style.color = "var(--rs-text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.classList.contains("active-nav")) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--rs-text-secondary)";
                    }
                  }}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        size={14}
                        style={{
                          color: isActive ? "var(--rs-accent)" : "inherit",
                          flexShrink: 0,
                        }}
                      />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom */}
        <div
          className="px-3 py-3"
          style={{ borderTop: "1px solid var(--rs-border)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="rounded-full flex items-center justify-center shrink-0"
              style={{
                width: 28,
                height: 28,
                background: "var(--rs-accent)",
                border: "1px solid rgba(124,108,245,0.3)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "white",
                }}
              >
                {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--rs-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user?.name ?? "Guest"}
              </div>
              <div style={{ fontSize: 10, color: "var(--rs-text-muted)" }}>
                {user?.email ?? ""}
              </div>
            </div>
            <button
              onClick={() => {
                signOut();
                navigate("/");
              }}
              title="Sign out"
              className="rounded transition-colors p-1"
              style={{ color: "var(--rs-text-muted)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--rs-red)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-muted)")
              }
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center gap-3 px-6 shrink-0"
          style={{
            height: 52,
            borderBottom: "1px solid var(--rs-hairline)",
            background: "rgba(12,12,16,0.78)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <div
            className="flex items-center gap-2 flex-1 max-w-xs rounded-md px-3"
            style={{
              height: 30,
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-hairline-strong)",
              opacity: 0.78,
            }}
            title="Search is coming soon"
          >
            <Search size={12} style={{ color: "var(--rs-text-muted)" }} />
            <input
              placeholder="Search files, symbols, modules…"
              disabled
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: 12,
                color: "var(--rs-text-muted)",
                flex: 1,
                cursor: "not-allowed",
              }}
            />
            <kbd
              style={{
                fontSize: 9,
                color: "var(--rs-text-muted)",
                background: "var(--rs-surface-2)",
                border: "1px solid var(--rs-hairline)",
                borderRadius: 3,
                padding: "1px 4px",
                fontFamily: "var(--rs-font-mono)",
              }}
            >
              soon
            </kbd>
          </div>

          <div className="flex-1" />

          {activeRepo && (
            <button
              onClick={() => navigate("/app")}
              title="Active analysis context"
              className="flex items-center gap-2 rounded-md px-2.5"
              style={{
                height: 28,
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-hairline-strong)",
                color: "var(--rs-text-secondary)",
                cursor: "pointer",
                fontSize: 11,
                transition:
                  "background var(--rs-dur-fast) var(--rs-ease-standard), color var(--rs-dur-fast) var(--rs-ease-standard)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--rs-surface-2)";
                e.currentTarget.style.color = "var(--rs-text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--rs-surface-1)";
                e.currentTarget.style.color = "var(--rs-text-secondary)";
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--rs-green)",
                  boxShadow: "0 0 6px rgba(61,214,140,0.5)",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--rs-font-mono)",
                  letterSpacing: "0.02em",
                }}
              >
                {activeRepo.name}
              </span>
            </button>
          )}

          <button
            className="rounded transition-all p-1.5"
            style={{ color: "var(--rs-text-muted)" }}
            title="Notifications"
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--rs-text-primary)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--rs-text-muted)")
            }
          >
            <Bell size={14} />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.24,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
