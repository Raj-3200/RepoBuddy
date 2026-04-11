import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { LAND } from "@/components/landing/layout";
import { ease, viewportSoft } from "@/lib/motion";

export function LandingCta() {
  return (
    <section
      className={`border-t ${LAND.rule} bg-gradient-to-b from-background via-background to-card/[0.35] ${LAND.sectionY}`}
    >
      <div className={LAND.shell}>
        <div className="grid gap-12 lg:grid-cols-12 lg:items-end lg:gap-16">
          <motion.div
            className="lg:col-span-7"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportSoft}
            transition={{ duration: 0.85, ease }}
          >
            <p className={LAND.eyebrow}>RepoSage</p>
            <h2
              className={`${LAND.h2} mt-4 text-[clamp(1.85rem,3.5vw,2.85rem)] leading-[1.06] sm:mt-5`}
            >
              Bring clarity
              <br />
              <span className="text-muted-foreground/90">to the next repo.</span>
            </h2>
            <p className={`${LAND.body} mt-5 max-w-md sm:mt-6`}>
              One analysis run. A graph you can trust.
            </p>
          </motion.div>

          <motion.div
            className="flex flex-col gap-3 lg:col-span-5 lg:items-end lg:pb-1"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportSoft}
            transition={{ duration: 0.8, ease, delay: 0.08 }}
          >
            <Link
              to="/upload"
              className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 text-[13px] font-medium text-primary-foreground shadow-sm shadow-primary/12 transition-[opacity,transform] duration-200 hover:opacity-[0.94] active:scale-[0.99] sm:w-auto sm:min-w-[12.5rem]"
            >
              Start analyzing
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <p className="text-center font-mono text-[10px] tracking-wide text-muted-foreground/45 lg:text-right">
              analysis · graph · context
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
