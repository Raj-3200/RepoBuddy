const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error ?? body.detail ?? `Request failed: ${res.status}`,
    );
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
  top_modules: { name: string; file_count: number; cohesion: number }[];
  central_files: { path: string; connections: number }[];
  risk_summary: Record<string, unknown>;
  cycle_count: number;
  entry_points: { path: string; type: string }[];
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
  direct_answer?: string | null;
  explanation?: string | null;
  related_files?: string[];
  confidence?: "strong" | "moderate" | "weak" | "unknown" | null;
  confidence_rationale?: string | null;
  limitations?: string[];
  grounded?: boolean;
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
  key_modules: {
    name: string;
    description: string;
    file_count?: number;
    cohesion?: number;
    external_edges?: number;
    path?: string;
  }[];
  repo_name: string | null;
  detected_framework: string | null;
  detected_language: string | null;
  stats: {
    total_files: number;
    total_lines: number;
    total_functions: number;
    total_classes: number;
    modules: number;
    cycle_count: number;
  };
  entry_points: {
    path: string;
    name: string;
    snippet?: string;
    language?: string;
  }[];
  modules: {
    name: string;
    file_count: number;
    cohesion: number;
    external_edges: number;
    internal_edges: number;
  }[];
  central_files: { path: string; connections: number }[];
  cycles: string[][];
  risk_areas: { path: string; risk_score: number; reason: string }[];
  most_imported: { path: string; importers: number }[];
  graph_metrics: {
    density: number;
    total_edges: number;
    avg_in_degree: number;
    avg_out_degree: number;
  };
}

// ── API Functions ──

// Repositories
export const listRepositories = () =>
  request<RepositoryListResponse>("/repositories");

export const getRepository = (repoId: string) =>
  request<Repository>(`/repositories/${repoId}`);

export const createRepository = (data: {
  name: string;
  url?: string;
  access_token?: string;
}) =>
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

export const retryAnalysis = (analysisId: string, accessToken?: string) =>
  request<Analysis>(`/analyses/${analysisId}/retry`, {
    method: "POST",
    body: JSON.stringify(accessToken ? { access_token: accessToken } : {}),
  });

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

// ── Change Impact Analysis (legacy /graph/{id}/impact — used by Graph page side panel) ──

export interface ImpactedFile {
  path: string;
  distance: number;
  fan_in: number;
  fan_out: number;
  risk_score: number;
  reason: string;
}

export interface ChangeImpactResponse {
  target_file: string;
  direct_dependents: string[];
  direct_dependencies: string[];
  blast_radius: ImpactedFile[];
  total_impacted: number;
  risk_level: string;
  risk_score: number;
  suggested_review: string[];
  suggested_test_areas: string[];
  graph: GraphResponse;
}

export const getChangeImpact = (
  analysisId: string,
  filePath: string,
  depth = 3,
) =>
  request<ChangeImpactResponse>(`/graph/${analysisId}/impact`, {
    method: "POST",
    body: JSON.stringify({ file_path: filePath, depth }),
  });

// ── Evidence-based Change Impact (flagship /impact/{id}) ──

export interface ImpactedFileEvidence {
  path: string;
  module: string;
  impact_distance: number;
  is_entry_point: boolean;
  is_test: boolean;
}

export interface ImpactedModuleEvidence {
  name: string;
  impacted_files: string[];
  has_entry_points: boolean;
  max_distance: number;
  file_count: number;
}

export interface RuntimeEntryPoint {
  path: string;
  kind: string;
}

export interface SuggestedTest {
  path: string;
  reason: string;
}

export interface ImpactAnalysisResponse {
  target_path: string;
  blast_radius: number;
  blast_radius_score: number;
  blast_radius_label: string;
  direct_dependents: ImpactedFileEvidence[];
  second_order_dependents: ImpactedFileEvidence[];
  third_order_dependents: ImpactedFileEvidence[];
  affected_modules: ImpactedModuleEvidence[];
  affected_entry_points: string[];
  affected_runtime_entry_points: RuntimeEntryPoint[];
  suggested_tests: SuggestedTest[];
  safe_to_change: boolean;
  change_risk_score: number;
  change_risk_label: string;
  review_path: string[];
  reasoning: string[];
  // Change Impact + Review Guidance (MVP)
  file_summary: ImpactFileSummary;
  impact_classification: ImpactClassificationItem[];
  review_plan: ReviewPlanStep[];
  suggested_checks: SuggestedCheck[];
  related_files: RelatedFile[];
  verdict: ImpactVerdict;
  confidence: ImpactConfidence;
}

