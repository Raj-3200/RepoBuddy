import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { LAND } from "@/components/landing/layout";
import { ease, springSoft, viewportSoft } from "@/lib/motion";

const items = [
  {
    id: "map",
    title: "Architecture map",
    line: "Boundaries and flows, inferred from the graph.",
  },
  {
    id: "trace",
    title: "Dependency trace",
    line: "Follow edges from surface to storage with precision.",
  },
  {
    id: "explain",
    title: "Grounded explanation",
    line: "Answers anchored in modules you can open and verify.",
  },
] as const;

export function LandingCapabilities() {
  const [open, setOpen] = useState<string>(items[0].id);
  const detail = items.find((x) => x.id === open)!;

  return (
    <section className={`border-y ${LAND.rule} ${LAND.sectionY}`}>
      <div className={LAND.shell}>
        <motion.div
          className="max-w-2xl"
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportSoft}
          transition={{ duration: 0.75, ease }}
        >
          <p className={LAND.eyebrow}>Capabilities</p>
          <h2
            className={`${LAND.h2} mt-4 text-[clamp(1.58rem,2.75vw,2.15rem)] leading-snug sm:mt-5`}
          >
            Built for engineers who read systems.
          </h2>
        </motion.div>

        <div className="mt-14 grid gap-12 lg:mt-16 lg:grid-cols-12 lg:gap-10">
          <ul className="space-y-0 lg:col-span-5">
            {items.map((item, i) => {
              const active = open === item.id;
              return (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={viewportSoft}
                  transition={{ duration: 0.6, delay: 0.05 * i, ease }}
                  className={`border-t ${LAND.rule} last:border-b lg:last:border-b-0`}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setOpen(item.id)}
                    onFocus={() => setOpen(item.id)}
                    className={`group flex w-full items-start gap-4 rounded-md py-6 text-left outline-none transition-colors duration-200 md:py-7 ${
                      active ? "text-foreground" : "text-muted-foreground"
                    } focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
                  >
                    <span
                      className={`mt-2 h-px w-9 shrink-0 origin-left transition-[background,transform] duration-200 ${
                        active
                          ? "bg-primary"
                          : "bg-border group-hover:scale-x-110 group-hover:bg-muted-foreground/35"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block font-display text-[15px] font-semibold tracking-tight text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-1.5 block text-[13px] leading-snug text-muted-foreground lg:hidden">
                        {item.line}
                      </span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </ul>

          <div className="relative hidden min-h-[260px] lg:col-span-7 lg:block">
            <div
              className={`sticky top-28 ${LAND.radius} border border-border/35 bg-card/[0.14] p-8 shadow-inner shadow-black/15 sm:top-32 sm:p-9 lg:p-10`}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={detail.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={springSoft}
                >
                  <p
                    className={`${LAND.h2} text-[clamp(1.28rem,2.2vw,1.65rem)] leading-snug`}
                  >
                    {detail.title}
                  </p>
                  <p className={`${LAND.body} mt-5 max-w-md sm:mt-6`}>
                    {detail.line}
                  </p>
                  <div className="mt-8 h-px max-w-[11rem] bg-gradient-to-r from-primary/45 to-transparent sm:mt-10" />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
