const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ──

export interface Repository {
  id: string;
  name: string;
  source: "upload" | "github";
  url: string | null;
  description: string | null;
  detected_language: string | null;
  detected_framework: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepositoryListResponse {
  items: Repository[];
  total: number;
}

export interface Analysis {
  id: string;
  repository_id: string;
  status: string;
  current_step: string | null;
  progress: number;
  error_message: string | null;
  total_files: number;
  total_functions: number;
  total_classes: number;
  total_lines: number;
  summary_json: Record<string, unknown> | null;
  onboarding_doc: string | null;
  architecture_doc: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisProgress {
  status: string;
  current_step: string | null;
  progress: number;
  error_message: string | null;
}

export interface DashboardData {
  repository: Repository;
  analysis: Analysis | null;
  file_count: number;
  function_count: number;
  class_count: number;
  total_lines: number;
  detected_framework: string | null;
  top_modules: { name: string; count: number }[];
  central_files: { path: string; degree: number }[];
  risk_summary: Record<string, unknown>;
  cycle_count: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label: string | null;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: { total_nodes: number; total_edges: number };
}

export interface FileItem {
  id: string;
  path: string;
  name: string;
  extension: string | null;
  language: string | null;
  size_bytes: number;
  line_count: number;
  is_entry_point: boolean;
}

export interface FileTreeNode {
  id: string | null;
  name: string;
  path: string;
  is_directory: boolean;
  children: FileTreeNode[];
  extension: string | null;
  size_bytes: number;
}

export interface SymbolItem {
  id: string;
  file_path: string;
  name: string;
  symbol_type: string;
  line_start: number;
  line_end: number | null;
  signature: string | null;
  is_exported: boolean;
}

export interface FileDetail extends FileItem {
  content: string | null;
  symbols: SymbolItem[];
  imports: string[];
  dependencies: string[];
  dependents: string[];
}

export interface SearchResult {
  file_path: string;
  symbol_name: string | null;
  content: string;
  line_start: number;
  line_end: number;
  score: number;
  chunk_type: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total: number;
}

export interface Citation {
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  symbol_name: string | null;
  snippet: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  message: string;
  citations: Citation[];
  suggested_questions: string[];
}

export interface InsightItem {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affected_files: string[] | null;
}

export interface InsightListResponse {
  items: InsightItem[];
  total: number;
}

export interface DocumentationResponse {
  onboarding_doc: string | null;
  architecture_doc: string | null;
  key_modules: { name: string; description: string }[];
}

// ── API Functions ──

// Repositories
export const listRepositories = () =>
  request<RepositoryListResponse>("/repositories");

export const getRepository = (repoId: string) =>
  request<Repository>(`/repositories/${repoId}`);

export const createRepository = (data: { name: string; url?: string }) =>
  request<Repository>("/repositories", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const uploadRepository = (file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`${API_BASE}/repositories/upload`, {
    method: "POST",
    body: formData,
  }).then(async (res) => {
    if (!res.ok) throw new Error("Upload failed");
    return res.json() as Promise<Repository>;
  });
};

export const getDashboard = (repoId: string) =>
  request<DashboardData>(`/repositories/${repoId}/dashboard`);

export const deleteRepository = (repoId: string) =>
  request<void>(`/repositories/${repoId}`, { method: "DELETE" });

// Analyses
export const getAnalysis = (analysisId: string) =>
  request<Analysis>(`/analyses/${analysisId}`);

export const getAnalysisProgress = (analysisId: string) =>
  request<AnalysisProgress>(`/analyses/${analysisId}/progress`);

export const listAnalyses = (repoId: string) =>
  request<Analysis[]>(`/analyses/repository/${repoId}`);

export const retryAnalysis = (analysisId: string) =>
  request<Analysis>(`/analyses/${analysisId}/retry`, { method: "POST" });

// Graph
export const getGraph = (
  analysisId: string,
  edgeType?: string,
  limit = 200,
) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (edgeType) params.set("edge_type", edgeType);
  return request<GraphResponse>(`/graph/${analysisId}?${params}`);
};

export const getGraphNeighborhood = (
  analysisId: string,
  nodeId: string,
  depth = 1,
  edgeTypes?: string[],
) =>
  request<GraphResponse>(`/graph/${analysisId}/neighborhood`, {
    method: "POST",
    body: JSON.stringify({ node_id: nodeId, depth, edge_types: edgeTypes }),
  });

// Files
export const listFiles = (repoId: string, extension?: string) => {
  const params = extension ? `?extension=${extension}` : "";
  return request<FileItem[]>(`/files/repository/${repoId}${params}`);
};

export const getFileTree = (repoId: string) =>
  request<FileTreeNode[]>(`/files/repository/${repoId}/tree`);

export const getFileDetail = (fileId: string) =>
  request<FileDetail>(`/files/${fileId}`);

// Search
export const searchCode = (
  analysisId: string,
  query: string,
  limit = 10,
  fileFilter?: string,
) =>
  request<SearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({
      query,
      analysis_id: analysisId,
      limit,
      file_filter: fileFilter,
    }),
  });

// AI
export const chatWithAI = (
  analysisId: string,
  message: string,
  history: ChatMessage[] = [],
) =>
  request<ChatResponse>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, analysis_id: analysisId, history }),
  });

export const getAISuggestions = (analysisId: string) =>
  request<string[]>(`/ai/suggestions/${analysisId}`);

// Insights
export const getInsights = (
  analysisId: string,
  category?: string,
  severity?: string,
) => {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (severity) params.set("severity", severity);
  const qs = params.toString();
  return request<InsightListResponse>(
    `/insights/${analysisId}${qs ? `?${qs}` : ""}`,
  );
};

// Documentation
export const getDocumentation = (analysisId: string) =>
  request<DocumentationResponse>(`/documentation/${analysisId}`);

// Health (note: this is at /health, not under /api)
export const healthCheck = () =>
  fetch("/health").then(async (res) => {
    if (!res.ok) throw new Error("Health check failed");
    return res.json() as Promise<{ status: string; service: string }>;
  });
