import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/AppShell";
import { useEffect, useRef, useCallback, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import {
  getGraph,
  type GraphNode as APIGraphNode,
  type GraphEdge as APIGraphEdge,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/graph")({
  head: () => ({
    meta: [
      { title: "Graph Explorer — RepoSage" },
      {
        name: "description",
        content: "Visualize your codebase architecture and dependencies.",
      },
    ],
  }),
  component: GraphPage,
});

interface GNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  label: string;
  group: number;
  phase: number;
  id: string;
}

function groupFromPath(path: string): number {
  const lower = path.toLowerCase();
  if (lower.includes("api") || lower.includes("route")) return 0;
  if (lower.includes("auth")) return 1;
  if (
    lower.includes("db") ||
    lower.includes("model") ||
    lower.includes("migration")
  )
    return 2;
  if (lower.includes("ui") || lower.includes("component")) return 3;
  if (lower.includes("lib") || lower.includes("util")) return 4;
  if (lower.includes("service")) return 5;
  return 6;
}

const groupColors = [
  "oklch(0.72 0.12 180)",
  "oklch(0.72 0.12 140)",
  "oklch(0.72 0.12 220)",
  "oklch(0.72 0.12 300)",
  "oklch(0.72 0.12 60)",
  "oklch(0.72 0.12 30)",
  "oklch(0.60 0.08 260)",
];

function FullGraph({
  apiNodes,
  apiEdges,
}: {
  apiNodes: APIGraphNode[];
  apiEdges: APIGraphEdge[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const hoveredRef = useRef<number>(-1);

  const init = useCallback(
    (w: number, h: number) => {
      const nodeIndexMap = new Map<string, number>();
      const nodes: GNode[] = apiNodes.map((n, i) => {
        nodeIndexMap.set(n.id, i);
        const group = groupFromPath(n.id);
        const angle = (i / apiNodes.length) * Math.PI * 2 + Math.random() * 0.4;
        const radius = 100 + Math.random() * Math.min(w, h) * 0.25;
        return {
          x: w * 0.5 + Math.cos(angle) * radius,
          y: h * 0.5 + Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 0.05,
          vy: (Math.random() - 0.5) * 0.05,
          r: 3.5,
          label: n.label,
          group,
          phase: Math.random() * Math.PI * 2,
          id: n.id,
        };
      });

      const edges: [number, number][] = [];
      apiEdges.forEach((e) => {
        const a = nodeIndexMap.get(e.source);
        const b = nodeIndexMap.get(e.target);
        if (a !== undefined && b !== undefined) edges.push([a, b]);
      });

      // Simple force-directed layout: run a few iterations
      for (let iter = 0; iter < 100; iter++) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const repulsion = 2000 / (dist * dist);
            const fx = (dx / dist) * repulsion;
            const fy = (dy / dist) * repulsion;
            nodes[i].x -= fx;
            nodes[i].y -= fy;
            nodes[j].x += fx;
            nodes[j].y += fy;
          }
        }
        edges.forEach(([a, b]) => {
          const dx = nodes[b].x - nodes[a].x;
          const dy = nodes[b].y - nodes[a].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const attraction = (dist - 80) * 0.005;
          const fx = (dx / dist) * attraction;
          const fy = (dy / dist) * attraction;
          nodes[a].x += fx;
          nodes[a].y += fy;
          nodes[b].x -= fx;
          nodes[b].y -= fy;
        });
        // Center gravity
        nodes.forEach((n) => {
          n.x += (w / 2 - n.x) * 0.01;
          n.y += (h / 2 - n.y) * 0.01;
        });
      }

      return { nodes, edges };
    },
    [apiNodes, apiEdges],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || apiNodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let graphData: { nodes: GNode[]; edges: [number, number][] } | null = null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      graphData = init(rect.width, rect.height);
    };
    resize();

    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    canvas.addEventListener("mousemove", handleMove);

    let animId: number;
    const draw = (t: number) => {
      if (!graphData) {
        animId = requestAnimationFrame(draw);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      const { nodes, edges } = graphData;
      const mouse = mouseRef.current;

      let hovered = -1;
      nodes.forEach((n, i) => {
        if (Math.hypot(n.x - mouse.x, n.y - mouse.y) < 20) hovered = i;
      });
      hoveredRef.current = hovered;

      // Gentle drift
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 20 || n.x > rect.width - 20) n.vx *= -1;
        if (n.y < 20 || n.y > rect.height - 20) n.vy *= -1;
        n.vx *= 0.999;
        n.vy *= 0.999;
      });

      // Edges
      edges.forEach(([a, b]) => {
        const na = nodes[a],
          nb = nodes[b];
        const isHighlighted = hovered === a || hovered === b;
        const alpha = isHighlighted ? 0.3 : 0.08;

        ctx.beginPath();
        const mx = (na.x + nb.x) / 2 + Math.sin(t * 0.0004 + a) * 5;
        const my = (na.y + nb.y) / 2;
        ctx.moveTo(na.x, na.y);
        ctx.quadraticCurveTo(mx, my, nb.x, nb.y);
        ctx.strokeStyle = `oklch(0.72 0.12 180 / ${alpha})`;
        ctx.lineWidth = isHighlighted ? 1 : 0.5;
        ctx.stroke();
      });

      // Nodes
      nodes.forEach((n, i) => {
        const pulse = 0.85 + 0.15 * Math.sin(t * 0.0008 + n.phase);
        const isHovered = i === hovered;
        const isConnected =
          hovered >= 0 &&
          edges.some(
            ([a, b]) =>
              (a === hovered && b === i) || (b === hovered && a === i),
          );
        const alpha = isHovered ? 0.9 : isConnected ? 0.6 : 0.25 * pulse;

        ctx.beginPath();
        ctx.arc(n.x, n.y, isHovered ? n.r + 1 : n.r, 0, Math.PI * 2);
        ctx.fillStyle =
          `${groupColors[n.group] ?? groupColors[6]} / ${alpha})`.replace(
            /oklch\(([^)]+)\)/,
            `oklch($1 / ${alpha})`,
          );
        ctx.fillStyle = `oklch(0.72 0.12 180 / ${alpha})`;
        ctx.fill();

        if (isHovered || isConnected) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 10, 0, Math.PI * 2);
          ctx.fillStyle = `oklch(0.72 0.12 180 / 0.04)`;
          ctx.fill();
        }

        if (isHovered || isConnected) {
          ctx.font = "500 10px 'Inter', sans-serif";
          ctx.fillStyle = `oklch(0.72 0.12 180 / ${isHovered ? 0.9 : 0.5})`;
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x, n.y - n.r - 10);
        }
      });

      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", handleMove);
    };
  }, [init, apiNodes.length]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

