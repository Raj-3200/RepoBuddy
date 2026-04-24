import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { ArrowRight, GitBranch, Github, Zap, Shield, Eye } from "lucide-react";
import { useAppStore } from "@/lib/store";

/* ─── Animated Graph Canvas ─── */
interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  label: string;
  type: "core" | "module" | "util" | "leaf";
  pulse: number;
}

interface Edge {
  source: string;
  target: string;
  strength: number;
}

const NODE_DATA: Omit<Node, "x" | "y" | "vx" | "vy" | "pulse">[] = [
  { id: "app", r: 9, label: "app.ts", type: "core" },
  { id: "router", r: 7, label: "router", type: "module" },
  { id: "auth", r: 7, label: "auth", type: "module" },
  { id: "db", r: 8, label: "database", type: "module" },
  { id: "api", r: 7, label: "api", type: "module" },
  { id: "utils", r: 5, label: "utils", type: "util" },
  { id: "config", r: 5, label: "config", type: "util" },
  { id: "middleware", r: 5, label: "middleware", type: "util" },
  { id: "models", r: 6, label: "models", type: "module" },
  { id: "schema", r: 5, label: "schema", type: "util" },
  { id: "handlers", r: 5, label: "handlers", type: "util" },
  { id: "logger", r: 4, label: "logger", type: "leaf" },
  { id: "cache", r: 5, label: "cache", type: "leaf" },
  { id: "events", r: 5, label: "events", type: "leaf" },
  { id: "types", r: 4, label: "types", type: "leaf" },
  { id: "hooks", r: 4, label: "hooks", type: "leaf" },
];

const EDGES: Edge[] = [
  { source: "app", target: "router", strength: 1 },
  { source: "app", target: "auth", strength: 1 },
  { source: "app", target: "db", strength: 1 },
  { source: "app", target: "api", strength: 1 },
  { source: "app", target: "config", strength: 0.8 },
  { source: "router", target: "handlers", strength: 0.8 },
  { source: "router", target: "middleware", strength: 0.7 },
  { source: "auth", target: "models", strength: 0.8 },
  { source: "auth", target: "utils", strength: 0.7 },
  { source: "db", target: "models", strength: 0.9 },
  { source: "db", target: "schema", strength: 0.8 },
  { source: "db", target: "cache", strength: 0.7 },
  { source: "api", target: "handlers", strength: 0.8 },
  { source: "api", target: "auth", strength: 0.7 },
  { source: "models", target: "types", strength: 0.6 },
  { source: "utils", target: "logger", strength: 0.5 },
  { source: "middleware", target: "logger", strength: 0.5 },
  { source: "handlers", target: "events", strength: 0.6 },
  { source: "config", target: "types", strength: 0.5 },
  { source: "hooks", target: "utils", strength: 0.5 },
  { source: "events", target: "logger", strength: 0.4 },
];

const typeColors: Record<Node["type"], string> = {
  core: "#7C6CF5",
  module: "#5B9CF6",
  util: "#3DD68C",
  leaf: "#8A8AA0",
};

function GraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const animFrameRef = useRef<number>(0);
  const hoveredRef = useRef<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const sizeRef = useRef(size);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setSize({ w, h });
      sizeRef.current = { w, h };
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const { w, h } = sizeRef.current;
    // Init nodes in a loose circular layout
    nodesRef.current = NODE_DATA.map((nd, i) => {
      const angle = (i / NODE_DATA.length) * Math.PI * 2;
      const dist =
        nd.type === "core"
          ? 0
          : nd.type === "module"
            ? 140
            : nd.type === "util"
              ? 240
              : 310;
      return {
        ...nd,
        x: w / 2 + Math.cos(angle) * dist + (Math.random() - 0.5) * 40,
        y: h / 2 + Math.sin(angle) * dist + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        pulse: Math.random() * Math.PI * 2,
      };
    });
  }, [size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let t = 0;

    const getNodeById = (id: string) =>
      nodesRef.current.find((n) => n.id === id)!;

    const simulate = () => {
      const nodes = nodesRef.current;
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;

      // Soft spring forces
      for (const node of nodes) {
        // Attraction to center (light gravity)
        const dx = cx - node.x;
        const dy = cy - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idealDist =
          node.type === "core"
            ? 0
            : node.type === "module"
              ? 140
              : node.type === "util"
                ? 220
                : 300;
        const force = (dist - idealDist) * 0.003;
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;

        // Repulsion between all nodes
        for (const other of nodes) {
          if (other.id === node.id) continue;
          const ox = node.x - other.x;
          const oy = node.y - other.y;
          const od = Math.max(Math.sqrt(ox * ox + oy * oy), 1);
          const rep = 600 / (od * od);
          node.vx += (ox / od) * rep;
          node.vy += (oy / od) * rep;
        }

        // Damping
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        // Keep in bounds
        node.x = Math.max(40, Math.min(w - 40, node.x));
        node.y = Math.max(40, Math.min(h - 40, node.y));
        node.pulse += 0.015;
      }
    };

    const draw = () => {
      t += 0.008;
      simulate();
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);

      // Draw edges
      for (const edge of EDGES) {
        const s = getNodeById(edge.source);
        const t2 = getNodeById(edge.target);
        if (!s || !t2) continue;
        const isHovered =
          hoveredRef.current === s.id || hoveredRef.current === t2.id;
        const alpha = isHovered ? 0.35 : edge.strength * 0.12;
        const gradient = ctx.createLinearGradient(s.x, s.y, t2.x, t2.y);
        gradient.addColorStop(0, `rgba(124,108,245,${alpha})`);
        gradient.addColorStop(1, `rgba(91,156,246,${alpha * 0.7})`);
        ctx.beginPath();
        ctx.strokeStyle = gradient;
        ctx.lineWidth = isHovered ? 1.5 : 0.8;
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodesRef.current) {
        const isHovered = hoveredRef.current === node.id;
        const color = typeColors[node.type];
        const pulse = Math.sin(node.pulse) * 0.5 + 0.5;
        const r =
          node.r +
          (isHovered ? 3 : 0) +
          (node.type === "core" ? pulse * 1.5 : 0);

        // Outer glow for hovered/core
        if (isHovered || node.type === "core") {
          const glow = ctx.createRadialGradient(
            node.x,
            node.y,
            r * 0.5,
            node.x,
            node.y,
            r * 3,
          );
          glow.addColorStop(0, `${color}30`);
          glow.addColorStop(1, `${color}00`);
          ctx.beginPath();
          ctx.fillStyle = glow;
          ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Node ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}${isHovered ? "60" : "20"}`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Node fill
        const grad = ctx.createRadialGradient(
          node.x - r * 0.3,
          node.y - r * 0.3,
          0,
          node.x,
          node.y,
          r,
        );
        grad.addColorStop(0, color + "FF");
        grad.addColorStop(1, color + "AA");
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Label for larger nodes
        if (node.r >= 5 && (isHovered || node.r >= 7)) {
          ctx.fillStyle = isHovered ? "#F0EFED" : `rgba(240,239,237,0.55)`;
          ctx.font = `${isHovered ? 500 : 400} ${isHovered ? 10 : 9}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(node.label, node.x, node.y + r + 13);
        }
      }
    };

    const loop = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    loop();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let found: string | null = null;
      for (const node of nodesRef.current) {
        const d = Math.sqrt((mx - node.x) ** 2 + (my - node.y) ** 2);
        if (d < node.r + 6) {
          found = node.id;
          break;
        }
      }
      hoveredRef.current = found;
      canvas.style.cursor = found ? "pointer" : "default";
    };
    canvas.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      canvas.removeEventListener("mousemove", handleMouseMove);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      width={size.w}
      height={size.h}
      className="absolute inset-0 opacity-70"
    />
  );
}

