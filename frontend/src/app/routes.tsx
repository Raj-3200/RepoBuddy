import { createBrowserRouter } from "react-router";
import { Landing } from "./pages/Landing";
import { AppShell } from "./components/AppShell";
import { SignIn } from "./pages/SignIn";
import { NotFoundPage } from "./pages/NotFoundPage";

// Authenticated app routes are lazy-loaded so the landing / sign-in path
// ships a small initial bundle. Each `lazy` fn returns `{ Component }`.
const lazyApp = {
  Overview: () =>
    import("./pages/Overview").then((m) => ({ Component: m.Overview })),
  FilesPage: () =>
    import("./pages/FilesPage").then((m) => ({ Component: m.FilesPage })),
  Graph: () => import("./pages/Graph").then((m) => ({ Component: m.Graph })),
  AIWorkspacePage: () =>
    import("./pages/AIWorkspacePage").then((m) => ({
      Component: m.AIWorkspacePage,
    })),
  Insights: () =>
    import("./pages/Insights").then((m) => ({ Component: m.Insights })),
  Docs: () => import("./pages/Docs").then((m) => ({ Component: m.Docs })),
  IntelligenceReport: () =>
    import("./pages/IntelligenceReport").then((m) => ({
      Component: m.IntelligenceReport,
    })),
  Impact: () => import("./pages/Impact").then((m) => ({ Component: m.Impact })),
  RiskAreas: () =>
    import("./pages/RiskAreas").then((m) => ({ Component: m.RiskAreas })),
  UploadPage: () =>
    import("./pages/UploadPage").then((m) => ({ Component: m.UploadPage })),
  ProgressPage: () =>
    import("./pages/ProgressPage").then((m) => ({
      Component: m.ProgressPage,
    })),
};

export const router = createBrowserRouter([
  { path: "/", Component: Landing },
  { path: "/signin", Component: SignIn },
  {
    path: "/app",
    Component: AppShell,
    children: [
      { index: true, lazy: lazyApp.Overview },
      { path: "files", lazy: lazyApp.FilesPage },
      { path: "graph", lazy: lazyApp.Graph },
      { path: "ai", lazy: lazyApp.AIWorkspacePage },
      { path: "insights", lazy: lazyApp.Insights },
      { path: "docs", lazy: lazyApp.Docs },
      { path: "intelligence", lazy: lazyApp.IntelligenceReport },
      { path: "impact", lazy: lazyApp.Impact },
      { path: "risk", lazy: lazyApp.RiskAreas },
      { path: "upload", lazy: lazyApp.UploadPage },
      { path: "progress", lazy: lazyApp.ProgressPage },
      { path: "*", Component: NotFoundPage },
    ],
  },
  { path: "*", Component: NotFoundPage },
]);
