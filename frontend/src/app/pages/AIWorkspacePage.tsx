import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ArrowUp,
  ChevronRight,
  FileCode,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  chatWithAI,
  type ChatResponse,
  type Citation as APICitation,
} from "@/lib/api";
import {
  Callout,
  Card,
  CardHeader,
  ConfidenceBadge,
  ConfidenceNote,
  DotSep,
  EmptyState,
  Eyebrow,
  FadeIn,
  MetaText,
  Mono,
  Path,
  Tag,
} from "../ds";
import type { Confidence } from "../ds/tokens";

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  directAnswer?: string;
  citations?: APICitation[];
  relatedFiles?: string[];
  confidence?: Confidence;
  confidenceRationale?: string;
  limitations?: string[];
  followUps?: string[];
  grounded?: boolean;
}

const SUGGESTIONS = [
  "What is this repository for?",
  "What are the riskiest files I should understand first?",
  "Where does request handling start, and how does it flow?",
  "Are there any circular dependencies I should know about?",
  "Which modules are most tightly coupled?",
];

function normaliseConfidence(c: ChatResponse["confidence"]): Confidence {
  if (c === "strong") return "strong";
  if (c === "moderate") return "moderate";
  if (c === "weak") return "weak";
  return "unknown";
}

// ── inline markdown-lite renderer ──────────────────────────────────────────

function MessageBody({ content }: { content: string }) {
  const lines = (content ?? "").split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map((line, i) => {
        if (line.trim() === "") return <div key={i} style={{ height: 4 }} />;
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return (
            <div
              key={i}
              style={{
                fontSize: "var(--rs-text-body)",
                fontWeight: 600,
                color: "var(--rs-text-primary)",
                marginTop: 6,
              }}
            >
              {line.trim().replace(/\*\*/g, "")}
            </div>
          );
        }
        const numbered = line.match(/^(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="flex gap-2" style={{ marginTop: 4 }}>
              <span
                style={{
                  color: "var(--rs-text-muted)",
                  fontSize: "var(--rs-text-body)",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 18,
                }}
              >
                {numbered[1]}.
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-relaxed)",
                  color: "var(--rs-text-secondary)",
                }}
                dangerouslySetInnerHTML={{ __html: inline(numbered[2]) }}
              />
            </div>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={i} className="flex gap-2">
              <span style={{ color: "var(--rs-text-muted)", marginTop: 2 }}>
                ·
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-relaxed)",
                  color: "var(--rs-text-secondary)",
                }}
                dangerouslySetInnerHTML={{
                  __html: inline(line.replace(/^[-*]\s+/, "")),
                }}
              />
            </div>
          );
        }
        return (
          <p
            key={i}
            style={{
              margin: 0,
              fontSize: "var(--rs-text-body)",
              lineHeight: "var(--rs-leading-relaxed)",
              color: "var(--rs-text-secondary)",
            }}
            dangerouslySetInnerHTML={{ __html: inline(line) }}
          />
        );
      })}
    </div>
  );
}

