import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  GitFork,
  Github,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { createRepository, listGithubRepos, type GithubRepo } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Eyebrow, MetaText, Tag } from "../ds";

type Tab = "mygithub" | "url";

export function AnalyzeAnotherRepoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { setActiveRepo, user } = useAppStore();

  const hasGithubToken =
    typeof window !== "undefined" &&
    !!localStorage.getItem("github_access_token");
  const isSignedInWithGithub = !!user && hasGithubToken;

  const [tab, setTab] = useState<Tab>(
    isSignedInWithGithub ? "mygithub" : "url",
  );
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // GitHub repos state
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickingFullName, setPickingFullName] = useState<string | null>(null);

  // Reset on open / close
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setPickingFullName(null);
    setTab(isSignedInWithGithub ? "mygithub" : "url");
  }, [open, isSignedInWithGithub]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting && pickingFullName === null) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting, pickingFullName]);

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const data = await listGithubRepos();
      setRepos(data.items);
    } catch (e) {
      setRepos(null);
      setReposError(
        e instanceof Error ? e.message : "Failed to load GitHub repositories.",
      );
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      open &&
      tab === "mygithub" &&
      isSignedInWithGithub &&
      repos === null &&
      !reposLoading
    ) {
      loadRepos();
    }
  }, [open, tab, isSignedInWithGithub, repos, reposLoading, loadRepos]);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.language ?? "").toLowerCase().includes(q),
    );
  }, [repos, query]);

  const handleAnalyzeUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setSubmitError("Please paste a GitHub repository URL.");
      return;
    }
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(trimmed)) {
      setSubmitError("Please enter a valid GitHub repository URL.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const name = trimmed
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
      const repo = await createRepository({ name, url: trimmed });
      setActiveRepo(repo.id);
      onClose();
      navigate("/app/progress");
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : "Failed to start analysis.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePickRepo = async (r: GithubRepo) => {
    if (pickingFullName) return;
    setPickingFullName(r.full_name);
    setSubmitError(null);
    try {
      const accessToken =
        typeof window !== "undefined"
          ? (localStorage.getItem("github_access_token") ?? undefined)
          : undefined;
      // Always pass the token when we have one — needed for private repos and
      // also avoids rate-limiting on the backend's clone step.
      const repo = await createRepository({
        name: r.full_name,
        url: r.html_url.endsWith(".git") ? r.html_url : `${r.html_url}.git`,
        access_token: accessToken,
      });
      setActiveRepo(repo.id);
      onClose();
      navigate("/app/progress");
    } catch (e) {
      setSubmitError(
        e instanceof Error
          ? e.message
          : "Failed to start analysis for this repo.",
      );
      setPickingFullName(null);
    }
  };

  if (!open) return null;

  const busy = submitting || pickingFullName !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-modal-title"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--rs-surface-1)",
          border: "1px solid var(--rs-hairline-strong)",
          borderRadius: "var(--rs-radius-lg, 12px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          padding: 24,
          color: "var(--rs-text-primary)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Analyze another repo</Eyebrow>
            <h2
              id="analyze-modal-title"
              style={{
                margin: "6px 0 0",
                fontSize: 15,
                fontWeight: 500,
                color: "var(--rs-text-primary)",
              }}
            >
              Pick from your GitHub account or paste any public repo URL.
            </h2>
          </div>
          <button
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Close"
            disabled={busy}
            style={{
              all: "unset",
              cursor: busy ? "not-allowed" : "pointer",
              padding: 6,
              borderRadius: 6,
              color: "var(--rs-text-muted)",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          style={{
            marginTop: 16,
            display: "flex",
            gap: 4,
            borderBottom: "1px solid var(--rs-hairline)",
          }}
        >
          <TabButton
            active={tab === "mygithub"}
            onClick={() => setTab("mygithub")}
          >
            <Github size={12} />
            {isSignedInWithGithub
              ? "My GitHub"
              : "My GitHub · sign in required"}
          </TabButton>
          <TabButton active={tab === "url"} onClick={() => setTab("url")}>
            <Github size={12} />
            Paste any repo URL
          </TabButton>
        </div>

        <div style={{ marginTop: 16 }}>
          {tab === "mygithub" ? (
            <MyGithubPanel
              isSignedIn={isSignedInWithGithub}
              loading={reposLoading}
              error={reposError}
              repos={repos}
              filtered={filtered}
              query={query}
              onChangeQuery={setQuery}
              onRefresh={loadRepos}
              onPick={handlePickRepo}
              pickingFullName={pickingFullName}
              submitError={submitError}
              onSwitchToUrl={() => {
                setSubmitError(null);
                setTab("url");
              }}
              onSignIn={() => {
                onClose();
                navigate("/sign-in");
              }}
            />
          ) : (
            <UrlPanel
              url={url}
              setUrl={setUrl}
              submitting={submitting}
              error={submitError}
              onSubmit={handleAnalyzeUrl}
              isSignedInWithGithub={isSignedInWithGithub}
            />
          )}
        </div>

        {tab === "url" && (
          <p
            style={{
              margin: "14px 0 0",
              fontSize: 12,
              color: "var(--rs-text-muted)",
            }}
          >
            Tip: sign in with GitHub to pick private repos from a searchable
            list.
          </p>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        fontSize: 13,
        fontWeight: 500,
        color: active ? "var(--rs-text-primary)" : "var(--rs-text-muted)",
        borderBottom: active
          ? "2px solid var(--rs-accent, var(--rs-text-primary))"
          : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function UrlPanel({
  url,
  setUrl,
  submitting,
  error,
  onSubmit,
  isSignedInWithGithub,
}: {
  url: string;
  setUrl: (v: string) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  isSignedInWithGithub: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow>GitHub repository URL</Eyebrow>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        placeholder="https://github.com/owner/repo"
        spellCheck={false}
        autoFocus
        disabled={submitting}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "var(--rs-surface-2)",
          border: "1px solid var(--rs-hairline-strong)",
          borderRadius: "var(--rs-radius-md, 8px)",
          padding: "12px 14px",
          fontFamily: "var(--rs-font-mono)",
          fontSize: 13,
          color: "var(--rs-text-primary)",
          outline: "none",
        }}
      />
      {error && (
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--rs-red, #ff7676)", fontSize: 12 }}
        >
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      <button
        onClick={onSubmit}
        disabled={submitting}
        style={{
          all: "unset",
          cursor: submitting ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "12px 16px",
          fontSize: 13,
          fontWeight: 500,
          background: "var(--rs-text-primary)",
          color: "var(--rs-base)",
          borderRadius: "var(--rs-radius-md, 8px)",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? (
          <Loader2 className="animate-spin" size={13} />
        ) : (
          <ArrowRight size={13} />
        )}
        {submitting ? "Starting…" : "Analyze this repo"}
      </button>
      {!isSignedInWithGithub && (
        <MetaText>
          Public repos work without signing in. Private repos require GitHub
          sign-in.
        </MetaText>
      )}
    </div>
  );
}

function MyGithubPanel({
  isSignedIn,
  loading,
  error,
  repos,
  filtered,
  query,
  onChangeQuery,
  onRefresh,
  onPick,
  pickingFullName,
  submitError,
  onSwitchToUrl,
  onSignIn,
}: {
  isSignedIn: boolean;
  loading: boolean;
  error: string | null;
  repos: GithubRepo[] | null;
  filtered: GithubRepo[];
  query: string;
  onChangeQuery: (v: string) => void;
  onRefresh: () => void;
  onPick: (r: GithubRepo) => void;
  pickingFullName: string | null;
  submitError: string | null;
  onSwitchToUrl: () => void;
  onSignIn: () => void;
}) {
  if (!isSignedIn) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--rs-text-secondary)",
          }}
        >
          Sign in with GitHub so we can list the repositories on your account.
          You can still analyse any public repo by URL.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onSignIn}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "var(--rs-text-primary)",
              color: "var(--rs-base)",
              borderRadius: "var(--rs-radius-md, 8px)",
            }}
          >
            <Github size={13} />
            Sign in with GitHub
          </button>
          <button
            onClick={onSwitchToUrl}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "var(--rs-surface-2)",
              color: "var(--rs-text-primary)",
              border: "1px solid var(--rs-hairline-strong)",
              borderRadius: "var(--rs-radius-md, 8px)",
            }}
          >
            Paste a public URL instead
          </button>
        </div>
      </div>
    );
  }

  if (loading && !repos) {
    return (
      <div
        className="flex items-center gap-2"
        style={{ color: "var(--rs-text-muted)", fontSize: 13 }}
      >
        <Loader2 className="animate-spin" size={13} />
        Loading your GitHub repositories…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--rs-red, #ff7676)", fontSize: 13 }}
        >
          <AlertCircle size={13} />
          {error}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onRefresh}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 500,
              background: "var(--rs-surface-2)",
              color: "var(--rs-text-primary)",
              border: "1px solid var(--rs-hairline-strong)",
              borderRadius: "var(--rs-radius-md, 8px)",
            }}
          >
            <RefreshCw size={12} />
            Try again
          </button>
          <button
            onClick={onSwitchToUrl}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
            }}
          >
            Paste a URL instead
          </button>
        </div>
      </div>
    );
  }

  const list = repos ?? [];

  if (list.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--rs-text-secondary)",
          }}
        >
          No repo for analysis. Your GitHub account has no repositories we can
          read.
        </p>
        <button
          onClick={onSwitchToUrl}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 500,
            background: "var(--rs-text-primary)",
            color: "var(--rs-base)",
            borderRadius: "var(--rs-radius-md, 8px)",
            alignSelf: "flex-start",
          }}
        >
          Paste a public URL instead
          <ArrowRight size={13} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {submitError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 12px",
            background: "rgba(255,118,118,0.08)",
            border: "1px solid rgba(255,118,118,0.35)",
            borderRadius: "var(--rs-radius-md, 8px)",
            color: "var(--rs-red, #ff7676)",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <AlertCircle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 500, marginBottom: 2 }}>
              Couldn't start the analysis
            </div>
            <div>{submitError}</div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            background: "var(--rs-surface-2)",
            border: "1px solid var(--rs-hairline-strong)",
            borderRadius: "var(--rs-radius-md, 8px)",
          }}
        >
          <Search size={13} color="var(--rs-text-muted)" />
          <input
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            placeholder="Filter your repositories…"
            spellCheck={false}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 13,
              color: "var(--rs-text-primary)",
            }}
          />
        </div>
        <button
          onClick={onRefresh}
          title="Refresh"
          disabled={loading}
          style={{
            all: "unset",
            cursor: loading ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            background: "var(--rs-surface-2)",
            border: "1px solid var(--rs-hairline-strong)",
            borderRadius: "var(--rs-radius-md, 8px)",
            color: "var(--rs-text-secondary)",
          }}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={13} />
          ) : (
            <RefreshCw size={13} />
          )}
        </button>
      </div>

      <MetaText>
        {filtered.length} of {list.length} repositor
        {list.length === 1 ? "y" : "ies"}
      </MetaText>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 320,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {filtered.length === 0 ? (
          <MetaText>No repositories match “{query}”.</MetaText>
        ) : (
          filtered.map((r) => {
            const isPicking = pickingFullName === r.full_name;
            const anyPicking = pickingFullName !== null;
            return (
              <button
                key={r.id}
                onClick={() => onPick(r)}
                disabled={anyPicking}
                style={{
                  all: "unset",
                  cursor: anyPicking ? "wait" : "pointer",
                  display: "block",
                  padding: "10px 12px",
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-hairline)",
                  borderRadius: "var(--rs-radius-md, 8px)",
                  opacity: anyPicking && !isPicking ? 0.5 : 1,
                }}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      style={{
                        fontFamily: "var(--rs-font-mono)",
                        fontSize: 13,
                        color: "var(--rs-text-primary)",
                      }}
                    >
                      {r.full_name}
                    </span>
                    {r.private && (
                      <Tag size="sm">
                        <Lock size={10} /> Private
                      </Tag>
                    )}
                    {r.fork && (
                      <Tag size="sm">
                        <GitFork size={10} /> Fork
                      </Tag>
                    )}
                    {r.archived && <Tag size="sm">Archived</Tag>}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.language && <Tag size="sm">{r.language}</Tag>}
                    {r.stargazers_count > 0 && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 12,
                          color: "var(--rs-text-muted)",
                        }}
                      >
                        <Star size={11} />
                        {r.stargazers_count}
                      </span>
                    )}
                    {isPicking ? (
                      <Loader2 className="animate-spin" size={13} />
                    ) : (
                      <ArrowRight size={13} color="var(--rs-text-muted)" />
                    )}
                  </div>
                </div>
                {r.description && (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "var(--rs-text-secondary)",
                    }}
                  >
                    {r.description}
                  </p>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
