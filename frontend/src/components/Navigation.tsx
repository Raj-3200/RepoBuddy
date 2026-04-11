import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { LAND } from "@/components/landing/layout";

const navLink =
  "rounded-md px-1.5 py-1 text-[13px] text-muted-foreground/85 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Navigation() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease }}
      className={`fixed left-0 right-0 top-0 z-50 transition-[background,border-color,box-shadow] duration-300 ${
        scrolled
          ? "border-b border-border/25 bg-background/88 shadow-[0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-background/40 backdrop-blur-[2px]"
      }`}
    >
      <div
        className={`${LAND.shell} flex h-[60px] items-center justify-between gap-4`}
      >
        <Link
          to="/"
          className="group flex shrink-0 items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/18 bg-primary/[0.06] transition-colors duration-200 group-hover:border-primary/28 group-hover:bg-primary/[0.09]">
            <svg
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="none"
              className="text-primary"
              aria-hidden
            >
              <path
                d="M2 7h3l2-4 2 8 2-4h3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="font-display text-[14px] font-semibold tracking-tight text-foreground">
            RepoSage
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:justify-between sm:gap-6 sm:pl-10 md:pl-16">
          <div className="flex min-w-0 items-center justify-end gap-1 sm:justify-start sm:gap-1">
            <Link to="/" hash="product" className={navLink}>
              Product
            </Link>
            <Link to="/graph" className={navLink}>
              Explore
            </Link>
            <Link to="/docs" className={navLink}>
              Docs
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
            <Link to="/dashboard" className={navLink}>
              Sign in
            </Link>
            <Link
              to="/upload"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[12px] font-medium text-primary-foreground shadow-sm shadow-primary/10 transition-[opacity,transform] duration-200 hover:opacity-[0.93] active:scale-[0.98] sm:px-4"
            >
              Start analyzing
            </Link>
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
