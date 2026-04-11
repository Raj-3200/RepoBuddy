import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { Navigation } from "@/components/Navigation";
import { Github, ArrowRight, Upload, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import { createRepository, uploadRepository } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Connect Repository — RepoSage" },
      {
        name: "description",
        content:
          "Link your GitHub, GitLab, or Bitbucket repository to begin analysis.",
      },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { setActiveRepo } = useAppStore();

  const handleUrlSubmit = async () => {
    if (!repoUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const name =
        repoUrl.split("/").filter(Boolean).slice(-2).join("/") || "repo";
      const repo = await createRepository({ name, url: repoUrl.trim() });
      setActiveRepo(repo.id);
      navigate({ to: "/progress", search: { repoId: repo.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect repository");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const repo = await uploadRepository(file);
      setActiveRepo(repo.id);
      navigate({ to: "/progress", search: { repoId: repo.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background">
      <Navigation />
      <div className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-3">
            Connect a repository
          </h1>
          <p className="text-sm text-muted-foreground mb-12">
            Link your repository to begin structural analysis.
          </p>

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {/* GitHub URL */}
            <button
              disabled={loading}
              onClick={() => document.getElementById("url-input")?.focus()}
              className="group w-full flex items-center gap-4 p-4 rounded-xl border border-border/30 bg-card/30 transition-smooth hover:border-border/60 hover:bg-card/50 text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center">
                <Github className="w-5 h-5 text-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground block">
                  GitHub
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Clone from a GitHub URL
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-smooth" />
            </button>

            {/* Upload ZIP */}
            <button
              disabled={loading}
              onClick={() => fileRef.current?.click()}
              className="group w-full flex items-center gap-4 p-4 rounded-xl border border-border/30 bg-card/30 transition-smooth hover:border-border/60 hover:bg-card/50 text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center">
                <Upload className="w-5 h-5 text-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground block">
                  Upload ZIP
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Upload a zipped repository
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-smooth" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileUpload}
            />

            {/* URL input */}
            <div className="pt-4">
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/40 mb-4">
                <div className="flex-1 h-px bg-border/40" />
                <span>or paste a URL</span>
                <div className="flex-1 h-px bg-border/40" />
              </div>
              <div className="flex gap-2">
                <input
                  id="url-input"
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
                  placeholder="https://github.com/org/repo"
                  className="flex-1 h-10 px-4 rounded-lg bg-card/30 border border-border/30 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 transition-smooth"
                />
                <button
                  onClick={handleUrlSubmit}
                  disabled={loading || !repoUrl.trim()}
                  className="h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-smooth hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Analyze
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
