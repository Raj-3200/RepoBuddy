import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronRight,
  Sparkles,
  FileCode,
  AlertTriangle,
  ArrowRight,
  Layers,
  Loader2,
  GitBranch,
  Target,
  Eye,
  Flame,
  Share2,
  Crosshair,
  RotateCcw,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Waypoints,
  Network,
  CircleDot,
  FileSearch,
  MessageSquare,
  Navigation,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  getGraph,
  getChangeImpact,
  getModules,
  type GraphNode as APIGraphNode,
  type GraphEdge as APIGraphEdge,
  type ChangeImpactResponse,
  type ModuleDetail,
} from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────

type GraphMode =
  | "overview"
  | "dependencies"
  | "dependents"
  | "impact"
  | "hotspots"
  | "modules";

interface GNode {
  id: string;
  label: string;
  fullPath: string;
  type: string;
  module: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fanIn: number;
  fanOut: number;
  centrality: number;
  riskScore: number;
  lines: number;
  symbols: number;
  isEntryPoint: boolean;
  imports: string[];
  importedBy: string[];
}

interface GEdge {
  source: string;
  target: string;
  type: string;
  label: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function inferModule(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 2)
    return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
  return "root";
}

const MODULE_COLORS = [
  "#7C6CF5",
  "#5B9CF6",
  "#3DD68C",
  "#F5A051",
  "#F25353",
  "#E879F9",
  "#22D3EE",
  "#A3E635",
  "#FB923C",
  "#F472B6",
  "#818CF8",
  "#34D399",
  "#FBBF24",
  "#F87171",
  "#A78BFA",
];

function getModuleColor(module: string, moduleList: string[]): string {
  const idx = moduleList.indexOf(module);
  return MODULE_COLORS[idx % MODULE_COLORS.length];
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// ─── Mode Config ─────────────────────────────────────────────

const MODES: {
  id: GraphMode;
  label: string;
  icon: typeof Eye;
  desc: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Eye,
    desc: "Full architecture view",
  },
  {
    id: "dependencies",
    label: "Dependencies",
    icon: ArrowUpRight,
    desc: "What this file imports",
  },
  {
    id: "dependents",
    label: "Dependents",
    icon: ArrowDownLeft,
    desc: "What imports this file",
  },
  {
    id: "impact",
    label: "Impact",
    icon: Target,
    desc: "Blast radius analysis",
  },
  {
    id: "hotspots",
    label: "Hotspots",
    icon: Flame,
    desc: "High-risk central nodes",
  },
  {
    id: "modules",
    label: "Modules",
    icon: Network,
    desc: "Module cluster view",
  },
];

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--rs-text-secondary)" }}>{label}</span>
    </div>
  );
}

// --- Quick Actions -----------------------------------------------------

interface QuickAction {
  id: string;
  label: string;
  icon: typeof Eye;
  action: (ctx: QuickActionCtx) => void;
}

