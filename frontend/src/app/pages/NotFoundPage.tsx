import { Link, useLocation } from "react-router";
import { ArrowRight, Compass } from "lucide-react";
import {
  Card,
  EmptyState,
  Eyebrow,
  Mono,
  PageHero,
  PageShell,
  Tag,
} from "../ds";

const SUGGESTIONS: { to: string; label: string; blurb: string }[] = [
  { to: "/app", label: "Overview", blurb: "What this codebase actually is." },
  { to: "/app/files", label: "Files", blurb: "Browse the source." },
  { to: "/app/graph", label: "Graph", blurb: "See the import topology." },
  { to: "/app/insights", label: "Insights", blurb: "What stands out." },
  { to: "/app/risk", label: "Risk areas", blurb: "Where things go wrong." },
  { to: "/app/ai", label: "AI workspace", blurb: "Ask grounded questions." },
];

export function NotFoundPage() {
  const location = useLocation();
  return (
    <PageShell width="narrow">
      <PageHero
        eyebrow="404 · Off the map"
        title="That page doesn't exist."
        lede={
          <>
            We couldn't find anything at <Mono>{location.pathname}</Mono>.
            Either it was renamed, or the link was off by a slash.
          </>
        }
      />

      <Card variant="raised" padding={28}>
        <EmptyState
          icon={<Compass size={18} />}
          title="Try one of these instead"
          detail="Every page below is grounded in the active repository's analysis."
        />
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          }}
        >
          {SUGGESTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              style={{ textDecoration: "none", display: "block" }}
            >
              <Card variant="flat" padding={14} interactive>
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>Go to</Eyebrow>
                  <ArrowRight size={12} color="var(--rs-text-muted)" />
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: "var(--rs-text-body)",
                    fontWeight: 500,
                    color: "var(--rs-text-primary)",
                  }}
                >
                  {s.label}
                </div>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-secondary)",
                    lineHeight: "var(--rs-leading-relaxed)",
                  }}
                >
                  {s.blurb}
                </p>
              </Card>
            </Link>
          ))}
        </div>

        <div
          className="flex items-center gap-2 flex-wrap"
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid var(--rs-hairline)",
          }}
        >
          <Eyebrow>Or jump back to</Eyebrow>
          <Link to="/app" style={{ textDecoration: "none" }}>
            <Tag size="sm" tone="info">
              Overview
            </Tag>
          </Link>
          <Link to="/app/upload" style={{ textDecoration: "none" }}>
            <Tag size="sm">Add a repository</Tag>
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}
