import { motion } from "framer-motion";
import { LiveGraph } from "@/components/LiveGraph";
import { LAND } from "@/components/landing/layout";
import { ease, springSoft, viewportSoft } from "@/lib/motion";

export function WorkspacePreview() {
  return (
    <section
      id="workspace"
      className={`scroll-mt-[4.5rem] border-b ${LAND.rule} ${LAND.sectionY}`}
    >
      <div className={LAND.shell}>
        <motion.div
          className="max-w-2xl"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportSoft}
          transition={{ duration: 0.8, ease }}
        >
          <p className={LAND.eyebrow}>Workspace</p>
          <h2
            className={`${LAND.h2} mt-4 text-[clamp(1.6rem,2.75vw,2.2rem)] leading-tight sm:mt-5`}
          >
            The graph is the interface.
          </h2>
          <p className={`${LAND.body} mt-4 sm:mt-5`}>
            Dependency intelligence, framed like the product you ship.
          </p>
        </motion.div>

        <motion.div
          className={`relative mt-12 overflow-hidden ${LAND.radius} border border-border/35 bg-card/[0.12] shadow-[0_28px_72px_-36px_rgba(0,0,0,0.58)] ring-1 ring-white/[0.03] sm:mt-14`}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportSoft}
          transition={springSoft}
        >
          <header className="flex h-12 items-center justify-between border-b border-border/30 bg-background/30 px-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="flex gap-1.5 opacity-80">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              </span>
              <span className="hidden font-mono text-[11px] text-muted-foreground/65 sm:inline">
                repomirror / main
              </span>
            </div>
            <nav
              className="flex gap-6 text-[11px] font-medium tracking-wide"
              aria-label="Workspace tabs"
            >
              <span className="text-primary">Graph</span>
              <span className="text-muted-foreground/40">Files</span>
              <span className="text-muted-foreground/40">Insights</span>
            </nav>
          </header>

          <div className="relative grid min-h-[340px] md:min-h-[440px] md:grid-cols-[1fr_13.75rem]">
            <div className="relative min-h-[300px] md:min-h-0">
              <LiveGraph
                variant="panel"
                className="h-full min-h-[300px] w-full md:min-h-[440px]"
              />
              <div className="pointer-events-none absolute bottom-4 left-4 max-w-[13rem] rounded-lg border border-border/30 bg-background/92 px-3 py-2.5 shadow-sm backdrop-blur-sm sm:bottom-5 sm:left-5 sm:px-3.5 sm:py-3">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="truncate font-mono text-[10px] text-foreground/95">
                    services/core.ts
                  </span>
                </div>
                <dl className="mt-2 space-y-1 font-mono text-[10px]">
                  <div className="flex justify-between gap-6 text-muted-foreground">
                    <dt>deps</dt>
                    <dd className="tabular-nums text-foreground">12</dd>
                  </div>
                  <div className="flex justify-between gap-6 text-muted-foreground">
                    <dt>dependents</dt>
                    <dd className="tabular-nums text-foreground">8</dd>
                  </div>
                </dl>
              </div>
            </div>

            <aside className="hidden border-l border-border/25 bg-background/25 md:block">
              <div className="space-y-7 p-6">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                    Scope
                  </p>
                  <p className="mt-1.5 font-mono text-[13px] font-medium tabular-nums text-foreground">
                    892 edges
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                    Modules
                  </p>
                  <p className="mt-1.5 font-mono text-[13px] font-medium tabular-nums text-foreground">
                    147
                  </p>
                </div>
                <div className="h-px bg-border/40" />
                <p className="text-[11px] leading-[1.55] text-muted-foreground/90">
                  Selection follows structure. Pan, zoom, and follow the path
                  that matters.
                </p>
              </div>
            </aside>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