export interface ImpactFileSummary {
  name: string;
  path: string;
  module: string;
  extension: string;
  primary_category: string;
  categories: string[];
  role: string;
  summary: string;
  line_count: number;
  is_entry_point: boolean;
  runtime_kind: string | null;
}

export interface ImpactClassificationItem {
  type: string;
  label: string;
  reason: string;
}

export interface ReviewPlanStep {
  order: number;
  title: string;
  detail: string;
  files: string[];
  modules?: string[];
}

export interface SuggestedCheck {
  check: string;
  reason: string;
}

export interface RelatedFile {
  path: string;
  reason: string;
  evidence: string;
}

export interface ImpactVerdict {
  label: string; // isolated | low_risk | moderate_risk | high_risk
  headline: string;
  detail: string;
}

export interface ImpactConfidence {
  level: string; // low | medium | high
  evidence: string[];
  note: string;
}

export interface ImpactCandidate {
  path: string;
  direct_dependents: number;
  is_entry_point: boolean;
  runtime_kind: string | null;
  primary_category: string;
  role: string;
  score: number;
}

export const getImpactAnalysis = (analysisId: string, filePath: string) => {
  const params = new URLSearchParams({ file_path: filePath });
  return request<ImpactAnalysisResponse>(`/impact/${analysisId}?${params}`);
};

export const getImpactCandidates = (analysisId: string, limit = 6) => {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<ImpactCandidate[]>(
    `/impact/${analysisId}/candidates?${params}`,
  );
};

// ── Repository Health & Engineering Signals (Insights v2) ──

export interface HealthDimension {
  key: string;
  label: string;
  score: number;
  grade: "strong" | "good" | "fair" | "poor";
  measures: string[];
  contributing: string[];
  blind_spots: string[];
  confidence: string;
}

export interface HealthSignal {
  id: string;
  category: string;
  kind: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  why_it_matters: string;
  affected_files: string[];
  affected_modules: string[];
  evidence: string[];
  metrics: Record<string, number | string>;
  suggested_action: string;
  confidence: string;
  source: string;
}

export interface LongevityConcern {
  title: string;
  detail: string;
  pressure: "low" | "moderate" | "high";
  grounded_on: string[];
}

export interface PriorityFix {
  rank: number;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  why_first: string;
  affected_files: string[];
  first_action: string;
  signal_ids: string[];
}

export interface ReviewGuidanceStep {
  step: number;
  title: string;
  detail: string;
}

export interface RepoHealthResponse {
  summary: {
    total_files: number;
    total_edges: number;
    signal_count: number;
    critical_count: number;
    high_count: number;
    overall_grade: "strong" | "good" | "fair" | "poor" | "unknown";
  };
  dimensions: HealthDimension[];
  signals: HealthSignal[];
  longevity: LongevityConcern[];
  priorities: PriorityFix[];
  review_guidance: ReviewGuidanceStep[];
  coverage: { checked: string[]; not_yet_checked: string[] };
}

export const getRepoHealth = (analysisId: string) =>
  request<RepoHealthResponse>(`/insights/${analysisId}/health`);

// ── Operational Risk Surface ──

export interface RiskItem {
  id: string;
  category:
    | "coupling"
    | "blast_radius"
    | "reviewability"
    | "fragility"
    | "runtime"
    | "boundary"
    | string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  summary: string;
  what_could_go_wrong: string[];
  affected_files: string[];
  affected_modules: string[];
  review_type: string;
  evidence: string[];
  metrics: Record<string, number | string>;
  confidence: string;
}

export interface RiskSurfaceResponse {
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  items: RiskItem[];
  checked: string[];
  healthy_notes: string[];
}

export const getRiskSurface = (analysisId: string) =>
  request<RiskSurfaceResponse>(`/risk/${analysisId}`);

// ── Module Intelligence ──

export interface ModuleFile {
  path: string;
  name: string;
  fan_in: number;
  fan_out: number;
  risk_score: number;
  is_entry_point: boolean;
  symbol_count: number;
}

