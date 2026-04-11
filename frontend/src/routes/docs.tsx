import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/AppShell";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { getDocumentation, type DocumentationResponse } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — RepoSage" },
      {
        name: "description",
        content: "Auto-generated documentation for your codebase.",
      },
    ],
  }),
  component: DocsPage,
});

function DocsPage() {
  const { activeAnalysisId, activeRepoId } = useAppStore();
  const [docs, setDocs] = useState<DocumentationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "onboarding" | "architecture" | "modules"
  >("onboarding");

  useEffect(() => {
    if (!activeAnalysisId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getDocumentation(activeAnalysisId)
      .then(setDocs)
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

  const tabs = [
    { id: "onboarding" as const, label: "Getting Started" },
    { id: "architecture" as const, label: "Architecture" },
    { id: "modules" as const, label: "Key Modules" },
  ];

  return (
    <AppShell>
      <div className="flex h-full">
        {/* Sidebar nav */}
        <div className="w-56 border-r border-border/40 p-5 overflow-y-auto shrink-0 hidden md:block">
          <h4 className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50 mb-3 font-medium">
            Documentation
          </h4>
          <div className="space-y-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`block w-full text-left px-2.5 py-1.5 rounded-md text-[13px] transition-smooth ${
                  activeTab === tab.id
                    ? "text-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 md:p-10 max-w-2xl overflow-y-auto">
          {activeTab === "onboarding" && (
            <>
              <h1 className="text-xl font-semibold text-foreground tracking-tight mb-2">
                Getting Started
              </h1>
              {docs?.onboarding_doc ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-sans">
                    {docs.onboarding_doc}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No onboarding documentation generated yet.
                </p>
              )}
            </>
          )}

          {activeTab === "architecture" && (
            <>
              <h1 className="text-xl font-semibold text-foreground tracking-tight mb-2">
                Architecture
              </h1>
              {docs?.architecture_doc ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-sans">
                    {docs.architecture_doc}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No architecture documentation generated yet.
                </p>
              )}
            </>
          )}

          {activeTab === "modules" && (
            <>
              <h1 className="text-xl font-semibold text-foreground tracking-tight mb-2">
                Key Modules
              </h1>
              {docs?.key_modules && docs.key_modules.length > 0 ? (
                <div className="space-y-6 mt-6">
                  {docs.key_modules.map((mod) => (
                    <div
                      key={mod.name}
                      className="border-t border-border/40 pt-5"
                    >
                      <h3 className="text-base font-medium text-foreground mb-2 font-mono">
                        {mod.name}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {mod.description}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No module documentation generated yet.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