function GraphPage() {
  const { activeAnalysisId, activeRepoId } = useAppStore();
  const [nodes, setNodes] = useState<APIGraphNode[]>([]);
  const [edges, setEdges] = useState<APIGraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [edgeFilter, setEdgeFilter] = useState<string | undefined>();
  const [selectedNode, setSelectedNode] = useState<APIGraphNode | null>(null);

  useEffect(() => {
    if (!activeAnalysisId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getGraph(activeAnalysisId, edgeFilter)
      .then((data) => {
        setNodes(data.nodes);
        setEdges(data.edges);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeAnalysisId, edgeFilter]);

  if (!activeRepoId || !activeAnalysisId) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            No analysis available.{" "}
            <a href="/upload" className="text-primary hover:underline">
              Connect a repository
            </a>
            .
          </p>
        </div>
      </AppShell>
    );
  }

  const filterOptions = [
    { label: "All", value: undefined },
    { label: "Imports", value: "imports" },
    { label: "Calls", value: "calls" },
    { label: "Extends", value: "extends" },
  ];

  return (
    <AppShell>
      <div className="relative h-full">
        {/* Top bar */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm border border-border/40 rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search modules…"
              className="bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none w-40"
            />
          </div>
          <div className="flex gap-2">
            {filterOptions.map((f) => (
              <button
                key={f.label}
                onClick={() => setEdgeFilter(f.value)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth ${
                  edgeFilter === f.value
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground/50 hover:text-muted-foreground bg-background/80 backdrop-blur-sm border border-border/40"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">
              No graph data available.
            </p>
          </div>
        ) : (
          <FullGraph apiNodes={nodes} apiEdges={edges} />
        )}

        {/* Detail panel */}
        <div className="absolute bottom-4 left-4 w-52 bg-background/95 backdrop-blur-sm border border-border/40 rounded-xl p-4">
          <div className="text-[11px] text-muted-foreground mb-2">
            {nodes.length} nodes · {edges.length} edges
          </div>
          {selectedNode && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-[11px] font-mono font-medium text-foreground">
                  {selectedNode.label}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
