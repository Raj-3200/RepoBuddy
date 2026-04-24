import { useCallback, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  FileArchive,
  Github,
  Loader2,
  Lock,
  Upload as UploadIcon,
} from "lucide-react";
import { createRepository, uploadRepository } from "@/lib/api";
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
  Tag,
} from "../ds";

type Mode = "github" | "upload";

const MAX_UPLOAD_MB = 100;

// ── small helpers ──────────────────────────────────────────────────────────

function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  const tabs: { key: Mode; label: string; Icon: typeof Github }[] = [
    { key: "github", label: "GitHub URL", Icon: Github },
    { key: "upload", label: "Upload ZIP", Icon: FileArchive },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 3,
        background: "var(--rs-surface-1)",
        border: "1px solid var(--rs-hairline)",
        borderRadius: "var(--rs-radius-md)",
      }}
    >
      {tabs.map(({ key, label, Icon }) => {
        const active = key === mode;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              fontSize: "var(--rs-text-meta)",
              fontWeight: 500,
              color: active ? "var(--rs-text-primary)" : "var(--rs-text-muted)",
              background: active ? "var(--rs-surface-3)" : "transparent",
              border: active
                ? "1px solid var(--rs-hairline-strong)"
                : "1px solid transparent",
              borderRadius: "var(--rs-radius-sm)",
              transition:
                "background var(--rs-dur-fast) var(--rs-ease-standard), color var(--rs-dur-fast) var(--rs-ease-standard)",
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function FieldShell({
  children,
  monospace = false,
}: {
  children: React.ReactNode;
  monospace?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--rs-surface-1)",
        border: "1px solid var(--rs-hairline-strong)",
        borderRadius: "var(--rs-radius-md)",
        padding: monospace ? "10px 12px" : "12px 14px",
        transition: "border-color var(--rs-dur-fast) var(--rs-ease-standard)",
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const ready = !disabled && !loading;
  return (
    <button
      onClick={onClick}
      disabled={!ready}
      style={{
        all: "unset",
        cursor: ready ? "pointer" : "not-allowed",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "11px 18px",
        fontSize: "var(--rs-text-body)",
        fontWeight: 500,
        background: ready ? "var(--rs-text-primary)" : "var(--rs-surface-2)",
        color: ready ? "var(--rs-base)" : "var(--rs-text-muted)",
        borderRadius: "var(--rs-radius-md)",
        transition:
          "background var(--rs-dur-fast) var(--rs-ease-standard), color var(--rs-dur-fast) var(--rs-ease-standard)",
      }}
    >
      {loading && <Loader2 className="animate-spin" size={13} />}
      {children}
      {ready && !loading && <ArrowRight size={13} />}
    </button>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function UploadPage() {
  const navigate = useNavigate();
  const { setActiveRepo } = useAppStore();
  const [mode, setMode] = useState<Mode>("github");
  const [url, setUrl] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [token, setToken] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGithub = async () => {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const name = url
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
      const repo = await createRepository({
        name,
        url: url.trim(),
        access_token: isPrivate && token.trim() ? token.trim() : undefined,
      });
      setActiveRepo(repo.id);
      navigate("/app/progress");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create repository.");
    } finally {
      setLoading(false);
    }
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        setError("Please upload a .zip file.");
        return;
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setError(`File is over ${MAX_UPLOAD_MB} MB.`);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const repo = await uploadRepository(file);
        setActiveRepo(repo.id);
        navigate("/app/progress");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setLoading(false);
      }
    },
    [navigate, setActiveRepo],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onUrlKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleGithub();
  };

  const ready =
    mode === "github" && url.trim().length > 0 && (!isPrivate || token.trim());

  return (
    <PageShell width="narrow">
      <PageHero
        eyebrow="Add a repository"
        title="Point us at a codebase, and we'll do the rest."
        lede="Bring a public or private GitHub repo, or upload a ZIP. We'll clone it, parse it, build the dependency graph, and have an analysis ready in a couple of minutes."
      />

      <FadeIn>
        <Card variant="raised" padding={24}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <ModeTabs mode={mode} onChange={setMode} />
            <MetaText>
              No code is sent anywhere unless you choose to add a repo.
            </MetaText>
          </div>

          {error && (
            <div style={{ marginTop: 18 }}>
              <Callout
                tone="danger"
                icon={<AlertCircle size={14} />}
                title="Couldn't connect"
              >
                {error}
              </Callout>
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            {mode === "github" ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div>
                  <Eyebrow>Repository URL</Eyebrow>
                  <div style={{ marginTop: 6 }}>
                    <FieldShell>
                      <input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={onUrlKey}
                        placeholder="https://github.com/owner/repo"
                        spellCheck={false}
                        autoFocus
                        style={{
                          width: "100%",
                          background: "transparent",
                          border: "none",
                          outline: "none",
                          fontFamily: "var(--rs-font-mono)",
                          fontSize: "var(--rs-text-body)",
                          color: "var(--rs-text-primary)",
                        }}
                      />
                    </FieldShell>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsPrivate((v) => !v)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "var(--rs-text-meta)",
                    color: isPrivate
                      ? "var(--rs-text-primary)"
                      : "var(--rs-text-secondary)",
                  }}
                >
                  <Lock size={11} color="var(--rs-text-muted)" />
                  {isPrivate
                    ? "Private repo — token below"
                    : "Private repo? Add an access token"}
                </button>

                {isPrivate && (
                  <FadeIn>
                    <div>
                      <Eyebrow>Access token</Eyebrow>
                      <div style={{ marginTop: 6 }}>
                        <FieldShell monospace>
                          <input
                            type="password"
                            autoComplete="off"
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            onKeyDown={onUrlKey}
                            placeholder="ghp_…"
                            style={{
                              width: "100%",
                              background: "transparent",
                              border: "none",
                              outline: "none",
                              fontFamily: "var(--rs-font-mono)",
                              fontSize: "var(--rs-text-body)",
                              color: "var(--rs-text-primary)",
                            }}
                          />
                        </FieldShell>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <MetaText>
                          GitHub personal access token with <Mono>repo</Mono>{" "}
                          scope. Used for this clone only — we never persist it.
                        </MetaText>
                      </div>
                    </div>
                  </FadeIn>
                )}

                <div
                  className="flex items-center justify-between gap-3 flex-wrap"
                  style={{ marginTop: 4 }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tag size="sm">JavaScript</Tag>
                    <Tag size="sm">TypeScript</Tag>
                    <Tag size="sm">Python</Tag>
                    <MetaText>Other languages: best-effort.</MetaText>
                  </div>
                  <PrimaryButton
                    onClick={handleGithub}
                    disabled={!ready}
                    loading={loading}
                  >
                    {loading ? "Connecting…" : "Analyse repository"}
                  </PrimaryButton>
                </div>
              </div>
            ) : (
              <div>
                <Eyebrow>ZIP archive</Eyebrow>
                <div style={{ marginTop: 6 }}>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".zip";
                      input.onchange = () => {
                        if (input.files?.[0]) handleFile(input.files[0]);
                      };
                      input.click();
                    }}
                    style={{
                      cursor: "pointer",
                      padding: "32px 24px",
                      borderRadius: "var(--rs-radius-md)",
                      background: dragging
                        ? "var(--rs-surface-2)"
                        : "var(--rs-surface-1)",
                      border: `1px dashed ${
                        dragging
                          ? "var(--rs-accent)"
                          : "var(--rs-hairline-strong)"
                      }`,
                      textAlign: "center",
                      transition:
                        "background var(--rs-dur-fast) var(--rs-ease-standard), border-color var(--rs-dur-fast) var(--rs-ease-standard)",
                    }}
                  >
                    <div
                      style={{
                        margin: "0 auto 12px",
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        background: "var(--rs-surface-2)",
                        border: "1px solid var(--rs-hairline)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--rs-text-secondary)",
                      }}
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <UploadIcon size={16} />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--rs-text-body)",
                        fontWeight: 500,
                        color: "var(--rs-text-primary)",
                        marginBottom: 4,
                      }}
                    >
                      {loading
                        ? "Uploading…"
                        : "Drop a .zip here, or click to browse"}
                    </div>
                    <MetaText>
                      Max {MAX_UPLOAD_MB} MB · the archive is unpacked
                      server-side and parsed exactly once.
                    </MetaText>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </FadeIn>

      <Card variant="outline" padding={18}>
        <Eyebrow>What happens next</Eyebrow>
        <ol
          style={{
            margin: "10px 0 0",
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {[
            [
              "Clone or unpack",
              "We pull the source into an isolated workspace.",
            ],
            [
              "Parse symbols",
              "Tree-sitter walks every supported file and extracts top-level functions, classes, types, and imports.",
            ],
            [
              "Build the graph",
              "Imports become edges; we compute centrality, cycles, and module shape.",
            ],
            [
              "Generate insights",
              "We score quality, surface risk areas, and prepare grounded answers for the AI workspace.",
            ],
          ].map(([title, body], i) => (
            <li
              key={title}
              className="flex gap-3"
              style={{ alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-hairline)",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--rs-text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--rs-text-body)",
                    fontWeight: 500,
                    color: "var(--rs-text-primary)",
                  }}
                >
                  {title}
                </div>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: "var(--rs-text-meta)",
                    lineHeight: "var(--rs-leading-relaxed)",
                    color: "var(--rs-text-secondary)",
                  }}
                >
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </PageShell>
  );
}