interface QuickActionCtx {
  nodes: GNode[];
  setMode: (m: GraphMode) => void;
  setSelectedNode: (n: GNode | null) => void;
  setHighlighted: (s: Set<string>) => void;
  setSearchQuery: (q: string) => void;
  focusNode: (n: GNode) => void;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "entry-points",
    label: "Entry Points",
    icon: Navigation,
    action: (ctx) => {
      const eps = ctx.nodes.filter((n) => n.isEntryPoint || n.fanIn === 0);
      ctx.setHighlighted(new Set(eps.map((n) => n.id)));
      ctx.setMode("overview");
    },
  },
  {
    id: "central-files",
    label: "Central Files",
    icon: CircleDot,
    action: (ctx) => {
      const sorted = [...ctx.nodes].sort((a, b) => b.centrality - a.centrality);
      const top = sorted.slice(
        0,
        Math.max(5, Math.ceil(ctx.nodes.length * 0.1)),
      );
      ctx.setHighlighted(new Set(top.map((n) => n.id)));
      ctx.setMode("hotspots");
    },
  },
  {
    id: "risky-files",
    label: "Risky Files",
    icon: AlertTriangle,
    action: (ctx) => {
      const risky = ctx.nodes.filter((n) => n.riskScore > 0.5);
      ctx.setHighlighted(new Set(risky.map((n) => n.id)));
      ctx.setMode("hotspots");
    },
  },
  {
    id: "isolated",
    label: "Isolated Nodes",
    icon: CircleDot,
    action: (ctx) => {
      const iso = ctx.nodes.filter((n) => n.fanIn === 0 && n.fanOut === 0);
      ctx.setHighlighted(new Set(iso.map((n) => n.id)));
    },
  },
  {
    id: "reset",
    label: "Reset View",
    icon: RotateCcw,
    action: (ctx) => {
      ctx.setHighlighted(new Set());
      ctx.setSelectedNode(null);
      ctx.setSearchQuery("");
      ctx.setMode("overview");
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function Graph() {
  const navigate = useNavigate();
  const { activeAnalysisId, activeRepoId } = useAppStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Data state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const edgesRef = useRef<GEdge[]>([]);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [moduleList, setModuleList] = useState<string[]>([]);
  const [modulesData, setModulesData] = useState<ModuleDetail[]>([]);

  // ── UI state ──
  const [mode, setMode] = useState<GraphMode>("overview");
  const [selectedNode, setSelectedNode] = useState<GNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GNode | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [impactData, setImpactData] = useState<ChangeImpactResponse | null>(
    null,
  );
  const [impactLoading, setImpactLoading] = useState(false);
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [tracedPath, setTracedPath] = useState<string[]>([]);

  // ── Canvas state ──
  const [size, setSize] = useState({ w: 800, h: 600 });
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragNodeRef = useRef<GNode | null>(null);
  const animFrameRef = useRef(0);
  const simFrameRef = useRef(0);
  const targetPanRef = useRef<{ x: number; y: number } | null>(null);
  const targetZoomRef = useRef<number | null>(null);

  // ── Adjacency maps (computed) ──
  const adjacency = useMemo(() => {
    const outMap = new Map<string, Set<string>>();
    const inMap = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!outMap.has(e.source)) outMap.set(e.source, new Set());
      outMap.get(e.source)!.add(e.target);
      if (!inMap.has(e.target)) inMap.set(e.target, new Set());
      inMap.get(e.target)!.add(e.source);
    }
    return { outMap, inMap };
  }, [edges]);

  // ── Search results ──
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.fullPath.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [searchQuery, nodes]);

  // ────────────────────────── DATA LOADING ──────────────────

  useEffect(() => {
    if (!activeAnalysisId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setSelectedNode(null);
    setHighlighted(new Set());
    setImpactData(null);
    setTracedPath([]);
    setPathSource(null);
    nodesRef.current = [];
    edgesRef.current = [];

    (async () => {
      try {
        const [graphData, modulesRes] = await Promise.all([
          getGraph(activeAnalysisId, undefined, 500),
          getModules(activeAnalysisId).catch(() => ({ modules: [], total: 0 })),
        ]);

        if (cancelled) return;

        // Build adjacency for fan-in/fan-out
        const outCount = new Map<string, number>();
        const inCount = new Map<string, number>();
        const outEdges = new Map<string, string[]>();
        const inEdges = new Map<string, string[]>();
        for (const e of graphData.edges) {
          outCount.set(e.source, (outCount.get(e.source) || 0) + 1);
          inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
          if (!outEdges.has(e.source)) outEdges.set(e.source, []);
          outEdges.get(e.source)!.push(e.target);
          if (!inEdges.has(e.target)) inEdges.set(e.target, []);
          inEdges.get(e.target)!.push(e.source);
        }

        // Module lookup from backend
        const fileModuleMap = new Map<string, string>();
        for (const mod of modulesRes.modules) {
          for (const f of mod.files) {
            fileModuleMap.set(f.path, mod.name);
          }
        }

        const maxFanIn = Math.max(1, ...Array.from(inCount.values()));
        const maxFanOut = Math.max(1, ...Array.from(outCount.values()));
        const totalN = graphData.nodes.length;
        const spread = Math.sqrt(totalN) * 60;

        const gNodes: GNode[] = graphData.nodes.map((n, i) => {
          const fi = inCount.get(n.id) || 0;
          const fo = outCount.get(n.id) || 0;
          const centrality = (fi + fo) / (maxFanIn + maxFanOut);
          const risk = Math.min(
            1,
            (fi / Math.max(maxFanIn, 1)) * 0.5 +
              (fo / Math.max(maxFanOut, 1)) * 0.3 +
              centrality * 0.2,
          );
          const lines = (n.metadata?.lines as number) || 0;
          const symbols = (n.metadata?.symbols as number) || 0;
          const isEntry = (n.metadata?.is_entry_point as boolean) || fi === 0;
          const mod = fileModuleMap.get(n.id) || inferModule(n.id);

          // Spiral layout
          const angle = (i / totalN) * Math.PI * 2 * 3 + Math.random() * 0.5;
          const dist = (i / totalN) * spread + Math.random() * 30;

          return {
            id: n.id,
            label: n.label,
            fullPath: n.id,
            type: n.type,
            module: mod,
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist,
            vx: 0,
            vy: 0,
            r: clamp(4 + centrality * 12 + (lines / 500) * 3, 4, 20),
            fanIn: fi,
            fanOut: fo,
            centrality,
            riskScore: risk,
            lines,
            symbols,
            isEntryPoint: isEntry,
            imports: outEdges.get(n.id) || [],
            importedBy: inEdges.get(n.id) || [],
          };
        });

        const gEdges: GEdge[] = graphData.edges.map((e) => ({
          source: e.source,
          target: e.target,
          type: e.type,
          label: e.label,
        }));

        const mods = [...new Set(gNodes.map((n) => n.module))].sort();

        nodesRef.current = gNodes;
        edgesRef.current = gEdges;
        setNodes(gNodes);
        setEdges(gEdges);
        setModuleList(mods);
        setModulesData(modulesRes.modules);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load graph");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAnalysisId]);

  // ────────────────────────── IMPACT ANALYSIS ───────────────

  const runImpactAnalysis = useCallback(
    async (node: GNode) => {
      if (!activeAnalysisId) return;
      setImpactLoading(true);
      setMode("impact");
      try {
        const data = await getChangeImpact(activeAnalysisId, node.fullPath, 3);
        setImpactData(data);
        // Highlight all impacted nodes
        const impacted = new Set<string>([
          node.id,
          ...data.direct_dependents,
          ...data.blast_radius.map((f) => f.path),
        ]);
        setHighlighted(impacted);
      } catch {
        setImpactData(null);
      } finally {
        setImpactLoading(false);
      }
    },
    [activeAnalysisId],
  );

  // ────────────────────────── PATH TRACING ──────────────────

  const tracePath = useCallback(
    (fromId: string, toId: string) => {
      // BFS shortest path
      const queue: string[][] = [[fromId]];
      const visited = new Set<string>([fromId]);
      while (queue.length > 0) {
        const path = queue.shift()!;
        const current = path[path.length - 1];
        if (current === toId) {
          setTracedPath(path);
          setHighlighted(new Set(path));
          return;
        }
        const neighbors = [
          ...(adjacency.outMap.get(current) || []),
          ...(adjacency.inMap.get(current) || []),
        ];
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push([...path, nb]);
          }
        }
      }
      setTracedPath([]);
    },
    [adjacency],
  );

  // ────────────────────────── MODE EFFECTS ──────────────────

  useEffect(() => {
    if (mode === "hotspots") {
      const sorted = [...nodes].sort((a, b) => b.centrality - a.centrality);
      const top = sorted.slice(0, Math.max(5, Math.ceil(nodes.length * 0.1)));
      setHighlighted(new Set(top.map((n) => n.id)));
    } else if (mode === "dependencies" && selectedNode) {
      setHighlighted(new Set([selectedNode.id, ...selectedNode.imports]));
    } else if (mode === "dependents" && selectedNode) {
      setHighlighted(new Set([selectedNode.id, ...selectedNode.importedBy]));
    } else if (mode === "modules") {
      setHighlighted(new Set());
    } else if (mode === "overview") {
      if (highlighted.size > 0 && !selectedNode) setHighlighted(new Set());
    }
  }, [mode, selectedNode?.id]);

  // ────────────────────────── NODE SELECTION ────────────────

  const selectNode = useCallback(
    (node: GNode | null) => {
      setSelectedNode(node);
      if (node) {
        setDetailsOpen(true);
        // In graph modes, update highlights
        if (mode === "dependencies") {
          setHighlighted(new Set([node.id, ...node.imports]));
        } else if (mode === "dependents") {
          setHighlighted(new Set([node.id, ...node.importedBy]));
        }
      } else {
        setDetailsOpen(false);
        setImpactData(null);
        if (mode === "dependencies" || mode === "dependents") {
          setHighlighted(new Set());
        }
      }
    },
    [mode],
  );

  const focusNode = useCallback((node: GNode) => {
    targetPanRef.current = { x: -node.x, y: -node.y };
    targetZoomRef.current = 1.5;
  }, []);

  // ────────────────────────── RESIZE ────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ────────────────────────── SIMULATION + RENDER ───────────

  useEffect(() => {
    if (loading || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    simFrameRef.current = 0;

    const tick = () => {
      animFrameRef.current = requestAnimationFrame(tick);
      simFrameRef.current++;

      const ns = nodesRef.current;
      const es = edgesRef.current;
      if (!ns.length) return;

      // ── Resize canvas ──
      const w = size.w;
      const h = size.h;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ── Physics (first 200 frames) ──
      if (simFrameRef.current < 200) {
        const n = ns.length;
        const repulsion = n > 120 ? 600 : n > 60 ? 400 : 250;
        const centerGravity = 0.0003;
        const damping = 0.88;

        // Repulsion
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            let dx = ns[j].x - ns[i].x;
            let dy = ns[j].y - ns[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = repulsion / (dist * dist);
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            ns[i].vx -= dx;
            ns[i].vy -= dy;
            ns[j].vx += dx;
            ns[j].vy += dy;
          }
        }

        // Attraction along edges
        const nodeMap = new Map(ns.map((nd) => [nd.id, nd]));
        for (const e of es) {
          const s = nodeMap.get(e.source);
          const t = nodeMap.get(e.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 80) * 0.003;
          s.vx += (dx / dist) * force;
          s.vy += (dy / dist) * force;
          t.vx -= (dx / dist) * force;
          t.vy -= (dy / dist) * force;
        }

        // Center gravity + damping + integrate
        for (const nd of ns) {
          nd.vx -= nd.x * centerGravity;
          nd.vy -= nd.y * centerGravity;
          nd.vx *= damping;
          nd.vy *= damping;
          nd.x += nd.vx;
          nd.y += nd.vy;
        }
      }

      // ── Auto-fit at frame 100 ──
      if (simFrameRef.current === 100 && ns.length > 0) {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const nd of ns) {
          minX = Math.min(minX, nd.x);
          maxX = Math.max(maxX, nd.x);
          minY = Math.min(minY, nd.y);
          maxY = Math.max(maxY, nd.y);
        }
        const gw = maxX - minX || 1;
        const gh = maxY - minY || 1;
        const fitZoom = Math.min((w * 0.8) / gw, (h * 0.8) / gh, 2);
        zoomRef.current = fitZoom;
        setZoom(fitZoom);
        panRef.current = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 };
      }

      // ── Smooth pan/zoom transitions ──
      if (targetPanRef.current) {
        panRef.current.x = lerp(panRef.current.x, targetPanRef.current.x, 0.08);
        panRef.current.y = lerp(panRef.current.y, targetPanRef.current.y, 0.08);
        const dx = Math.abs(panRef.current.x - targetPanRef.current!.x);
        const dy = Math.abs(panRef.current.y - targetPanRef.current!.y);
        if (dx < 0.5 && dy < 0.5) targetPanRef.current = null;
      }
      if (targetZoomRef.current !== null) {
        zoomRef.current = lerp(zoomRef.current, targetZoomRef.current, 0.08);
        if (Math.abs(zoomRef.current - targetZoomRef.current) < 0.005) {
          zoomRef.current = targetZoomRef.current;
          targetZoomRef.current = null;
        }
        setZoom(zoomRef.current);
      }

      // ── Clear & transform ──
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoomRef.current, zoomRef.current);
      ctx.translate(panRef.current.x, panRef.current.y);

      const zm = zoomRef.current;
      const isModuleMode = mode === "modules";
      const hasHighlight = highlighted.size > 0;
      const selId = selectedNode?.id ?? null;
      const hovId = hoveredNode?.id ?? null;
      const tracedSet = new Set(tracedPath);
      const hasTrace = tracedPath.length > 1;

      // ── Module backgrounds (modules mode) ──
      if (isModuleMode && ns.length > 0) {
        const modGroups = new Map<string, GNode[]>();
        for (const nd of ns) {
          if (!modGroups.has(nd.module)) modGroups.set(nd.module, []);
          modGroups.get(nd.module)!.push(nd);
        }
        modGroups.forEach((group, mod) => {
          if (group.length < 2) return;
          let cx = 0,
            cy = 0;
          for (const nd of group) {
            cx += nd.x;
            cy += nd.y;
          }
          cx /= group.length;
          cy /= group.length;
          let maxDist = 0;
          for (const nd of group) {
            const d = Math.sqrt((nd.x - cx) ** 2 + (nd.y - cy) ** 2);
            if (d > maxDist) maxDist = d;
          }
          const color = getModuleColor(mod, moduleList);
          ctx.beginPath();
          ctx.arc(cx, cy, maxDist + 30, 0, Math.PI * 2);
          ctx.fillStyle = color + "08";
          ctx.strokeStyle = color + "18";
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          // Module label
          ctx.fillStyle = color + "60";
          ctx.font = `${Math.max(9, 11 / zm)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(mod, cx, cy - maxDist - 12);
        });
      }

      // ── Draw edges ──
      const nodeMap = new Map(ns.map((nd) => [nd.id, nd]));
      for (const e of es) {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) continue;

        let alpha = 0.12;
        let width = 0.8;
        let color = "255,255,255";

        // Path trace
        if (hasTrace) {
          const sInTrace = tracedSet.has(e.source);
          const tInTrace = tracedSet.has(e.target);
          if (sInTrace && tInTrace) {
            // Check if consecutive in path
            let isPathEdge = false;
            for (let k = 0; k < tracedPath.length - 1; k++) {
              if (
                (tracedPath[k] === e.source &&
                  tracedPath[k + 1] === e.target) ||
                (tracedPath[k] === e.target && tracedPath[k + 1] === e.source)
              ) {
                isPathEdge = true;
                break;
              }
            }
            if (isPathEdge) {
              alpha = 0.8;
              width = 2.5;
              color = "124,108,245";
            } else {
              alpha = 0.04;
            }
          } else {
            alpha = 0.04;
          }
        } else if (hasHighlight) {
          const sH = highlighted.has(e.source);
          const tH = highlighted.has(e.target);
          if (sH && tH) {
            alpha = 0.35;
            width = 1.5;
            if (mode === "impact") color = "242,83,83";
            else if (mode === "dependencies") color = "91,156,246";
            else if (mode === "dependents") color = "245,160,81";
            else color = "124,108,245";
          } else {
            alpha = 0.03;
          }
        } else if (selId) {
          if (e.source === selId || e.target === selId) {
            alpha = 0.4;
            width = 1.5;
            color = "124,108,245";
          } else {
            alpha = 0.05;
          }
        } else if (hovId) {
          if (e.source === hovId || e.target === hovId) {
            alpha = 0.3;
            width = 1.2;
            color = "124,108,245";
          } else {
            alpha = 0.06;
          }
        }

        if (isModuleMode) {
          const sn = nodeMap.get(e.source);
          const tn = nodeMap.get(e.target);
          if (sn && tn && sn.module !== tn.module) {
            alpha = Math.max(alpha, 0.08);
            color = "245,160,81";
          }
        }

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = width / zm;
        ctx.stroke();

        // Arrow head for highlighted edges
        if (alpha > 0.25 && width > 1) {
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const arrowLen = 6 / zm;
          const ax = t.x - (dx / len) * (t.r + 2);
          const ay = t.y - (dy / len) * (t.r + 2);
          const angle = Math.atan2(dy, dx);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(
            ax - arrowLen * Math.cos(angle - 0.35),
            ay - arrowLen * Math.sin(angle - 0.35),
          );
          ctx.lineTo(
            ax - arrowLen * Math.cos(angle + 0.35),
            ay - arrowLen * Math.sin(angle + 0.35),
          );
          ctx.closePath();
          ctx.fillStyle = `rgba(${color}, ${alpha * 0.8})`;
          ctx.fill();
        }
      }

      // ── Draw nodes ──
      for (const nd of ns) {
        let alpha = 1;
        let fillColor = getModuleColor(nd.module, moduleList);
        let strokeColor = fillColor;
        let strokeWidth = 0;
        let nodeR = nd.r;
        let glowRadius = 0;

        // Hotspot mode: size by centrality
        if (mode === "hotspots") {
          nodeR = clamp(4 + nd.centrality * 20, 4, 24);
          if (nd.riskScore > 0.6) {
            fillColor = "#F25353";
            strokeColor = "#F25353";
          } else if (nd.riskScore > 0.35) {
            fillColor = "#F5A051";
            strokeColor = "#F5A051";
          }
        }

        // Impact mode coloring
        if (mode === "impact" && impactData && highlighted.size > 0) {
          if (nd.id === impactData.target_file) {
            fillColor = "#F25353";
            strokeColor = "#F25353";
            strokeWidth = 2;
            glowRadius = 12;
          } else if (impactData.direct_dependents.includes(nd.id)) {
            fillColor = "#F5A051";
            strokeColor = "#F5A051";
          } else if (highlighted.has(nd.id)) {
            fillColor = "#FBBF24";
            strokeColor = "#FBBF24";
            alpha = 0.7;
          }
        }

        // Dimming
        if (hasHighlight && !highlighted.has(nd.id)) {
          alpha = 0.12;
        }
        if (hasTrace && !tracedSet.has(nd.id)) {
          alpha = 0.1;
        }
        if (!hasHighlight && !hasTrace && selId && selId !== nd.id) {
          const isNeighbor =
            adjacency.outMap.get(selId)?.has(nd.id) ||
            adjacency.inMap.get(selId)?.has(nd.id);
          if (!isNeighbor) alpha = 0.2;
        }

        // Hover / select
        if (nd.id === hovId && nd.id !== selId) {
          strokeWidth = 1.5;
          glowRadius = 6;
        }
        if (nd.id === selId) {
          strokeWidth = 3;
          glowRadius = 22;
          // Pulse
          const pulse = Math.sin(simFrameRef.current * 0.05) * 0.15 + 0.85;
          nodeR *= pulse;
        }

        // Glow
        if (glowRadius > 0 && alpha > 0.3) {
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, nodeR + glowRadius / zm, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(
            nd.x,
            nd.y,
            nodeR,
            nd.x,
            nd.y,
            nodeR + glowRadius / zm,
          );
          grad.addColorStop(0, fillColor + "30");
          grad.addColorStop(1, fillColor + "00");
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nodeR / zm < 1.5 ? nodeR : nodeR, 0, Math.PI * 2);
        ctx.fillStyle =
          alpha < 1
            ? fillColor +
              Math.round(alpha * 255)
                .toString(16)
                .padStart(2, "0")
            : fillColor;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        if (strokeWidth > 0 && alpha > 0.3) {
          ctx.strokeStyle =
            strokeColor +
            Math.round(alpha * 200)
              .toString(16)
              .padStart(2, "0");
          ctx.lineWidth = strokeWidth / zm;
          ctx.stroke();
        }

        // Selected focus ring (separates from regular hover)
        if (nd.id === selId) {
          const ringR = nodeR + 6 / zm;
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = strokeColor + "AA";
          ctx.lineWidth = 1.5 / zm;
          ctx.setLineDash([3 / zm, 3 / zm]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Label (only if zoomed enough or node is important)
        if ((zm > 0.6 && alpha > 0.3) || nd.id === selId || nd.id === hovId) {
          const fontSize = Math.max(8, Math.min(11, 10 / zm));
          ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle =
            alpha < 0.5
              ? `rgba(240,239,237,${alpha * 0.6})`
              : nd.id === selId
                ? "#F0EFED"
                : `rgba(240,239,237,0.7)`;
          ctx.fillText(nd.label, nd.x, nd.y + nodeR + fontSize + 2);
        }
      }

      ctx.restore();
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [
    size,
    loading,
    mode,
    selectedNode?.id,
    hoveredNode?.id,
    highlighted,
    tracedPath,
    moduleList,
    impactData,
  ]);

  // ────────────────────────── MOUSE INTERACTION ─────────────

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - size.w / 2) / zoomRef.current - panRef.current.x,
      y: (sy - size.h / 2) / zoomRef.current - panRef.current.y,
    }),
    [size],
  );

  const findNodeAt = useCallback((wx: number, wy: number) => {
    const ns = nodesRef.current;
    let best: GNode | null = null;
    let bestDist = Infinity;
    for (const nd of ns) {
      const d = Math.sqrt((nd.x - wx) ** 2 + (nd.y - wy) ** 2);
      const hitR = Math.max(nd.r, 8) / zoomRef.current + 4;
      if (d < hitR && d < bestDist) {
        best = nd;
        bestDist = d;
      }
    }
    return best;
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const w = screenToWorld(sx, sy);
      const node = findNodeAt(w.x, w.y);

      if (node) {
        dragNodeRef.current = node;
      } else {
        draggingRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
      }
    },
    [screenToWorld, findNodeAt],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragNodeRef.current) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        dragNodeRef.current.x = w.x;
        dragNodeRef.current.y = w.y;
        dragNodeRef.current.vx = 0;
        dragNodeRef.current.vy = 0;
        return;
      }
      if (draggingRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        panRef.current.x += dx / zoomRef.current;
        panRef.current.y += dy / zoomRef.current;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        targetPanRef.current = null;
        return;
      }
      // Hover
      const rect = canvasRef.current!.getBoundingClientRect();
      const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const node = findNodeAt(w.x, w.y);
      setHoveredNode(node);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? "pointer" : "grab";
      }
    },
    [screenToWorld, findNodeAt],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragNodeRef.current) {
        // Check if it was a click (not drag)
        const rect = canvasRef.current!.getBoundingClientRect();
        const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const node = findNodeAt(w.x, w.y);
        if (node && node.id === dragNodeRef.current.id) {
          // Path tracing: if pathSource is set, trace from it to this node
          if (pathSource && pathSource !== node.id) {
            tracePath(pathSource, node.id);
            setPathSource(null);
          } else {
            selectNode(node);
            focusNode(node);
          }
        }
        dragNodeRef.current = null;
        return;
      }
      if (draggingRef.current) {
        draggingRef.current = false;
        return;
      }
      // Click on empty space
      selectNode(null);
      setTracedPath([]);
      setPathSource(null);
    },
    [screenToWorld, findNodeAt, selectNode, focusNode, pathSource, tracePath],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    zoomRef.current = clamp(zoomRef.current * factor, 0.1, 5);
    setZoom(zoomRef.current);
    targetZoomRef.current = null;
  }, []);

  // ── Zoom controls ──
  const zoomIn = () => {
    targetZoomRef.current = clamp(zoomRef.current * 1.3, 0.1, 5);
  };
  const zoomOut = () => {
    targetZoomRef.current = clamp(zoomRef.current / 1.3, 0.1, 5);
  };
  const fitAll = () => {
    const ns = nodesRef.current;
    if (!ns.length) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const nd of ns) {
      minX = Math.min(minX, nd.x);
      maxX = Math.max(maxX, nd.x);
      minY = Math.min(minY, nd.y);
      maxY = Math.max(maxY, nd.y);
    }
    const gw = maxX - minX || 1;
    const gh = maxY - minY || 1;
    targetZoomRef.current = clamp(
      Math.min((size.w * 0.8) / gw, (size.h * 0.8) / gh),
      0.15,
      2,
    );
    targetPanRef.current = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 };
  };

  // ── Stats ──
  const stats = useMemo(() => {
    const totalEdges = edges.length;
    const avgFanIn =
      nodes.length > 0
        ? (nodes.reduce((s, n) => s + n.fanIn, 0) / nodes.length).toFixed(1)
        : "0";
    const hotspots = nodes.filter((n) => n.riskScore > 0.5).length;
    return { totalEdges, avgFanIn, hotspots, modules: moduleList.length };
  }, [nodes, edges, moduleList]);

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════

  if (!activeAnalysisId) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ background: "var(--rs-base)", padding: 48 }}
      >
        <div style={{ maxWidth: 420, width: "100%" }}>
          <AnalyzePlaceholder
            title="No repository selected"
            detail="Analyze a repository to see further details."
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: "var(--rs-base)" }}
    >
      {/* -- Top Control Bar -- */}
      <div
        className="flex items-center gap-2 px-4 shrink-0"
        style={{
          height: 48,
          borderBottom: "1px solid var(--rs-hairline-strong)",
          background: "var(--rs-surface-1)",
        }}
      >
        {/* Mode Switcher */}
        <div className="flex items-center gap-0.5 mr-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.desc}
                className="flex items-center gap-1.5 px-2.5 py-1.5 transition-all"
                style={{
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  letterSpacing: "var(--rs-tracking-snug)",
                  borderRadius: "var(--rs-radius-md)",
                  color: active
                    ? "var(--rs-text-primary)"
                    : "var(--rs-text-secondary)",
                  background: active ? "var(--rs-surface-2)" : "transparent",
                  boxShadow: active
                    ? "inset 0 0 0 1px var(--rs-hairline-strong)"
                    : "none",
                  transition:
                    "background var(--rs-dur-fast) var(--rs-ease-standard), color var(--rs-dur-fast) var(--rs-ease-standard)",
                }}
              >
                <Icon size={13} />
                <span className="hidden xl:inline">{m.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative" style={{ width: 220 }}>
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--rs-text-muted)" }}
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="Search files�"
            className="w-full pl-8 pr-8 py-1.5 outline-none"
            style={{
              fontSize: 11,
              background: "var(--rs-base)",
              border: "1px solid var(--rs-hairline-strong)",
              borderRadius: "var(--rs-radius-md)",
              color: "var(--rs-text-primary)",
              transition:
                "border-color var(--rs-dur-fast) var(--rs-ease-standard)",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                setHighlighted(new Set());
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: "var(--rs-text-muted)" }}
            >
              <X size={12} />
            </button>
          )}

          {/* Search dropdown */}
          <AnimatePresence>
            {searchFocused && searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="absolute top-full left-0 right-0 mt-1 overflow-hidden z-50"
                style={{
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-hairline-strong)",
                  borderRadius: "var(--rs-radius-lg)",
                  boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
                }}
              >
                {searchResults.map((n) => (
                  <button
                    key={n.id}
                    onMouseDown={() => {
                      selectNode(n);
                      focusNode(n);
                      setHighlighted(
                        new Set([n.id, ...n.imports, ...n.importedBy]),
                      );
                      setSearchQuery("");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                    style={{ fontSize: 11, color: "var(--rs-text-primary)" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--rs-surface-3)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <FileCode
                      size={12}
                      style={{
                        color: getModuleColor(n.module, moduleList),
                        flexShrink: 0,
                      }}
                    />
                    <div className="min-w-0">
                      <div className="truncate" style={{ fontWeight: 500 }}>
                        {n.label}
                      </div>
                      <div
                        className="truncate"
                        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
                      >
                        {n.fullPath}
                      </div>
                    </div>
                    <div
                      className="ml-auto shrink-0 flex items-center gap-1"
                      style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
                    >
                      <span>{n.fanIn}↓</span>
                      <span>{n.fanOut}↑</span>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-2 ml-3">
          {[
            { label: "Nodes", value: nodes.length },
            { label: "Edges", value: stats.totalEdges },
            { label: "Modules", value: stats.modules },
            {
              label: "Hotspots",
              value: stats.hotspots,
              warn: stats.hotspots > 0,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-1.5 px-2 py-1"
              style={{
                fontSize: 10,
                letterSpacing: "var(--rs-tracking-snug)",
                color: s.warn ? "var(--rs-amber)" : "var(--rs-text-muted)",
                border: "1px solid var(--rs-hairline)",
                borderRadius: "var(--rs-radius-pill)",
                background: "transparent",
              }}
            >
              <span>{s.label}</span>
              <span
                style={{
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                  color: s.warn ? "var(--rs-amber)" : "var(--rs-text-primary)",
                }}
              >
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* -- Main Area -- */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Quick Actions Sidebar (left) */}
        <div
          className="shrink-0 flex flex-col gap-1 p-2"
          style={{
            width: 44,
            borderRight: "1px solid var(--rs-hairline-strong)",
            background: "var(--rs-surface-1)",
          }}
        >
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                onClick={() =>
                  qa.action({
                    nodes,
                    setMode,
                    setSelectedNode: selectNode,
                    setHighlighted,
                    setSearchQuery,
                    focusNode,
                  })
                }
                title={qa.label}
                className="flex items-center justify-center rounded-md transition-all"
                style={{
                  width: 28,
                  height: 28,
                  color: "var(--rs-text-muted)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--rs-text-primary)";
                  e.currentTarget.style.background = "var(--rs-surface-3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--rs-text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon size={14} />
              </button>
            );
          })}

          <div className="flex-1" />

          {/* Zoom controls */}
          <button
            onClick={zoomIn}
            title="Zoom in"
            className="flex items-center justify-center rounded-md"
            style={{ width: 28, height: 28, color: "var(--rs-text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--rs-text-primary)";
              e.currentTarget.style.background = "var(--rs-surface-3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--rs-text-muted)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={zoomOut}
            title="Zoom out"
            className="flex items-center justify-center rounded-md"
            style={{ width: 28, height: 28, color: "var(--rs-text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--rs-text-primary)";
              e.currentTarget.style.background = "var(--rs-surface-3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--rs-text-muted)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={fitAll}
            title="Fit to viewport"
            className="flex items-center justify-center rounded-md"
            style={{ width: 28, height: 28, color: "var(--rs-text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--rs-text-primary)";
              e.currentTarget.style.background = "var(--rs-surface-3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--rs-text-muted)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Maximize2 size={14} />
          </button>

          <div
            className="mt-1 text-center"
            style={{ fontSize: 9, color: "var(--rs-text-muted)" }}
          >
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* -- Canvas -- */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          style={{
            background:
              "radial-gradient(circle at 50% 45%, rgba(229,140,82,0.04), transparent 60%), radial-gradient(circle at 80% 80%, rgba(82,143,229,0.03), transparent 55%), var(--rs-base)",
          }}
        >
          {loading ? (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: "var(--rs-base)" }}
            >
              <div
                className="flex flex-col items-center gap-3"
                style={{ maxWidth: 320, textAlign: "center" }}
              >
                <Loader2
                  size={18}
                  className="animate-spin"
                  style={{ color: "var(--rs-accent)" }}
                />
                <div
                  style={{
                    fontSize: "var(--rs-text-meta)",
                    letterSpacing: "var(--rs-tracking-wide)",
                    textTransform: "uppercase",
                    color: "var(--rs-text-muted)",
                  }}
                >
                  Computing layout
                </div>
                <div
                  style={{
                    fontSize: "var(--rs-text-body)",
                    color: "var(--rs-text-secondary)",
                    lineHeight: "var(--rs-leading-relaxed)",
                  }}
                >
                  Building the dependency graph and resolving the force layout.
                </div>
              </div>
            </div>
          ) : error ? (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: "var(--rs-base)", padding: 32 }}
            >
              <div
                style={{
                  maxWidth: 360,
                  padding: 18,
                  background: "var(--rs-surface-1)",
                  border: "1px solid var(--rs-hairline-strong)",
                  borderRadius: "var(--rs-radius-lg)",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <AlertTriangle
                  size={16}
                  style={{
                    color: "var(--rs-sev-high)",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: "var(--rs-text-heading)",
                      fontWeight: 500,
                      color: "var(--rs-text-primary)",
                      marginBottom: 4,
                    }}
                  >
                    Couldn't load the graph
                  </div>
                  <div
                    style={{
                      fontSize: "var(--rs-text-body)",
                      color: "var(--rs-text-secondary)",
                      lineHeight: "var(--rs-leading-relaxed)",
                    }}
                  >
                    {error}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              style={{ width: "100%", height: "100%", cursor: "grab" }}
            />
          )}

          {/* Mode hint (top-left) */}
          {!loading && !error && (
            <div
              className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-hairline)",
                borderRadius: "var(--rs-radius-md)",
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-secondary)",
                pointerEvents: "none",
                maxWidth: 280,
              }}
            >
              {(() => {
                const cur = MODES.find((m) => m.id === mode);
                if (!cur) return null;
                const Icon = cur.icon;
                return (
                  <>
                    <Icon size={12} style={{ color: "var(--rs-accent)" }} />
                    <span
                      style={{
                        color: "var(--rs-text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      {cur.label}
                    </span>
                    <span style={{ color: "var(--rs-text-muted)" }}>�</span>
                    <span>{cur.desc}</span>
                  </>
                );
              })()}
            </div>
          )}

          {/* Legend (bottom-left) */}
          {!loading && !error && (
            <div
              className="absolute bottom-3 left-3 px-3 py-2"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-hairline)",
                borderRadius: "var(--rs-radius-md)",
                fontSize: "var(--rs-text-micro)",
                color: "var(--rs-text-muted)",
                pointerEvents: "none",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 140,
              }}
            >
              <div
                style={{
                  fontSize: "var(--rs-text-eyebrow)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--rs-tracking-wide)",
                  color: "var(--rs-text-muted)",
                  marginBottom: 2,
                }}
              >
                Legend
              </div>
              <LegendDot color="#F25353" label="Critical / impact target" />
              <LegendDot color="#F5A051" label="Direct dependent" />
              <LegendDot color="#FBBF24" label="Highlighted / hotspot" />
              <LegendDot color="var(--rs-text-muted)" label="Other nodes" />
            </div>
          )}

          {/* Path trace hint */}
          {pathSource && (
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2"
              style={{
                background: "var(--rs-surface-2)",
                border: "1px solid var(--rs-hairline-strong)",
                borderRadius: "var(--rs-radius-pill)",
                fontSize: 11,
                color: "var(--rs-text-secondary)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
              }}
            >
              <Waypoints size={13} style={{ color: "var(--rs-accent)" }} />
              Click a destination node to trace path
              <button
                onClick={() => {
                  setPathSource(null);
                  setTracedPath([]);
                  setHighlighted(new Set());
                }}
                style={{ color: "var(--rs-text-muted)" }}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Traced path summary */}
          {tracedPath.length > 1 && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2"
              style={{
                background: "var(--rs-surface-2)",
                border: "1px solid var(--rs-hairline-strong)",
                borderRadius: "var(--rs-radius-pill)",
                fontSize: 11,
                color: "var(--rs-text-secondary)",
                maxWidth: "80%",
                boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
              }}
            >
              <Waypoints size={13} style={{ color: "var(--rs-accent)" }} />
              <span>Path: {tracedPath.length} nodes</span>
              <div className="flex items-center gap-1 overflow-hidden">
                {tracedPath.slice(0, 5).map((id, i) => {
                  const nd = nodes.find((n) => n.id === id);
                  return (
                    <span key={id} className="flex items-center gap-1">
                      {i > 0 && (
                        <ArrowRight
                          size={10}
                          style={{ color: "var(--rs-accent)", flexShrink: 0 }}
                        />
                      )}
                      <span
                        className="truncate"
                        style={{
                          maxWidth: 80,
                          fontWeight: 500,
                          color: "var(--rs-text-primary)",
                        }}
                      >
                        {nd?.label || id.split("/").pop()}
                      </span>
                    </span>
                  );
                })}
                {tracedPath.length > 5 && (
                  <span>...+{tracedPath.length - 5}</span>
                )}
              </div>
              <button
                onClick={() => {
                  setTracedPath([]);
                  setHighlighted(new Set());
                  setPathSource(null);
                }}
                className="ml-1"
                style={{ color: "var(--rs-text-muted)" }}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Mode hint (bottom-left) */}
          <div
            className="absolute bottom-3 left-3"
            style={{
              fontSize: 10,
              letterSpacing: "var(--rs-tracking-wide)",
              textTransform: "uppercase",
              color: "var(--rs-text-muted)",
              padding: "4px 8px",
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-hairline)",
              borderRadius: "var(--rs-radius-md)",
            }}
          >
            {MODES.find((m) => m.id === mode)?.desc}
          </div>
        </div>

        {/* -- Right Details Panel -- */}
        <AnimatePresence>
          {detailsOpen && selectedNode && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 flex flex-col overflow-hidden"
              style={{
                borderLeft: "1px solid var(--rs-hairline-strong)",
                background: "var(--rs-surface-1)",
              }}
            >
              <div
                className="flex-1 overflow-y-auto"
                style={{ scrollbarWidth: "thin" }}
              >
                {/* Header */}
                <div
                  className="flex items-start gap-3 p-4 pb-3"
                  style={{ borderBottom: "1px solid var(--rs-hairline)" }}
                >
                  <div
                    className="rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      width: 32,
                      height: 32,
                      background:
                        getModuleColor(selectedNode.module, moduleList) + "20",
                    }}
                  >
                    <FileCode
                      size={16}
                      style={{
                        color: getModuleColor(selectedNode.module, moduleList),
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className="truncate"
                        style={{
                          fontSize: "var(--rs-text-heading)",
                          fontWeight: 500,
                          letterSpacing: "var(--rs-tracking-snug)",
                          color: "var(--rs-text-primary)",
                          fontFamily:
                            "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
                        }}
                      >
                        {selectedNode.label}
                      </h3>
                      <button
                        onClick={() => selectNode(null)}
                        className="ml-auto shrink-0"
                        style={{ color: "var(--rs-text-muted)" }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 10,
                        color: "var(--rs-text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {selectedNode.fullPath}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          background:
                            getModuleColor(selectedNode.module, moduleList) +
                            "20",
                          color: getModuleColor(
                            selectedNode.module,
                            moduleList,
                          ),
                          fontWeight: 500,
                        }}
                      >
                        {selectedNode.module}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--rs-text-muted)" }}
                      >
                        {selectedNode.type}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Plain-language role explanation */}
                <NodeRoleExplanation node={selectedNode} nodes={nodes} />

                {/* Metrics Grid */}
                <div
                  className="grid grid-cols-3 gap-px p-px"
                  style={{ background: "var(--rs-hairline)" }}
                >
                  {[
                    {
                      label: "Imports",
                      value: selectedNode.fanOut,
                      icon: ArrowUpRight,
                      color: "var(--rs-blue)",
                    },
                    {
                      label: "Imported by",
                      value: selectedNode.fanIn,
                      icon: ArrowDownLeft,
                      color: "var(--rs-amber)",
                    },
                    {
                      label: "Risk",
                      value:
                        selectedNode.riskScore > 0.6
                          ? "High"
                          : selectedNode.riskScore > 0.3
                            ? "Med"
                            : "Low",
                      icon: Shield,
                      color:
                        selectedNode.riskScore > 0.6
                          ? "var(--rs-red)"
                          : selectedNode.riskScore > 0.3
                            ? "var(--rs-amber)"
                            : "var(--rs-green)",
                    },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="flex flex-col items-center py-3"
                      style={{ background: "var(--rs-surface-1)" }}
                    >
                      <m.icon
                        size={12}
                        style={{ color: m.color, marginBottom: 4 }}
                      />
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--rs-text-primary)",
                        }}
                      >
                        {m.value}
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: "var(--rs-text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {m.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Centrality & Lines */}
                <div
                  className="px-4 py-3"
                  style={{ borderBottom: "1px solid var(--rs-hairline)" }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
                    >
                      Centrality
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--rs-text-primary)",
                      }}
                    >
                      {(selectedNode.centrality * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div
                    className="w-full rounded-full overflow-hidden"
                    style={{ height: 3, background: "var(--rs-surface-3)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${selectedNode.centrality * 100}%`,
                        background:
                          selectedNode.centrality > 0.6
                            ? "var(--rs-red)"
                            : selectedNode.centrality > 0.3
                              ? "var(--rs-amber)"
                              : "var(--rs-accent)",
                      }}
                    />
                  </div>
                  {selectedNode.lines > 0 && (
                    <div className="flex items-center justify-between mt-2">
                      <span
                        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
                      >
                        Lines
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--rs-text-secondary)",
                        }}
                      >
                        {selectedNode.lines.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {selectedNode.symbols > 0 && (
                    <div className="flex items-center justify-between mt-1">
                      <span
                        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
                      >
                        Symbols
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--rs-text-secondary)",
                        }}
                      >
                        {selectedNode.symbols}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div
                  className="px-4 py-3"
                  style={{ borderBottom: "1px solid var(--rs-hairline)" }}
                >
                  <div
                    style={{
                      fontSize: "var(--rs-text-eyebrow)",
                      fontWeight: 500,
                      color: "var(--rs-text-muted)",
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: "var(--rs-tracking-wide)",
                    }}
                  >
                    Actions
                  </div>
                  <div className="flex flex-col gap-1">
                    {[
                      {
                        label: "View in Files",
                        icon: FileSearch,
                        color: "var(--rs-accent)",
                        onClick: () => navigate("/app/files"),
                      },
                      {
                        label: "Ask AI about this file",
                        icon: MessageSquare,
                        color: "var(--rs-blue)",
                        onClick: () => navigate("/app/ai"),
                      },
                      {
                        label: "Show Impact Radius",
                        icon: Target,
                        color: "var(--rs-red)",
                        onClick: () => runImpactAnalysis(selectedNode),
                        loading: impactLoading,
                      },
                      {
                        label: "Show Dependencies",
                        icon: ArrowUpRight,
                        color: "var(--rs-blue)",
                        onClick: () => {
                          setMode("dependencies");
                          setHighlighted(
                            new Set([selectedNode.id, ...selectedNode.imports]),
                          );
                        },
                      },
                      {
                        label: "Show Dependents",
                        icon: ArrowDownLeft,
                        color: "var(--rs-amber)",
                        onClick: () => {
                          setMode("dependents");
                          setHighlighted(
                            new Set([
                              selectedNode.id,
                              ...selectedNode.importedBy,
                            ]),
                          );
                        },
                      },
                      {
                        label: "Trace Path From Here",
                        icon: Waypoints,
                        color: "var(--rs-green)",
                        onClick: () => {
                          setPathSource(selectedNode.id);
                          setTracedPath([]);
                        },
                      },
                      {
                        label: "Focus Module",
                        icon: Layers,
                        color: getModuleColor(selectedNode.module, moduleList),
                        onClick: () => {
                          const modNodes = nodes.filter(
                            (n) => n.module === selectedNode.module,
                          );
                          setHighlighted(new Set(modNodes.map((n) => n.id)));
                          setMode("modules");
                        },
                      },
                    ].map((action) => (
                      <button
                        key={action.label}
                        onClick={action.onClick}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-md transition-all w-full text-left"
                        style={{
                          fontSize: 11,
                          color: "var(--rs-text-secondary)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            "var(--rs-surface-3)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        {action.loading ? (
                          <Loader2
                            size={12}
                            className="animate-spin"
                            style={{ color: action.color }}
                          />
                        ) : (
                          <action.icon
                            size={12}
                            style={{ color: action.color }}
                          />
                        )}
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dependencies & Dependents Lists */}
                {selectedNode.imports.length > 0 && (
                  <DepList
                    title={`Imports (${selectedNode.imports.length})`}
                    ids={selectedNode.imports}
                    nodes={nodes}
                    moduleList={moduleList}
                    onSelect={(n) => {
                      selectNode(n);
                      focusNode(n);
                    }}
                  />
                )}
                {selectedNode.importedBy.length > 0 && (
                  <DepList
                    title={`Imported by (${selectedNode.importedBy.length})`}
                    ids={selectedNode.importedBy}
                    nodes={nodes}
                    moduleList={moduleList}
                    onSelect={(n) => {
                      selectNode(n);
                      focusNode(n);
                    }}
                  />
                )}

                {/* Impact Analysis Results */}
                {impactData && mode === "impact" && (
                  <div
                    className="px-4 py-3"
                    style={{ borderTop: "1px solid var(--rs-hairline)" }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Target size={12} style={{ color: "var(--rs-red)" }} />
                      <span
                        style={{
                          fontSize: "var(--rs-text-eyebrow)",
                          fontWeight: 500,
                          color: "var(--rs-text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "var(--rs-tracking-wide)",
                        }}
                      >
                        Impact Analysis
                      </span>
                    </div>

                    {/* Risk level */}
                    <div
                      className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg"
                      style={{ background: "var(--rs-surface-3)" }}
                    >
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{
                          background:
                            impactData.risk_level === "critical"
                              ? "var(--rs-red)"
                              : impactData.risk_level === "high"
                                ? "#F5A051"
                                : impactData.risk_level === "medium"
                                  ? "#FBBF24"
                                  : "var(--rs-green)",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--rs-text-primary)",
                          textTransform: "capitalize",
                        }}
                      >
                        {impactData.risk_level} Risk
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--rs-text-muted)",
                          marginLeft: "auto",
                        }}
                      >
                        Score: {(impactData.risk_score * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Blast radius summary */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div
                        className="px-2.5 py-2 rounded-md"
                        style={{ background: "var(--rs-surface-3)" }}
                      >
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: "var(--rs-text-primary)",
                          }}
                        >
                          {impactData.total_impacted}
                        </div>
                        <div
                          style={{ fontSize: 9, color: "var(--rs-text-muted)" }}
                        >
                          Files impacted
                        </div>
                      </div>
                      <div
                        className="px-2.5 py-2 rounded-md"
                        style={{ background: "var(--rs-surface-3)" }}
                      >
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: "var(--rs-text-primary)",
                          }}
                        >
                          {impactData.direct_dependents.length}
                        </div>
                        <div
                          style={{ fontSize: 9, color: "var(--rs-text-muted)" }}
                        >
                          Direct dependents
                        </div>
                      </div>
                    </div>

                    {/* Blast radius list */}
                    {impactData.blast_radius.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--rs-text-muted)",
                            marginBottom: 4,
                          }}
                        >
                          Blast Radius
                        </div>
                        <div
                          className="flex flex-col gap-1"
                          style={{ maxHeight: 200, overflowY: "auto" }}
                        >
                          {impactData.blast_radius.slice(0, 15).map((f) => (
                            <div
                              key={f.path}
                              className="flex items-center gap-2 px-2 py-1.5 rounded"
                              style={{
                                background: "var(--rs-surface-3)",
                                fontSize: 10,
                              }}
                            >
                              <div
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  background:
                                    f.distance === 1
                                      ? "var(--rs-red)"
                                      : f.distance === 2
                                        ? "var(--rs-amber)"
                                        : "var(--rs-text-muted)",
                                }}
                              />
                              <span
                                className="truncate flex-1"
                                style={{ color: "var(--rs-text-secondary)" }}
                              >
                                {f.path.split("/").pop()}
                              </span>
                              <span
                                style={{
                                  color: "var(--rs-text-muted)",
                                  fontSize: 9,
                                }}
                              >
                                d{f.distance}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggested review */}
                    {impactData.suggested_review.length > 0 && (
                      <div className="mt-3">
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--rs-text-muted)",
                            marginBottom: 4,
                          }}
                        >
                          Suggested Review
                        </div>
                        {impactData.suggested_review.slice(0, 5).map((p) => (
                          <div
                            key={p}
                            className="truncate py-0.5"
                            style={{ fontSize: 10, color: "var(--rs-accent)" }}
                          >
                            {p}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Module Info (when module mode is active) */}
                {mode === "modules" &&
                  (() => {
                    const modData = modulesData.find(
                      (m) => m.name === selectedNode.module,
                    );
                    if (!modData) return null;
                    return (
                      <div
                        className="px-4 py-3"
                        style={{ borderTop: "1px solid var(--rs-hairline)" }}
                      >
                        <div
                          style={{
                            fontSize: "var(--rs-text-eyebrow)",
                            fontWeight: 500,
                            color: "var(--rs-text-muted)",
                            marginBottom: 8,
                            textTransform: "uppercase",
                            letterSpacing: "var(--rs-tracking-wide)",
                          }}
                        >
                          Module: {modData.name}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { l: "Files", v: modData.file_count },
                            { l: "Symbols", v: modData.total_symbols },
                            {
                              l: "Cohesion",
                              v: (modData.cohesion * 100).toFixed(0) + "%",
                            },
                            {
                              l: "Risk",
                              v: (modData.risk_score * 100).toFixed(0) + "%",
                            },
                          ].map((s) => (
                            <div
                              key={s.l}
                              className="px-2 py-1.5 rounded"
                              style={{ background: "var(--rs-surface-3)" }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "var(--rs-text-primary)",
                                }}
                              >
                                {s.v}
                              </div>
                              <div
                                style={{
                                  fontSize: 9,
                                  color: "var(--rs-text-muted)",
                                }}
                              >
                                {s.l}
                              </div>
                            </div>
                          ))}
                        </div>
                        {modData.related_modules.length > 0 && (
                          <div className="mt-2">
                            <div
                              style={{
                                fontSize: 9,
                                color: "var(--rs-text-muted)",
                                marginBottom: 2,
                              }}
                            >
                              Related
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {modData.related_modules.map((rm) => (
                                <span
                                  key={rm}
                                  className="px-1.5 py-0.5 rounded text-[9px]"
                                  style={{
                                    background: "var(--rs-surface-3)",
                                    color: "var(--rs-text-secondary)",
                                  }}
                                >
                                  {rm}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty selection hint (when no node selected, no highlights) */}
        {!detailsOpen &&
          !selectedNode &&
          highlighted.size === 0 &&
          !loading &&
          nodes.length > 0 && (
            <div
              className="absolute right-4 top-4 flex items-center gap-2 px-3 py-2 pointer-events-none"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-hairline-strong)",
                borderRadius: "var(--rs-radius-md)",
                fontSize: 10,
                letterSpacing: "var(--rs-tracking-snug)",
                color: "var(--rs-text-secondary)",
              }}
            >
              <Crosshair size={11} style={{ color: "var(--rs-accent)" }} />
              <span>Click a node to inspect</span>
            </div>
          )}
      </div>
    </div>
  );
}

// --- Sub-components ------------------------------------------

function DepList({
  title,
  ids,
  nodes,
  moduleList,
  onSelect,
}: {
  title: string;
  ids: string[];
  nodes: GNode[];
  moduleList: string[];
  onSelect: (n: GNode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const items = ids.map((id) => nodeMap.get(id)).filter(Boolean) as GNode[];
  const show = expanded ? items : items.slice(0, 5);

  return (
    <div
      className="px-4 py-3"
      style={{ borderBottom: "1px solid var(--rs-hairline)" }}
    >
      <div
        className="flex items-center gap-1 mb-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={11}
          style={{
            color: "var(--rs-text-muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.16s var(--rs-ease-standard)",
          }}
        />
        <span
          style={{
            fontSize: "var(--rs-text-eyebrow)",
            fontWeight: 500,
            color: "var(--rs-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "var(--rs-tracking-wide)",
          }}
        >
          {title}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {show.map((n) => (
          <button
            key={n.id}
            onClick={() => onSelect(n)}
            className="flex items-center gap-2 px-2 py-1.5 rounded transition-colors w-full text-left"
            style={{ fontSize: 10 }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--rs-surface-3)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: getModuleColor(n.module, moduleList) }}
            />
            <span
              className="truncate"
              style={{ color: "var(--rs-text-secondary)" }}
            >
              {n.label}
            </span>
            <span
              className="ml-auto shrink-0"
              style={{ fontSize: 9, color: "var(--rs-text-muted)" }}
            >
              {n.fanIn}? {n.fanOut}?
            </span>
          </button>
        ))}
        {items.length > 5 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-left px-2 py-1"
            style={{ fontSize: 10, color: "var(--rs-accent)" }}
          >
            +{items.length - 5} more
          </button>
        )}
      </div>
    </div>
  );
}

// --- Plain-language node role explanation ------------------------------

function classifyNodeRole(node: GNode): {
  label: string;
  tone: string;
  description: string;
} {
  const { fanIn, fanOut, isEntryPoint, centrality } = node;
  if (isEntryPoint && fanOut > 0) {
    return {
      label: "Entry point",
      tone: "var(--rs-blue)",
      description:
        "This is a runtime entry � app start, route handler, worker, or CLI. Code here runs first, so a bug here blocks whatever it kicks off.",
    };
  }
  if (fanIn === 0 && fanOut === 0) {
    return {
      label: "Isolated",
      tone: "var(--rs-text-muted)",
      description:
        "Nothing in the repo imports this file, and it imports nothing internal. It may be dead code, a standalone script, or loaded dynamically.",
    };
  }
  if (fanIn >= 8 && fanOut >= 5) {
    return {
      label: "Bridge",
      tone: "var(--rs-red)",
      description:
        "Many files import this, and it pulls in many others. Changes here ripple in both directions � treat edits as high-impact.",
    };
  }
  if (fanIn >= 8) {
    return {
      label: "Hub",
      tone: "var(--rs-amber)",
      description:
        "Widely imported across the repo. It defines shared contracts � breaking it can cascade into many unrelated areas.",
    };
  }
  if (fanOut >= 8 && fanIn <= 2) {
    return {
      label: "Orchestrator",
      tone: "var(--rs-accent)",
      description:
        "Pulls together many modules but few depend on it. Likely a composition root, configuration assembler, or top-level coordinator.",
    };
  }
  if (fanIn === 0 && fanOut > 0) {
    return {
      label: "Top-level consumer",
      tone: "var(--rs-blue)",
      description:
        "Imports internal modules but nothing imports it back. Could be a script, a bootstrap file, or reached only through a framework.",
    };
  }
  if (fanOut === 0 && fanIn > 0) {
    return {
      label: "Leaf utility",
      tone: "var(--rs-green)",
      description:
        "Others depend on it, but it depends on nothing internal. A clean bottom-of-stack helper � usually safe to change in isolation.",
    };
  }
  if (centrality > 0.6) {
    return {
      label: "Central node",
      tone: "var(--rs-amber)",
      description:
        "Sits on many paths through the graph. Even with moderate edges, changes here tend to touch a lot of flows.",
    };
  }
  return {
    label: "Regular module",
    tone: "var(--rs-text-secondary)",
    description:
      "A typical participant � imported by some files, imports a few others. Change impact is scoped to its immediate neighbours.",
  };
}

function inferNodePurpose(path: string): string | null {
  const p = path.toLowerCase();
  if (/\/(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\./.test(p))
    return "Test file";
  if (/\/migrations?\//.test(p) || /alembic\/versions/.test(p))
    return "Database migration";
  if (/\/api\//.test(p) && /\.py$/.test(p)) return "HTTP API route handler";
  if (/\/routes?\//.test(p)) return "Routing definition";
  if (/\/services?\//.test(p)) return "Service / business logic";
  if (/\/models?\//.test(p)) return "Data model / ORM mapping";
  if (/\/schemas?\//.test(p)) return "Schema / validation definition";
  if (/\/workers?\//.test(p) || /celery/.test(p))
    return "Background worker task";
  if (/\/pages?\//.test(p) && /\.(tsx|jsx)$/.test(p))
    return "React page component";
  if (/\/components?\//.test(p) && /\.(tsx|jsx)$/.test(p))
    return "React component";
  if (/\/hooks?\//.test(p) && /\.(ts|tsx|js|jsx)$/.test(p)) return "React hook";
  if (/\/(utils?|lib|helpers?)\//.test(p)) return "Shared utility";
  if (/\/config/.test(p)) return "Configuration module";
  if (/\/parsers?\//.test(p)) return "Parser module";
  if (/\/analysis\//.test(p)) return "Analysis engine";
  if (/\/graph\//.test(p)) return "Graph module";
  if (/main\.(py|ts|tsx|js)$/.test(p)) return "Application entry";
  if (/index\.(ts|tsx|js|jsx)$/.test(p)) return "Module barrel / index";
  return null;
}

function NodeRoleExplanation({ node, nodes }: { node: GNode; nodes: GNode[] }) {
  const role = classifyNodeRole(node);
  const purpose = inferNodePurpose(node.fullPath);
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const topDependents = node.importedBy
    .map((id) => nodesById.get(id))
    .filter((n): n is GNode => !!n)
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 5);

  return (
    <div
      className="px-4 py-3"
      style={{
        borderBottom: "1px solid var(--rs-hairline)",
        background: "var(--rs-surface-2)",
      }}
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="px-1.5 py-0.5"
          style={{
            fontSize: "var(--rs-text-eyebrow)",
            background: role.tone + "1a",
            color: role.tone,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "var(--rs-tracking-wide)",
            borderRadius: "var(--rs-radius-sm)",
            border: "1px solid " + role.tone + "33",
          }}
        >
          {role.label}
        </span>
        {purpose && (
          <span
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
            }}
          >
            {purpose}
          </span>
        )}
      </div>
      <p
        style={{
          fontSize: "var(--rs-text-body)",
          lineHeight: "var(--rs-leading-relaxed)",
          color: "var(--rs-text-secondary)",
          margin: 0,
          maxWidth: "42ch",
        }}
      >
        {role.description}
      </p>
      <div
        className="grid grid-cols-2 gap-2 mt-3"
        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
      >
        <div>
          <span style={{ color: "var(--rs-text-primary)", fontWeight: 600 }}>
            {node.fanIn}
          </span>{" "}
          file{node.fanIn === 1 ? "" : "s"} depend on this
        </div>
        <div>
          This file pulls in{" "}
          <span style={{ color: "var(--rs-text-primary)", fontWeight: 600 }}>
            {node.fanOut}
          </span>{" "}
          other{node.fanOut === 1 ? "" : "s"}
        </div>
      </div>
      {topDependents.length > 0 && (
        <div className="mt-3">
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--rs-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
            }}
          >
            If this breaks, check first
          </div>
          <div className="flex flex-col gap-0.5">
            {topDependents.map((d) => (
              <div
                key={d.id}
                className="truncate"
                style={{
                  fontSize: 10,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                  color: "var(--rs-text-secondary)",
                }}
                title={d.fullPath}
              >
                {d.fullPath}
              </div>
            ))}
            {node.importedBy.length > topDependents.length && (
              <div
                style={{
                  fontSize: 9,
                  color: "var(--rs-text-muted)",
                  marginTop: 2,
                }}
              >
                + {node.importedBy.length - topDependents.length} more below
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
