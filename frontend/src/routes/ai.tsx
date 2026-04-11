import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/AppShell";
import { ArrowUp, Sparkles, Loader2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import {
  chatWithAI,
  getAISuggestions,
  type ChatMessage,
  type Citation,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "AI Workspace — RepoSage" },
      {
        name: "description",
        content: "Ask questions about your codebase using AI.",
      },
    ],
  }),
  component: AIPage,
});

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

function AIPage() {
  const { activeAnalysisId, activeRepoId } = useAppStore();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAnalysisId) return;
    getAISuggestions(activeAnalysisId)
      .then(setSuggestions)
      .catch(() =>
        setSuggestions([
          "What does this codebase do?",
          "What are the main modules?",
          "Show me circular dependencies",
          "Explain the architecture",
        ]),
      );
  }, [activeAnalysisId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || !activeAnalysisId) return;
    const userMsg: DisplayMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setQuery("");
    setLoading(true);

    try {
      const history: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await chatWithAI(activeAnalysisId, text, history);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.message, citations: res.citations },
      ]);
      if (res.suggested_questions.length > 0) {
        setSuggestions(res.suggested_questions);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${e instanceof Error ? e.message : "Something went wrong"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="max-w-2xl mx-auto">
            {messages.length === 0 ? (
              /* Welcome state */
              (<div className="pt-20 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mx-auto mb-6">
                  <Sparkles
                    className="w-5 h-5 text-primary/70"
                    strokeWidth={1.5}
                  />
                </div>
                <h2 className="text-lg font-semibold text-foreground tracking-tight mb-2">
                  Ask about your codebase
                </h2>
                <p className="text-sm text-muted-foreground mb-10">
                  Answers grounded in your actual code structure.
                </p>
                <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                  {suggestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-left p-3 rounded-lg border border-border/40 bg-card/15 text-[12px] text-muted-foreground leading-relaxed transition-smooth hover:border-border/40 hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>)
            ) : (
              <div className="space-y-6">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`${msg.role === "user" ? "text-right" : "text-left"}`}
                  >
                    <div
                      className={`inline-block max-w-[85%] p-4 rounded-xl text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card/30 border border-border/40 text-foreground"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/40 space-y-1">
                          {msg.citations.map((c, ci) => (
                            <div
                              key={ci}
                              className="text-[11px] font-mono text-muted-foreground"
                            >
                              {c.file_path}
                              {c.line_start ? `:${c.line_start}` : ""}
                              {c.symbol_name ? ` (${c.symbol_name})` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Thinking…
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border/40 p-4 md:px-10">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 bg-card/30 border border-border/25 rounded-xl px-4 py-2.5 transition-smooth focus-within:border-primary/30">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !loading && sendMessage(query)
                }
                placeholder="Ask about your codebase…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                disabled={loading}
              />
              <button
                onClick={() => sendMessage(query)}
                disabled={loading || !query.trim()}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth ${
                  query && !loading
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/30 text-muted-foreground/60"
                }`}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 text-center mt-2">
              Answers are based on your repository's current structure and code.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