/* ─── Landing Page ─── */
export function Landing() {
  const navigate = useNavigate();
  const { signIn, user } = useAppStore();
  const [email, setEmail] = useState("");

  // Get Started / Try-it flow: make sure the user has a session, then
  // drop straight into the upload page.
  const goToUpload = () => {
    if (!user) {
      signIn({ name: "Guest", email: "guest@repobuddy.local" });
    }
    navigate("/app/upload");
  };

  const features = [
    {
      icon: GitBranch,
      title: "Architecture Mapping",
      desc: "Visualize every module, dependency, and relationship across the entire codebase in a navigable graph.",
      color: "var(--rs-accent)",
    },
    {
      icon: Eye,
      title: "File Intelligence",
      desc: "Inspect any file's imports, exports, dependencies, and risk posture at a glance.",
      color: "var(--rs-blue)",
    },
    {
      icon: Zap,
      title: "Grounded AI",
      desc: "Ask questions and receive evidence-backed answers tied directly to real code in the repository.",
      color: "var(--rs-green)",
    },
    {
      icon: Shield,
      title: "Risk Insights",
      desc: "Identify circular dependencies, isolated modules, and architectural hotspots before they become problems.",
      color: "var(--rs-amber)",
    },
  ];

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        minHeight: "100vh",
        background: "var(--rs-base)",
        color: "var(--rs-text-primary)",
      }}
    >
      {/* Graph background */}
      <div className="absolute inset-0 overflow-hidden">
        <GraphCanvas />
        {/* Radial fade overlay */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 70% at 50% 50%, transparent 20%, #0C0C10 75%)",
          }}
        />
        {/* Top + bottom fades */}
        <div
          className="absolute inset-x-0 top-0 h-32"
          style={{
            background: "linear-gradient(to bottom, #0C0C10, transparent)",
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-40"
          style={{
            background: "linear-gradient(to top, #0C0C10, transparent)",
          }}
        />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 md:px-12">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex items-center gap-2.5"
          style={{
            textDecoration: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 30,
              height: 30,
              background: "var(--rs-accent)",
              boxShadow: "0 0 18px rgba(124,108,245,0.4)",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1L12.5 4.5V10.5L7 14L1.5 10.5V4.5L7 1Z"
                stroke="white"
                strokeWidth="1.2"
                fill="none"
              />
              <circle cx="7" cy="7" r="2" fill="white" fillOpacity="0.9" />
              <path
                d="M7 1V5M7 9V13M1.5 4.5L5 6.5M9 7.5L12.5 9.5M1.5 10.5L5 8.5M9 5.5L12.5 4.5"
                stroke="white"
                strokeWidth="0.8"
                strokeOpacity="0.7"
              />
            </svg>
          </div>
          <span
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}
          >
            RepoBuddy
          </span>
        </a>

        <div className="hidden md:flex items-center gap-8">
          {[
            { label: "Product", href: "#features" },
            { label: "How it works", href: "#how-it-works" },
            {
              label: "Docs",
              href: "https://github.com/Raj-3200/repobuddy-frontend#readme",
              external: true,
            },
          ].map((item) => (
            <a
              key={item.label}
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              style={{
                fontSize: 13,
                color: "var(--rs-text-secondary)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-primary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-secondary)")
              }
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {!user && (
            <button
              onClick={() => navigate("/signin")}
              style={{
                fontSize: 13,
                color: "var(--rs-text-secondary)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-primary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-secondary)")
              }
            >
              Sign in
            </button>
          )}
          <button
            onClick={user ? () => navigate("/app") : goToUpload}
            className="rounded-lg px-4 flex items-center gap-1.5 transition-all"
            style={{
              height: 34,
              fontSize: 13,
              background: "var(--rs-accent)",
              color: "white",
              border: "none",
              boxShadow: "0 0 20px rgba(124,108,245,0.3)",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--rs-accent-hover)";
              e.currentTarget.style.boxShadow =
                "0 0 28px rgba(124,108,245,0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--rs-accent)";
              e.currentTarget.style.boxShadow =
                "0 0 20px rgba(124,108,245,0.3)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {user ? "Open dashboard" : "Get Started"}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-20 pb-16 md:pt-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 mb-8"
            style={{
              fontSize: 11,
              fontWeight: 500,
              background: "rgba(124,108,245,0.1)",
              border: "1px solid rgba(124,108,245,0.25)",
              color: "var(--rs-accent)",
              letterSpacing: "0.04em",
            }}
          >
            <span
              className="rounded-full"
              style={{
                width: 5,
                height: 5,
                background: "var(--rs-accent)",
                display: "inline-block",
                boxShadow: "0 0 6px var(--rs-accent)",
              }}
            />
            Now in private beta — join the waitlist
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontSize: "clamp(38px, 5.5vw, 72px)",
            fontWeight: 600,
            letterSpacing: "-0.04em",
            lineHeight: 1.08,
            maxWidth: 720,
            color: "var(--rs-text-primary)",
          }}
        >
          Understand any codebase,{" "}
          <span style={{ color: "var(--rs-accent)" }}>instantly</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontSize: "clamp(14px, 1.6vw, 18px)",
            color: "var(--rs-text-secondary)",
            maxWidth: 480,
            marginTop: 20,
            lineHeight: 1.65,
          }}
        >
          RepoBuddy maps your architecture, surfaces hidden dependencies, and
          answers your questions — grounded in real code evidence.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col sm:flex-row items-center gap-3 mt-10"
        >
          <button
            onClick={goToUpload}
            className="flex items-center gap-2 rounded-xl px-6 transition-all"
            style={{
              height: 44,
              fontSize: 14,
              fontWeight: 500,
              background: "var(--rs-accent)",
              color: "white",
              border: "none",
              boxShadow: "0 4px 24px rgba(124,108,245,0.35)",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--rs-accent-hover)";
              e.currentTarget.style.boxShadow =
                "0 6px 32px rgba(124,108,245,0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--rs-accent)";
              e.currentTarget.style.boxShadow =
                "0 4px 24px rgba(124,108,245,0.35)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Upload / Analyze a repo
            <ArrowRight size={14} />
          </button>

          {!user && (
            <button
              onClick={() => navigate("/signin")}
              className="flex items-center gap-2 rounded-xl px-5 transition-all"
              style={{
                height: 44,
                fontSize: 14,
                fontWeight: 400,
                background: "rgba(255,255,255,0.04)",
                color: "var(--rs-text-secondary)",
                border: "1px solid var(--rs-border-strong)",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                e.currentTarget.style.color = "var(--rs-text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.color = "var(--rs-text-secondary)";
              }}
            >
              <Github size={14} />
              Connect GitHub
            </button>
          )}
          {/* Connect GitHub navigates to sign in */}
        </motion.div>

        {/* Trusted by line */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.8 }}
          className="mt-12 flex items-center gap-4"
        >
          <div
            style={{ height: 1, width: 60, background: "var(--rs-border)" }}
          />
          <span
            style={{
              fontSize: 11,
              color: "var(--rs-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Used by teams at
          </span>
          <div
            style={{ height: 1, width: 60, background: "var(--rs-border)" }}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.85, duration: 0.8 }}
          className="mt-4 flex items-center gap-8"
        >
          {["Stripe", "Linear", "Vercel", "Resend", "Clerk"].map((name) => (
            <span
              key={name}
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--rs-text-muted)",
                letterSpacing: "0.02em",
              }}
            >
              {name}
            </span>
          ))}
        </motion.div>
      </section>

      {/* App preview strip */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 px-8 md:px-16 pb-16"
      >
        <div
          className="rounded-2xl overflow-hidden mx-auto"
          style={{
            maxWidth: 1000,
            background: "var(--rs-surface-1)",
            border: "1px solid var(--rs-border-strong)",
            boxShadow:
              "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)",
          }}
        >
          {/* Mock app bar */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{
              borderBottom: "1px solid var(--rs-border)",
              background: "var(--rs-sidebar)",
            }}
          >
            <div className="flex gap-1.5">
              <div
                className="rounded-full"
                style={{ width: 10, height: 10, background: "#F25353" }}
              />
              <div
                className="rounded-full"
                style={{ width: 10, height: 10, background: "#F5A051" }}
              />
              <div
                className="rounded-full"
                style={{ width: 10, height: 10, background: "#3DD68C" }}
              />
            </div>
            <div
              className="flex-1 flex items-center justify-center rounded"
              style={{
                height: 22,
                background: "var(--rs-surface-2)",
                maxWidth: 280,
                margin: "0 auto",
              }}
            >
              <span style={{ fontSize: 10, color: "var(--rs-text-muted)" }}>
                app.repobuddy.dev
              </span>
            </div>
          </div>

          {/* Mock dashboard content */}
          <div className="flex" style={{ height: 380 }}>
            {/* Mock sidebar */}
            <div
              className="flex flex-col gap-2 p-3"
              style={{
                width: 160,
                background: "var(--rs-sidebar)",
                borderRight: "1px solid var(--rs-border)",
              }}
            >
              {[
                { label: "Overview", active: true, color: "var(--rs-accent)" },
                { label: "Files", active: false },
                { label: "Graph", active: false },
                { label: "AI Workspace", active: false },
                { label: "Insights", active: false },
                { label: "Docs", active: false },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-md px-2.5 py-1.5"
                  style={{
                    background: item.active
                      ? "rgba(124,108,245,0.12)"
                      : "transparent",
                    color: item.active
                      ? "var(--rs-text-primary)"
                      : "var(--rs-text-muted)",
                    fontSize: 11,
                    fontWeight: item.active ? 500 : 400,
                  }}
                >
                  {item.label}
                </div>
              ))}
            </div>

            {/* Mock main content */}
            <div className="flex-1 p-5 overflow-hidden">
              <div className="flex items-center gap-3 mb-5">
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--rs-text-primary)",
                  }}
                >
                  stripe/stripe-node
                </div>
                <div
                  className="rounded-full px-2 py-0.5"
                  style={{
                    fontSize: 10,
                    background: "var(--rs-green-dim)",
                    color: "var(--rs-green)",
                    border: "1px solid rgba(61,214,140,0.2)",
                  }}
                >
                  Analyzed
                </div>
              </div>
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
              >
                {[
                  {
                    label: "Total Files",
                    value: "847",
                    sub: "+12 since last scan",
                  },
                  { label: "Modules", value: "124", sub: "6 isolated" },
                  {
                    label: "Risk Score",
                    value: "23",
                    sub: "Low risk",
                    color: "var(--rs-green)",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg p-3"
                    style={{
                      background: "var(--rs-surface-2)",
                      border: "1px solid var(--rs-border)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--rs-text-muted)",
                        marginBottom: 4,
                      }}
                    >
                      {stat.label}
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: stat.color || "var(--rs-text-primary)",
                        letterSpacing: "-0.03em",
                      }}
                    >
                      {stat.value}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--rs-text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {stat.sub}
                    </div>
                  </div>
                ))}
              </div>
              {/* Mini chart placeholder */}
              <div
                className="rounded-lg mt-3 p-3 flex items-end gap-1"
                style={{
                  background: "var(--rs-surface-2)",
                  border: "1px solid var(--rs-border)",
                  height: 90,
                }}
              >
                {[45, 62, 38, 78, 55, 90, 67, 82, 71, 95, 58, 76].map(
                  (h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm transition-all"
                      style={{
                        height: `${h}%`,
                        background:
                          i === 10 ? "var(--rs-accent)" : "var(--rs-surface-3)",
                        opacity: i > 9 ? 1 : 0.6,
                      }}
                    />
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Features */}
      <section id="features" className="relative z-10 px-8 md:px-16 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-14"
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--rs-text-muted)",
              marginBottom: 12,
            }}
          >
            Capabilities
          </div>
          <h2
            style={{
              fontSize: "clamp(24px, 3vw, 36px)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "var(--rs-text-primary)",
            }}
          >
            Built for real code exploration
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.6,
                delay: i * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="rounded-xl p-6 group cursor-default transition-all"
              style={{
                background: "var(--rs-surface-1)",
                border: "1px solid var(--rs-border)",
                transition: "border-color 0.25s, box-shadow 0.25s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(124,108,245,0.25)";
                e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--rs-border)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div
                className="flex items-center justify-center rounded-lg mb-4"
                style={{
                  width: 36,
                  height: 36,
                  background: `${feature.color}18`,
                  border: `1px solid ${feature.color}30`,
                }}
              >
                <feature.icon size={16} style={{ color: feature.color }} />
              </div>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--rs-text-primary)",
                  marginBottom: 8,
                  letterSpacing: "-0.01em",
                }}
              >
                {feature.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--rs-text-secondary)",
                  lineHeight: 1.65,
                }}
              >
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA section */}
      <section className="relative z-10 px-8 pb-28 flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl p-10 text-center max-w-2xl w-full"
          style={{
            background: "var(--rs-surface-1)",
            border: "1px solid var(--rs-border-strong)",
            boxShadow: "0 0 80px rgba(124,108,245,0.06)",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(22px, 3vw, 32px)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              marginBottom: 12,
            }}
          >
            Ready to navigate complexity?
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "var(--rs-text-secondary)",
              lineHeight: 1.6,
              marginBottom: 28,
              maxWidth: 400,
              margin: "0 auto 28px",
            }}
          >
            Join engineering teams who use RepoBuddy to onboard faster,
            understand architecture, and ship with confidence.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {user ? (
              <button
                onClick={goToUpload}
                className="flex items-center gap-2 rounded-xl px-6 transition-all"
                style={{
                  height: 44,
                  fontSize: 13,
                  fontWeight: 500,
                  background: "var(--rs-accent)",
                  color: "white",
                  border: "none",
                  whiteSpace: "nowrap",
                  boxShadow: "0 4px 24px rgba(124,108,245,0.35)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--rs-accent-hover)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--rs-accent)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                Analyze a repository
                <ArrowRight size={13} />
              </button>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="rounded-xl px-4"
                  style={{
                    height: 44,
                    width: 240,
                    fontSize: 13,
                    background: "var(--rs-surface-2)",
                    border: "1px solid var(--rs-border-strong)",
                    color: "var(--rs-text-primary)",
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => navigate("/signin")}
                  className="flex items-center gap-2 rounded-xl px-6 transition-all"
                  style={{
                    height: 44,
                    fontSize: 13,
                    fontWeight: 500,
                    background: "var(--rs-accent)",
                    color: "white",
                    border: "none",
                    whiteSpace: "nowrap",
                    boxShadow: "0 4px 24px rgba(124,108,245,0.35)",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--rs-accent-hover)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--rs-accent)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  Join the waitlist
                  <ArrowRight size={13} />
                </button>
              </>
            )}
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--rs-text-muted)",
              marginTop: 16,
            }}
          >
            No credit card required. Private beta invites sent weekly.
          </p>
        </motion.div>
      </section>

      {/* Footer */}
      <footer
        className="relative z-10 flex flex-col md:flex-row items-center justify-between px-8 md:px-16 py-8 gap-4"
        style={{ borderTop: "1px solid var(--rs-border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center rounded-md"
            style={{
              width: 20,
              height: 20,
              background: "var(--rs-accent)",
              opacity: 0.8,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1L12.5 4.5V10.5L7 14L1.5 10.5V4.5L7 1Z"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
              />
              <circle cx="7" cy="7" r="2" fill="white" />
            </svg>
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--rs-text-muted)",
            }}
          >
            RepoBuddy
          </span>
          <span style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>
            · © 2026
          </span>
        </div>
        <div className="flex items-center gap-6">
          {["Privacy", "Terms", "Security", "Status"].map((item) => (
            <a
              key={item}
              href="#"
              style={{
                fontSize: 12,
                color: "var(--rs-text-muted)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-secondary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--rs-text-muted)")
              }
            >
              {item}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
