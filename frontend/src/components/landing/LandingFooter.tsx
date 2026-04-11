import { LAND } from "@/components/landing/layout";

export function LandingFooter() {
  return (
    <footer className={`border-t ${LAND.rule} py-10 sm:py-12`}>
      <div
        className={`${LAND.shell} flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between`}
      >
        <span className="text-[11px] tracking-wide text-muted-foreground/50">
          © {new Date().getFullYear()} RepoSage
        </span>
        <div className="flex gap-10 text-[11px] tracking-wide text-muted-foreground/50">
          <span className="cursor-default transition-colors hover:text-muted-foreground/70">
            Privacy
          </span>
          <span className="cursor-default transition-colors hover:text-muted-foreground/70">
            Terms
          </span>
        </div>
      </div>
    </footer>
  );
}
