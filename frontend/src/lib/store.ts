import { create } from "zustand";

interface User {
  name: string;
  email: string;
  avatarUrl?: string;
}

interface AppState {
  activeRepoId: string | null;
  activeAnalysisId: string | null;
  user: User | null;
  setActiveRepo: (repoId: string | null) => void;
  setActiveAnalysis: (analysisId: string | null) => void;
  signIn: (user: User) => void;
  signOut: () => void;
}

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
  user: loadFromStorage<User | null>("repobuddy_user", null),
  setActiveRepo: (repoId) => {
    if (typeof window !== "undefined") {
      if (repoId)
        localStorage.setItem("repobuddy_repo_id", JSON.stringify(repoId));
      else localStorage.removeItem("repobuddy_repo_id");
      localStorage.removeItem("repobuddy_analysis_id");
    }
    set({ activeRepoId: repoId, activeAnalysisId: null });
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
  signIn: (user) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("repobuddy_user", JSON.stringify(user));
    }
    set({ user });
  },
  signOut: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("repobuddy_user");
      localStorage.removeItem("repobuddy_repo_id");
      localStorage.removeItem("repobuddy_analysis_id");
    }
    set({ user: null, activeRepoId: null, activeAnalysisId: null });
  },
}));
