import { useEffect, useRef } from "react";

// ── Architecture graph data ──

interface NodeDef {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
}

const NODES: NodeDef[] = [
  { id: "gateway", label: "Gateway", x: 0.5, y: 0.08, size: 5.5 },
  { id: "auth", label: "Auth", x: 0.2, y: 0.22, size: 4.5 },
  { id: "router", label: "Router", x: 0.74, y: 0.18, size: 4.5 },
  { id: "api", label: "API", x: 0.47, y: 0.36, size: 6.5 },
  { id: "queue", label: "Queue", x: 0.86, y: 0.33, size: 3.5 },
  { id: "services", label: "Services", x: 0.28, y: 0.53, size: 5.5 },
  { id: "models", label: "Models", x: 0.64, y: 0.5, size: 4.5 },
  { id: "events", label: "Events", x: 0.88, y: 0.5, size: 3.5 },
  { id: "cache", label: "Cache", x: 0.12, y: 0.67, size: 3.5 },
  { id: "workers", label: "Workers", x: 0.44, y: 0.69, size: 4 },
  { id: "db", label: "Database", x: 0.7, y: 0.7, size: 5 },
  { id: "config", label: "Config", x: 0.24, y: 0.83, size: 3 },
  { id: "logger", label: "Logger", x: 0.58, y: 0.85, size: 3 },
  { id: "middleware", label: "Middleware", x: 0.08, y: 0.4, size: 3.5 },
];

const EDGES: [string, string][] = [
  ["gateway", "auth"],
  ["gateway", "router"],
  ["gateway", "api"],
  ["router", "api"],
  ["auth", "api"],
  ["api", "services"],
  ["api", "models"],
  ["api", "queue"],
  ["services", "db"],
  ["services", "cache"],
  ["services", "workers"],
  ["models", "db"],
  ["queue", "events"],
  ["workers", "db"],
  ["middleware", "auth"],
  ["middleware", "services"],
  ["config", "services"],
  ["logger", "workers"],
  ["events", "db"],
];

/** Request path through the system — indices into EDGES (deterministic “pulse”) */
const SIGNATURE_EDGE_PATH = [2, 5, 8];

// ── Particle state ──

interface Particle {
  edgeIdx: number;
  progress: number;
  speed: number;
}

interface ResolvedNode extends NodeDef {
  px: number;
  py: number;
  phase: number;
}

// ── Bezier helpers ──

