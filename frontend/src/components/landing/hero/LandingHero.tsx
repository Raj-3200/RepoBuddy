import { motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCallback } from "react";
import { LiveGraph } from "@/components/LiveGraph";
import { LAND } from "@/components/landing/layout";
import { ease, springSoft } from "@/lib/motion";

export function LandingHero() {
  const rotateX = useSpring(useMotionValue(0), springSoft);
  const rotateY = useSpring(useMotionValue(0), springSoft);

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rotateY.set(px * 4);
      rotateX.set(-py * 3);
    },
    [rotateX, rotateY],
  );

  const onLeave = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
  }, [rotateX, rotateY]);

  const panelTransform = useMotionTemplate`perspective(1400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

  return (
    <section className="relative min-h-[min(100dvh,900px)] overflow-hidden border-b border-border/20">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_85%_60%_at_50%_-8%,oklch(0.22_0.04_188/0.12),transparent_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-background" />

      <div
        className={`relative ${LAND.shell} grid gap-12 pb-20 pt-28 sm:gap-14 sm:pb-24 sm:pt-32 lg:grid-cols-12 lg:items-center lg:gap-16 lg:pb-28 lg:pt-36`}
      >
        <div className="lg:col-span-5 lg:pr-4">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.06, ease }}
            className={LAND.eyebrow}
          >
            Code intelligence
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.14, ease }}
            className={`${LAND.h2} mt-4 text-[clamp(2.25rem,4vw,3.25rem)] leading-[1.04] sm:mt-5`}
          >
            Structure,
            <br />
            <span className="text-muted-foreground/90">not slogans.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.26, ease }}
            className={`${LAND.body} mt-6 max-w-[21rem] sm:mt-7`}
          >
            Map architecture, trace dependencies, explain the system with
            context.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.36, ease }}
            className="mt-9 flex flex-wrap items-center gap-3 sm:mt-10 sm:gap-4"
          >
            <Link
              to="/upload"
              className="group inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-[13px] font-medium text-primary-foreground shadow-sm shadow-primary/12 transition-[opacity,transform] duration-200 hover:opacity-[0.94] active:scale-[0.99]"
            >
              Start analyzing
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/docs"
              className="rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Documentation
            </Link>
          </motion.div>
        </div>

        <motion.div
          className="relative lg:col-span-7"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.2, ease }}
        >
          <div
            role="presentation"
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            className={`relative aspect-[16/11] min-h-[260px] w-full overflow-hidden ${LAND.radius} border border-border/35 bg-card/[0.15] shadow-[0_24px_64px_-28px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.04] sm:min-h-[300px] lg:aspect-auto lg:min-h-[400px]`}
            style={{ transformStyle: "preserve-3d" }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ transform: panelTransform, transformStyle: "preserve-3d" }}
            >
              <LiveGraph variant="hero" className="h-full w-full" />
            </motion.div>

            <div className="pointer-events-none absolute inset-x-0 top-0 flex h-11 items-center gap-2.5 border-b border-border/30 bg-background/40 px-4 backdrop-blur-[6px]">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/90 shadow-[0_0_10px_-2px_var(--color-primary)]" />
              <span className="font-mono text-[10px] tracking-wide text-muted-foreground/75">
                live.system.map
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
