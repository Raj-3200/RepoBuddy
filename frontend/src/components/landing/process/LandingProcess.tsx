import { motion, useInView } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { LAND } from "@/components/landing/layout";
import { ease, viewportSoft } from "@/lib/motion";

const steps = [
  {
    key: "connect",
    title: "Connect",
    line: "Point at the repository. We ingest structure, not noise.",
  },
  {
    key: "map",
    title: "Map",
    line: "Modules, edges, and entry paths resolve into a living graph.",
  },
  {
    key: "command",
    title: "Command",
    line: "Explore, query, and explain with the graph as ground truth.",
  },
] as const;

function StepBlock({
  index,
  onInView,
  children,
}: {
  index: number;
  onInView: (i: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.42, margin: "-14% 0px -8% 0px" });

  useEffect(() => {
    if (inView) onInView(index);
  }, [inView, index, onInView]);

  return (
    <div
      ref={ref}
      className="flex min-h-[min(70vh,38rem)] items-center py-14 md:min-h-[min(72vh,40rem)] md:py-20"
    >
      {children}
    </div>
  );
}

export function LandingProcess() {
  const [active, setActive] = useState(0);
  const onStepInView = useCallback((i: number) => setActive(i), []);

  return (
    <section
      id="how"
      className={`scroll-mt-[4.5rem] border-b ${LAND.rule} ${LAND.sectionYDense}`}
    >
      <div className={LAND.shell}>
        <div className="lg:grid lg:grid-cols-12 lg:gap-16 xl:gap-20">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-28 lg:max-w-xs lg:pb-20 xl:top-32">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewportSoft}
                transition={{ duration: 0.75, ease }}
              >
                <p className={LAND.eyebrow}>Flow</p>
                <h2
                  className={`${LAND.h2} mt-4 text-[clamp(1.58rem,2.75vw,2.1rem)] leading-snug sm:mt-5`}
                >
                  How understanding happens
                </h2>
              </motion.div>

              <ol className="mt-10 hidden space-y-6 lg:block">
                {steps.map((s, idx) => {
                  const on = idx === active;
                  return (
                    <li key={s.key} className="flex gap-3.5">
                      <div className="flex flex-col items-center pt-1.5">
                        <motion.span
                          className="h-2 w-2 rounded-full bg-primary"
                          animate={{
                            opacity: on ? 1 : 0.22,
                            scale: on ? 1.08 : 1,
                          }}
                          transition={{ duration: 0.3, ease }}
                        />
                      </div>
                      <div className="min-w-0 pb-0.5">
                        <p
                          className={`font-display text-[13px] font-semibold tracking-tight transition-colors duration-200 ${
                            on ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {s.title}
                        </p>
                        {on && (
                          <motion.p
                            className={`${LAND.body} mt-2 max-w-[14.5rem] text-[13px]`}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease }}
                          >
                            {s.line}
                          </motion.p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <div className="lg:col-span-8">
            {steps.map((s, i) => (
              <StepBlock key={s.key} index={i} onInView={onStepInView}>
                <motion.article
                  className="max-w-lg border-l-2 border-primary/20 pl-7 md:pl-9"
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={viewportSoft}
                  transition={{ duration: 0.72, ease, delay: 0.04 }}
                >
                  <span className="font-mono text-[10px] tracking-wide text-muted-foreground/65">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3
                    className={`${LAND.h2} mt-2 text-2xl leading-tight md:text-[1.75rem]`}
                  >
                    {s.title}
                  </h3>
                  <p className={`${LAND.body} mt-3 sm:mt-4`}>{s.line}</p>
                </motion.article>
              </StepBlock>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