function quadBezier(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function edgeControl(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = dist * 0.12;
  return { x: mx + (-dy / dist) * offset, y: my + (dx / dist) * offset };
}

// ── Component ──

interface LiveGraphProps {
  className?: string;
  /** hero: large field; detail: workspace preview; panel: dense UI chrome */
  variant?: "hero" | "detail" | "panel";
}

export function LiveGraph({
  className = "",
  variant = "hero",
}: LiveGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let isVisible = true;
    let w = 0;
    let h = 0;

    // Resolved screen-space nodes
    let resolved: ResolvedNode[] = [];

    // Particles
    const particles: Particle[] = [];
    const particlesPerEdge =
      variant === "panel" ? 4 : variant === "detail" ? 3 : 2;
    for (let i = 0; i < EDGES.length; i++) {
      for (let j = 0; j < particlesPerEdge; j++) {
        const base = 0.028 + (i % 7) * 0.0025;
        particles.push({
          edgeIdx: i,
          progress: j / particlesPerEdge,
          speed: base,
        });
      }
    }

    // Active highlights — signature path only (calm, intentional)
    const highlights: { edgeIdx: number; start: number; dur: number }[] = [];
    /** Negative so the first signature pulse starts soon after mount */
    let lastPathStep = -10;
    let pathCursor = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      resolved = NODES.map((n) => ({
        ...n,
        px: n.x * w,
        py: n.y * h,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Visibility tracking
    const io = new IntersectionObserver(
      ([e]) => {
        isVisible = e.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const nodeMap = new Map<string, number>();
    NODES.forEach((n, i) => nodeMap.set(n.id, i));

    const isDetail = variant === "detail" || variant === "panel";
    const isPanel = variant === "panel";
    const edgeBase = isPanel ? 0.1 : isDetail ? 0.08 : 0.055;
    const edgeHi = isPanel ? 0.22 : isDetail ? 0.18 : 0.14;
    const particleR = isPanel ? 2 : isDetail ? 1.8 : 1.35;
    const labelAlpha = isPanel ? 0.42 : isDetail ? 0.35 : 0.24;
    const nodeAlpha = isPanel ? 0.92 : isDetail ? 0.9 : 0.62;

    function animate(now: number) {
      frame = requestAnimationFrame(animate);
      if (!isVisible || document.hidden) return;

      const t = now / 1000;
      ctx!.clearRect(0, 0, w, h);

      // Deterministic signature path — one edge at a time
      const stepInterval = isPanel ? 2.2 : isDetail ? 2.6 : 3.0;
      if (t - lastPathStep > stepInterval) {
        lastPathStep = t;
        const edgeIdx = SIGNATURE_EDGE_PATH[pathCursor % SIGNATURE_EDGE_PATH.length];
        pathCursor++;
        highlights.push({
          edgeIdx,
          start: t,
          dur: isPanel ? 1.35 : 1.55,
        });
      }

      // Active highlight set
      const activeEdges = new Set<number>();
      const activeNodes = new Set<number>();
      for (let i = highlights.length - 1; i >= 0; i--) {
        const hl = highlights[i];
        if (t > hl.start + hl.dur) {
          highlights.splice(i, 1);
          continue;
        }
        if (t >= hl.start) {
          activeEdges.add(hl.edgeIdx);
          const [fromId, toId] = EDGES[hl.edgeIdx];
          activeNodes.add(nodeMap.get(fromId)!);
          activeNodes.add(nodeMap.get(toId)!);
        }
      }

      // ── Draw edges ──
      for (let i = 0; i < EDGES.length; i++) {
        const [fromId, toId] = EDGES[i];
        const from = resolved[nodeMap.get(fromId)!];
        const to = resolved[nodeMap.get(toId)!];
        const ctrl = edgeControl(from, to);
        const active = activeEdges.has(i);
        const alpha = active ? edgeHi : edgeBase;

        ctx!.beginPath();
        ctx!.moveTo(from.px, from.py);
        ctx!.quadraticCurveTo(ctrl.x, ctrl.y, to.px, to.py);
        ctx!.strokeStyle = active
          ? `rgba(45, 212, 191, ${alpha})`
          : `rgba(148, 163, 184, ${alpha})`;
        ctx!.lineWidth = active ? 1 : 0.5;
        ctx!.stroke();
      }

      // ── Draw particles ──
      for (const p of particles) {
        p.progress = (p.progress + p.speed * 0.016) % 1;
        const [fromId, toId] = EDGES[p.edgeIdx];
        const from = resolved[nodeMap.get(fromId)!];
        const to = resolved[nodeMap.get(toId)!];
        const ctrl = edgeControl(from, to);
        const pos = quadBezier(p.progress, from, ctrl, to);

        // Fade at endpoints
        const fadeIn = Math.min(p.progress * 5, 1);
        const fadeOut = Math.min((1 - p.progress) * 5, 1);
        const alpha = fadeIn * fadeOut * 0.5;

        ctx!.beginPath();
        ctx!.arc(pos.x, pos.y, particleR, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(45, 212, 191, ${alpha})`;
        ctx!.fill();
      }

      // ── Draw nodes ──
      for (let i = 0; i < resolved.length; i++) {
        const n = resolved[i];
        const breathe = Math.sin(t * 0.6 + n.phase) * 0.8;
        const r = n.size + breathe;
        const active = activeNodes.has(i);

        // Glow ring (active nodes only)
        if (active) {
          const glowAlpha = 0.1;
          ctx!.beginPath();
          ctx!.arc(n.px, n.py, r + 6, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(45, 212, 191, ${glowAlpha})`;
          ctx!.fill();
        }

        // Node body
        ctx!.beginPath();
        ctx!.arc(n.px, n.py, r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(12, 20, 33, ${nodeAlpha})`;
        ctx!.fill();

        // Node ring
        ctx!.beginPath();
        ctx!.arc(n.px, n.py, r, 0, Math.PI * 2);
        ctx!.strokeStyle = active
          ? `rgba(45, 212, 191, 0.4)`
          : `rgba(148, 163, 184, 0.12)`;
        ctx!.lineWidth = active ? 1.2 : 0.8;
        ctx!.stroke();

        // Label
        ctx!.fillStyle = active
          ? `rgba(45, 212, 191, ${labelAlpha + 0.15})`
          : `rgba(148, 163, 184, ${labelAlpha})`;
        ctx!.font = `${isPanel ? 11 : isDetail ? 10 : 9}px Inter, system-ui, sans-serif`;
        ctx!.textAlign = "center";
        ctx!.fillText(n.label, n.px, n.py + r + 14);
      }
    }

    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      io.disconnect();
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
