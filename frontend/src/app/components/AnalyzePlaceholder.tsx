import { useState } from "react";
import { Plus } from "lucide-react";
import { EmptyState } from "../ds/EmptyState";
import { AnalyzeAnotherRepoModal } from "./AnalyzeAnotherRepoModal";

/**
 * AnalyzePlaceholder — unified empty state for repository-specific pages
 * when no repository/analysis has been selected. Provides a primary CTA
 * that opens the Analyze Repository modal.
 */
export function AnalyzePlaceholder({
  title = "No repository selected",
  detail = "Analyze a repository to see further details.",
}: {
  title?: string;
  detail?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmptyState
        variant="no-data"
        title={title}
        detail={detail}
        action={
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg px-4 transition-all"
            style={{
              height: 36,
              fontSize: 13,
              fontWeight: 500,
              background: "var(--rs-accent)",
              color: "white",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 2px 12px rgba(124,108,245,0.25)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--rs-accent-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--rs-accent)";
            }}
          >
            <Plus size={14} />
            Analyze a repository
          </button>
        }
      />
      <AnalyzeAnotherRepoModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