function inline(s: string): string {
  // escape minimal then apply bold + inline code
  const esc = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(
      /`([^`]+)`/g,
      `<code style="font-family:var(--rs-font-mono);font-size:11.5px;background:var(--rs-surface-2);color:var(--rs-text-primary);border:1px solid var(--rs-hairline);border-radius:4px;padding:1px 5px;">$1</code>`,
    )
    .replace(
      /\*\*([^*]+)\*\*/g,
      `<strong style="color:var(--rs-text-primary);font-weight:500;">$1</strong>`,
    );
}

// ── citation row ───────────────────────────────────────────────────────────

function CitationRow({ c }: { c: APICitation }) {
  const [open, setOpen] = useState(false);
  const range =
    c.line_start && c.line_end
      ? `L${c.line_start}–${c.line_end}`
      : c.line_start
        ? `L${c.line_start}`
        : null;
  return (
    <div
      style={{
        border: "1px solid var(--rs-hairline)",
        borderRadius: "var(--rs-radius-md)",
        background: "var(--rs-surface-1)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
        }}
      >
        <FileCode size={11} color="var(--rs-text-muted)" />
        <Path value={c.file_path} />
        {range && <Tag size="sm">{range}</Tag>}
        {c.symbol_name && (
          <Tag size="sm" tone="info">
            {c.symbol_name}
          </Tag>
        )}
        <ChevronRight
          size={11}
          color="var(--rs-text-muted)"
          style={{
            marginLeft: "auto",
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform var(--rs-dur-fast) var(--rs-ease-standard)",
          }}
        />
      </button>
      {open && c.snippet && (
        <pre
          style={{
            margin: 0,
            padding: "10px 14px",
            borderTop: "1px solid var(--rs-hairline)",
            fontSize: "var(--rs-text-meta)",
            lineHeight: 1.6,
            color: "var(--rs-text-secondary)",
            fontFamily: "var(--rs-font-mono)",
            overflowX: "auto",
            background: "var(--rs-surface-0)",
            whiteSpace: "pre",
          }}
        >
          <code>{c.snippet}</code>
        </pre>
      )}
    </div>
  );
}

// ── message bubbles ────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          background: "var(--rs-surface-2)",
          border: "1px solid var(--rs-hairline)",
          borderRadius: "var(--rs-radius-lg)",
          fontSize: "var(--rs-text-body)",
          lineHeight: "var(--rs-leading-relaxed)",
          color: "var(--rs-text-primary)",
          whiteSpace: "pre-wrap",
        }}
      >
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  onAsk,
}: {
  msg: UIMessage;
  onAsk: (q: string) => void;
}) {
  return (
    <FadeIn>
      <Card variant="raised" padding={20}>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Sparkles size={13} color="var(--rs-accent)" />
              <span>Answer</span>
            </div>
          }
          trailing={
            msg.confidence && (
              <ConfidenceBadge
                confidence={msg.confidence}
                rationale={msg.confidenceRationale}
              />
            )
          }
        />

        <div style={{ marginTop: 14 }}>
          {msg.directAnswer && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-hairline)",
                borderLeft: "2px solid var(--rs-accent)",
                borderRadius: "var(--rs-radius-md)",
              }}
            >
              <Eyebrow>Direct answer</Eyebrow>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-relaxed)",
                  color: "var(--rs-text-primary)",
                  fontWeight: 500,
                }}
              >
                {msg.directAnswer}
              </p>
            </div>
          )}

          <MessageBody content={msg.content} />

          {msg.confidenceRationale && (
            <div style={{ marginTop: 12 }}>
              <ConfidenceNote>{msg.confidenceRationale}</ConfidenceNote>
            </div>
          )}
        </div>

        {msg.limitations && msg.limitations.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Callout tone="warn" title="Limitations">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {msg.limitations.map((l, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: "var(--rs-text-body)",
                      lineHeight: "var(--rs-leading-relaxed)",
                      color: "var(--rs-text-secondary)",
                    }}
                  >
                    {l}
                  </li>
                ))}
              </ul>
            </Callout>
          </div>
        )}

        {msg.citations && msg.citations.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <Eyebrow>
              Evidence · {msg.citations.length} citation
              {msg.citations.length === 1 ? "" : "s"}
            </Eyebrow>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {msg.citations.map((c, i) => (
                <CitationRow key={i} c={c} />
              ))}
            </div>
          </div>
        )}

        {msg.relatedFiles && msg.relatedFiles.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Eyebrow>Related files</Eyebrow>
            <div
              className="flex items-center gap-2 flex-wrap"
              style={{ marginTop: 8 }}
            >
              {msg.relatedFiles.map((f) => (
                <Path key={f} value={f} />
              ))}
            </div>
          </div>
        )}

        {msg.followUps && msg.followUps.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Eyebrow>Ask next</Eyebrow>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {msg.followUps.map((q) => (
                <button
                  key={q}
                  onClick={() => onAsk(q)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    border: "1px solid var(--rs-hairline)",
                    borderRadius: "var(--rs-radius-md)",
                    fontSize: "var(--rs-text-body)",
                    color: "var(--rs-text-secondary)",
                    transition:
                      "background var(--rs-dur-fast) var(--rs-ease-standard), color var(--rs-dur-fast) var(--rs-ease-standard)",
                  }}
                  onMouseEnter={(e) => {
                    const t = e.currentTarget as HTMLButtonElement;
                    t.style.background = "var(--rs-surface-1)";
                    t.style.color = "var(--rs-text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    const t = e.currentTarget as HTMLButtonElement;
                    t.style.background = "transparent";
                    t.style.color = "var(--rs-text-secondary)";
                  }}
                >
                  <ArrowRight size={11} color="var(--rs-text-muted)" />
                  <span style={{ flex: 1 }}>{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
    </FadeIn>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function AIWorkspacePage() {
  const { activeAnalysisId } = useAppStore();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [activeAnalysisId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const userMsg: UIMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);

    if (!activeAnalysisId) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            "There is no active analysis yet. Add a repository and run an analysis, then I can answer questions grounded in your code.",
          confidence: "unknown",
        },
      ]);
      setThinking(false);
      return;
    }

    try {
      const history = messages
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));
      const resp = await chatWithAI(activeAnalysisId, trimmed, history);
      const assistantMsg: UIMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: resp.explanation || resp.message || "",
        directAnswer: resp.direct_answer ?? undefined,
        confidence: normaliseConfidence(resp.confidence),
        confidenceRationale: resp.confidence_rationale ?? undefined,
        limitations: resp.limitations ?? [],
        grounded: resp.grounded ?? true,
        relatedFiles: resp.related_files ?? [],
        citations: resp.citations ?? [],
        followUps: resp.suggested_questions ?? [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            "Something went wrong reaching the AI service. Please try again in a moment.",
          confidence: "unknown",
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const totalCitations = useMemo(
    () => messages.reduce((acc, m) => acc + (m.citations?.length ?? 0), 0),
    [messages],
  );

  if (!activeAnalysisId) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ background: "var(--rs-base)", padding: 48 }}
      >
        <div style={{ maxWidth: 420, width: "100%" }}>
          <AnalyzePlaceholder
            title="No repository selected"
            detail="Analyze a repository to see further details."
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--rs-base)", minHeight: 0 }}
    >
      {/* ── thin chrome ──────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between"
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid var(--rs-hairline)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} color="var(--rs-accent)" />
          <div>
            <div
              style={{
                fontSize: "var(--rs-text-heading)",
                fontWeight: 500,
                color: "var(--rs-text-primary)",
                letterSpacing: "var(--rs-tracking-snug)",
              }}
            >
              AI workspace
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: "var(--rs-text-muted)" }}
            >
              <MetaText>
                {activeAnalysisId
                  ? "Grounded in the active analysis"
                  : "No analysis active"}
              </MetaText>
              {totalCitations > 0 && (
                <>
                  <DotSep />
                  <MetaText>{totalCitations} citations</MetaText>
                </>
              )}
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => {
              setMessages([]);
              setInput("");
              inputRef.current?.focus();
            }}
            className="inline-flex items-center gap-2"
            style={{
              padding: "6px 11px",
              fontSize: "var(--rs-text-meta)",
              fontWeight: 500,
              color: "var(--rs-text-secondary)",
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-hairline)",
              borderRadius: "var(--rs-radius-md)",
              cursor: "pointer",
            }}
          >
            <RotateCcw size={11} />
            New session
          </button>
        )}
      </header>

      {/* ── thread / empty ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div
          style={{
            maxWidth: 820,
            margin: "0 auto",
            padding: "32px 24px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {messages.length === 0 ? (
            <FadeIn>
              <Eyebrow>AI · Grounded Q&amp;A</Eyebrow>
              <h1
                style={{
                  margin: "8px 0 12px",
                  fontSize: "var(--rs-text-display)",
                  lineHeight: "var(--rs-leading-tight)",
                  letterSpacing: "var(--rs-tracking-tight)",
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                }}
              >
                Ask anything. Get evidence.
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-relaxed)",
                  color: "var(--rs-text-secondary)",
                  maxWidth: 580,
                }}
              >
                Every answer is grounded in the analysis snapshot. Each claim
                ships with the file paths it came from, so you can verify
                exactly what the model is reading.
              </p>

              {!activeAnalysisId ? (
                <div style={{ marginTop: 24 }}>
                  <EmptyState
                    icon={<Sparkles size={16} />}
                    title="No analysis active"
                    detail="Add a repository and finish an analysis to ask grounded questions."
                  />
                </div>
              ) : (
                <div style={{ marginTop: 28 }}>
                  <Eyebrow>Try one of these</Eyebrow>
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "11px 14px",
                          background: "var(--rs-surface-1)",
                          border: "1px solid var(--rs-hairline)",
                          borderRadius: "var(--rs-radius-md)",
                          fontSize: "var(--rs-text-body)",
                          color: "var(--rs-text-secondary)",
                          transition:
                            "border-color var(--rs-dur-fast) var(--rs-ease-standard), background var(--rs-dur-fast) var(--rs-ease-standard), color var(--rs-dur-fast) var(--rs-ease-standard)",
                        }}
                        onMouseEnter={(e) => {
                          const t = e.currentTarget as HTMLButtonElement;
                          t.style.background = "var(--rs-surface-2)";
                          t.style.borderColor = "var(--rs-hairline-strong)";
                          t.style.color = "var(--rs-text-primary)";
                        }}
                        onMouseLeave={(e) => {
                          const t = e.currentTarget as HTMLButtonElement;
                          t.style.background = "var(--rs-surface-1)";
                          t.style.borderColor = "var(--rs-hairline)";
                          t.style.color = "var(--rs-text-secondary)";
                        }}
                      >
                        <span style={{ flex: 1 }}>{s}</span>
                        <ArrowRight size={11} color="var(--rs-text-muted)" />
                      </button>
                    ))}
                  </div>

                  <div style={{ marginTop: 24 }}>
                    <Card variant="outline" padding={14}>
                      <Eyebrow>What grounds an answer</Eyebrow>
                      <ul
                        style={{
                          margin: "8px 0 0",
                          paddingLeft: 18,
                          fontSize: "var(--rs-text-body)",
                          lineHeight: "var(--rs-leading-relaxed)",
                          color: "var(--rs-text-secondary)",
                        }}
                      >
                        <li>Parsed symbols and import edges from your repo.</li>
                        <li>Centrality, cycles, and module shape.</li>
                        <li>
                          Vector retrieval over the snippets we indexed — listed
                          under <Mono>Evidence</Mono> on every reply.
                        </li>
                      </ul>
                    </Card>
                  </div>
                </div>
              )}
            </FadeIn>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserMessage key={m.id} content={m.content} />
                ) : (
                  <AssistantMessage key={m.id} msg={m} onAsk={send} />
                ),
              )}
              {thinking && (
                <div
                  className="flex items-center gap-2"
                  style={{ color: "var(--rs-text-muted)" }}
                >
                  <Loader2 className="animate-spin" size={12} />
                  <MetaText>Thinking — retrieving evidence…</MetaText>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </div>

      {/* ── composer ─────────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        style={{
          borderTop: "1px solid var(--rs-hairline)",
          padding: "14px 24px 18px",
          background: "var(--rs-base)",
        }}
      >
        <div
          style={{
            maxWidth: 820,
            margin: "0 auto",
            display: "flex",
            alignItems: "flex-end",
            gap: 10,
            padding: "8px 8px 8px 14px",
            background: "var(--rs-surface-1)",
            border: "1px solid var(--rs-hairline-strong)",
            borderRadius: "var(--rs-radius-lg)",
            transition:
              "border-color var(--rs-dur-fast) var(--rs-ease-standard)",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              activeAnalysisId
                ? "Ask a question about the codebase…"
                : "Add a repository first to ask questions"
            }
            rows={1}
            disabled={thinking}
            style={{
              flex: 1,
              resize: "none",
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "var(--rs-text-body)",
              lineHeight: "var(--rs-leading-relaxed)",
              color: "var(--rs-text-primary)",
              minHeight: 22,
              maxHeight: 160,
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            style={{
              all: "unset",
              cursor: !input.trim() || thinking ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: "var(--rs-radius-md)",
              background:
                !input.trim() || thinking
                  ? "var(--rs-surface-2)"
                  : "var(--rs-text-primary)",
              color:
                !input.trim() || thinking
                  ? "var(--rs-text-muted)"
                  : "var(--rs-base)",
              transition:
                "background var(--rs-dur-fast) var(--rs-ease-standard)",
            }}
          >
            <ArrowUp size={13} />
          </button>
        </div>
        <div
          className="flex items-center gap-2"
          style={{
            maxWidth: 820,
            margin: "8px auto 0",
            color: "var(--rs-text-muted)",
          }}
        >
          <MetaText>Enter to send</MetaText>
          <DotSep />
          <MetaText>Shift + Enter for newline</MetaText>
        </div>
      </form>
    </div>
  );
}
