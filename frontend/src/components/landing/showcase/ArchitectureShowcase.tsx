import { motion } from "framer-motion";
import { SystemGrid } from "@/components/landing/SystemGrid";
import { LAND } from "@/components/landing/layout";
import { ModuleMapSvg } from "@/components/landing/showcase/ModuleMapSvg";
import { ease, sectionFadeUp, viewportSoft } from "@/lib/motion";

export function ArchitectureShowcase() {
  return (
    <section
      id="product"
      className={`relative scroll-mt-[4.5rem] border-b ${LAND.rule} ${LAND.sectionY}`}
    >
      <div className="absolute inset-0 overflow-hidden">
        <SystemGrid className="h-full w-full" />
      </div>

      <div className={`relative ${LAND.shell}`}>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20 xl:gap-24">
          <motion.div
            variants={sectionFadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={viewportSoft}
          >
            <p className={LAND.eyebrow}>Architecture intelligence</p>
            <h2
              className={`${LAND.h2} mt-4 text-[clamp(1.65rem,2.9vw,2.45rem)] leading-[1.12] sm:mt-5`}
            >
              See the system
              <br />
              <span className="text-muted-foreground/90">before the diff.</span>
            </h2>
            <p className={`${LAND.body} mt-6 max-w-[26rem] sm:mt-7`}>
              Boundaries, flows, and ownership — composed into one calm view of
              how your repository actually behaves.
            </p>
          </motion.div>

          <motion.div
            className={`relative flex min-h-[260px] items-center justify-center ${LAND.radius} border border-border/35 bg-card/[0.12] p-8 shadow-inner shadow-black/20 sm:min-h-[300px] sm:p-10 lg:min-h-[320px] lg:p-12`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportSoft}
            transition={{ duration: 0.85, ease, delay: 0.1 }}
          >
            <div
              className={`pointer-events-none absolute inset-0 ${LAND.radius} bg-gradient-to-br from-primary/[0.035] via-transparent to-transparent`}
            />
            <ModuleMapSvg />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
