import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Github, ArrowRight, Link } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { createRepository } from "@/lib/api";
import { Logo } from "@/app/components/Logo";

export function SignIn() {
  const navigate = useNavigate();
  const { signIn, setActiveRepo, user } = useAppStore();
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in — redirect
  useEffect(() => {
    if (user) navigate("/app");
  }, [user, navigate]);

  if (user) return null;

  // Resolve absolute backend URL for the OAuth popup. Cookies set during
  // /auth/github/login MUST be readable by /auth/github/callback, so the
  // popup has to talk to the backend directly (not via the Vite proxy).
  const resolveOAuthLoginUrl = (): string => {
    const envBase = (import.meta.env.VITE_API_URL ?? "").trim();
    if (/^https?:\/\//i.test(envBase)) {
      return `${envBase.replace(/\/$/, "")}/auth/github/login`;
    }
    // Local dev fallback — backend on :8000
    return "http://localhost:8000/api/auth/github/login";
  };

  const handleGithubSignIn = () => {
    setError(null);
    setLoading(true);

    const loginUrl = resolveOAuthLoginUrl();
    const w = 600;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      loginUrl,
      "github-oauth",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`,
    );

    if (!popup) {
      setLoading(false);
      setError(
        "Popup was blocked. Please allow popups for this site and try again.",
      );
      return;
    }

    let handled = false;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== "github-oauth") return;
      handled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(closedTimer);

      if (data.error) {
        setLoading(false);
        setError(
          typeof data.error === "string"
            ? data.error
            : "GitHub sign-in failed. Please try again.",
        );
        return;
      }

      const ghUser = data.user ?? {};
      const displayName: string =
        ghUser.name || ghUser.login || "GitHub User";
      const email: string =
        ghUser.email || `${ghUser.login ?? "user"}@users.noreply.github.com`;

      try {
        if (data.token) {
          localStorage.setItem("github_access_token", String(data.token));
        }
      } catch {
        /* ignore storage errors */
      }

      signIn({
        name: displayName,
        email,
        avatarUrl: ghUser.avatar_url,
      });
      setLoading(false);
      navigate("/app");
    };

    window.addEventListener("message", onMessage);

    // If the user closes the popup without completing, reset state.
    const closedTimer = window.setInterval(() => {
      if (popup.closed) {
        clearInterval(closedTimer);
        window.removeEventListener("message", onMessage);
        if (!handled) {
          setLoading(false);
        }
      }
    }, 500);
  };

  const handleRepoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      setError("Please paste a GitHub repository URL");
      return;
    }
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+/i.test(trimmed)) {
      setError("Please enter a valid GitHub repository URL");
      return;
    }
    setLoading(true);
    try {
      const name = trimmed
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
      // Sign in as the repo owner (simulated)
      signIn({
        name: name.split("/")[0],
        email: `${name.split("/")[0]}@github.com`,
      });
      const repo = await createRepository({ name, url: trimmed });
      setActiveRepo(repo.id);
      navigate("/app/progress");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create repository");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--rs-base)" }}
    >
      {/* Ambient glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 30%, rgba(124,108,245,0.08) 0%, transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo size={32} />
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--rs-text-primary)",
            }}
          >
            RepoBuddy
          </span>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "var(--rs-surface-1)",
            border: "1px solid var(--rs-border)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
          }}
        >
          <h1
            className="text-center mb-1"
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--rs-text-primary)",
            }}
          >
            Get started
          </h1>
          <p
            className="text-center mb-6"
            style={{ fontSize: 13, color: "var(--rs-text-muted)" }}
          >
            Paste a GitHub repo URL to analyze, or sign in with GitHub
          </p>

          {/* GitHub Repo URL */}
          <form onSubmit={handleRepoSubmit} className="flex flex-col gap-3">
            <div className="relative">
              <Link
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--rs-text-muted)" }}
              />
              <input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="w-full rounded-xl pl-10 pr-4"
                style={{
                  height: 44,
                  fontSize: 14,
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-border)",
                  color: "var(--rs-text-primary)",
                  outline: "none",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(124,108,245,0.4)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--rs-border)")
                }
              />
            </div>

            {error && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--rs-red)",
                  padding: "4px 0",
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl transition-all"
              style={{
                height: 44,
                fontSize: 14,
                fontWeight: 500,
                background: "var(--rs-accent)",
                color: "white",
                border: "none",
                boxShadow: "0 0 20px rgba(124,108,245,0.3)",
                opacity: loading ? 0.7 : 1,
                cursor: loading ? "wait" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = "var(--rs-accent-hover)";
                  e.currentTarget.style.boxShadow =
                    "0 0 28px rgba(124,108,245,0.5)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--rs-accent)";
                e.currentTarget.style.boxShadow =
                  "0 0 20px rgba(124,108,245,0.3)";
              }}
            >
              {loading ? "Please wait…" : "Analyze Repository"}
              {!loading && <ArrowRight size={14} />}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div
              className="flex-1"
              style={{ height: 1, background: "var(--rs-border)" }}
            />
            <span
              style={{
                fontSize: 11,
                color: "var(--rs-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              or
            </span>
            <div
              className="flex-1"
              style={{ height: 1, background: "var(--rs-border)" }}
            />
          </div>

          {/* GitHub OAuth button */}
          <button
            onClick={handleGithubSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 rounded-xl transition-all"
            style={{
              height: 44,
              fontSize: 14,
              fontWeight: 500,
              background: "rgba(255,255,255,0.06)",
              color: "var(--rs-text-primary)",
              border: "1px solid var(--rs-border-strong)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.borderColor = "var(--rs-border-strong)";
            }}
          >
            <Github size={16} />
            Sign in with GitHub
          </button>
        </div>

        {/* Back to landing */}
        <p
          className="text-center mt-6"
          style={{ fontSize: 12, color: "var(--rs-text-muted)" }}
        >
          <button
            onClick={() => navigate("/")}
            style={{
              color: "var(--rs-text-secondary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ← Back to home
          </button>
        </p>
      </motion.div>
    </div>
  );
}
