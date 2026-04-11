import { createFileRoute } from "@tanstack/react-router";
import { Navigation } from "@/components/Navigation";
import { CursorGlow } from "@/components/CursorGlow";
import { LandingHero } from "@/components/landing/hero/LandingHero";
import { ArchitectureShowcase } from "@/components/landing/showcase/ArchitectureShowcase";
import { WorkspacePreview } from "@/components/landing/workspace/WorkspacePreview";
import { LandingCapabilities } from "@/components/landing/capabilities/LandingCapabilities";
import { LandingProcess } from "@/components/landing/process/LandingProcess";
import { LandingCta } from "@/components/landing/cta/LandingCta";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RepoSage — Code intelligence for serious repositories" },
      {
        name: "description",
        content:
          "RepoSage maps architecture, traces dependencies, and explains your codebase with structural clarity.",
      },
      {
        property: "og:title",
        content: "RepoSage — Code intelligence for serious repositories",
      },
      {
        property: "og:description",
        content:
          "Map architecture, trace dependencies, and understand your repository as a system.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <CursorGlow />
      <Navigation />
      <main>
        <LandingHero />
        <ArchitectureShowcase />
        <WorkspacePreview />
        <LandingCapabilities />
        <LandingProcess />
        <LandingCta />
        <LandingFooter />
      </main>
    </div>
  );
}