export interface ModuleDetail {
  name: string;
  file_count: number;
  total_lines: number;
  total_symbols: number;
  internal_edges: number;
  external_edges: number;
  cohesion: number;
  risk_score: number;
  central_files: string[];
  risky_files: string[];
  entry_points: string[];
  files: ModuleFile[];
  related_modules: string[];
  dependency_in: string[];
  dependency_out: string[];
}

export interface ModuleListResponse {
  modules: ModuleDetail[];
  total: number;
}

export const getModules = (analysisId: string) =>
  request<ModuleListResponse>(`/graph/${analysisId}/modules`);

// ── Intelligence Report ──

export interface ScoreItem {
  label: string;
  score: number;
  confidence: "high" | "medium" | "low";
  rationale: string;
}

export interface EvidenceItem {
  type: string;
  description: string;
  file_paths: string[];
  line_ranges: number[][];
  symbols: string[];
  content_snippet: string | null;
  weight: number;
}

export interface StackItem {
  technology: string;
  category: string;
  confidence_level?: "high" | "medium" | "low" | "unknown";
  confidence_score?: number;
  evidence_files: string[];
  used_in_files?: string[];
  notes: string;
  evidence_items?: EvidenceItem[];
}

export interface ProjectIdentity {
  project_type: string;
  display_name: string;
  description: string;
  confidence_level: "high" | "medium" | "low" | "unknown";
  confidence_score: number;
  confidence_label?: string;
  domain_entities: string[];
  likely_users: string[];
  key_signals: string[];
  alternative_types: Array<{ type: string; score: number }>;
  evidence_items: EvidenceItem[];
}

export interface ScoredMetric {
  name: string;
  score: number;
  label: "poor" | "fair" | "good" | "excellent";
  reasons: string[];
  evidence_files: string[];
  caveats: string[];
  raw_values: Record<string, unknown>;
}

export interface FileRisk {
  path: string;
  risk_score: number;
  risk_label: "low" | "moderate" | "high" | "critical";
  fan_in: number;
  fan_out: number;
  line_count: number;
  symbol_count: number;
  betweenness: number;
  reasons: string[];
  is_entry_point: boolean;
}

export interface AntiPattern {
  kind: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  affected_files: string[];
  recommendation: string;
}

export interface QualityReport {
  overall_score: number;
  overall_label: string;
  metrics: ScoredMetric[];
  file_risks: FileRisk[];
  anti_patterns: AntiPattern[];
  refactor_priorities: string[];
  quick_wins: string[];
}

export interface ArchitectureLayer {
  name: string;
  description: string;
  key_files: string[];
}

export interface FlowStep {
  step: number;
  description: string;
  evidence_files: string[];
  confidence: string;
}

export interface QualityPoint {
  area: string;
  assessment: "strong" | "adequate" | "weak";
  detail: string;
  evidence_files: string[];
}

export interface ComplexityHotspot {
  path: string;
  reason: string;
  fan_in: number;
  fan_out: number;
  risk_score: number;
}

export interface CritiquePoint {
  kind: "strength" | "weakness" | "risk" | "smell";
  title: string;
  detail: string;
  severity: string;
  evidence_files: string[];
}

export interface ImprovementItem {
  title: string;
  detail: string;
  effort: "quick-win" | "medium" | "architectural";
  category: string;
  evidence_files: string[];
}

export interface ConfidenceNote {
  claim: string;
  confidence: "high" | "medium" | "low";
  basis: string;
}

export interface IntelligenceReportResponse {
  summary: string;
  project_type: string;
  likely_domain: string;
  stack: StackItem[];
  identity?: ProjectIdentity | null;
  architecture_overview: string;
  architecture_layers: ArchitectureLayer[];
  app_flow: FlowStep[];
  app_flow_notes: string;
  quality_assessment: QualityPoint[];
  quality_report?: QualityReport | null;
  complexity_overview: string;
  complexity_hotspots: ComplexityHotspot[];
  optimization_notes: string;
  critique: CritiquePoint[];
  improvements: ImprovementItem[];
  confidence_notes: ConfidenceNote[];
  scores: ScoreItem[];
  repo_name: string | null;
  detected_framework: string | null;
  detected_language: string | null;
  total_files: number;
  total_lines: number;
  total_functions: number;
  total_classes: number;
}

export const getIntelligenceReport = (analysisId: string) =>
  request<IntelligenceReportResponse>(`/intelligence/${analysisId}`);
