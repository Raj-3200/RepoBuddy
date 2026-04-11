import { create } from "zustand";

interface AppState {
  activeRepoId: string | null;
  activeAnalysisId: string | null;
  setActiveRepo: (repoId: string | null) => void;
  setActiveAnalysis: (analysisId: string | null) => void;
}

// Persist to localStorage so state survives page reloads
function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = localStorage.getItem(key);
    return val ? (JSON.parse(val) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const useAppStore = create<AppState>((set) => ({
  activeRepoId: loadFromStorage<string | null>("repobuddy_repo_id", null),
  activeAnalysisId: loadFromStorage<string | null>(
    "repobuddy_analysis_id",
    null,
  ),
  setActiveRepo: (repoId) => {
    if (typeof window !== "undefined") {
      if (repoId)
        localStorage.setItem("repobuddy_repo_id", JSON.stringify(repoId));
      else localStorage.removeItem("repobuddy_repo_id");
    }
    set({ activeRepoId: repoId });
  },
  setActiveAnalysis: (analysisId) => {
    if (typeof window !== "undefined") {
      if (analysisId)
        localStorage.setItem(
          "repobuddy_analysis_id",
          JSON.stringify(analysisId),
        );
      else localStorage.removeItem("repobuddy_analysis_id");
    }
    set({ activeAnalysisId: analysisId });
  },
}));
