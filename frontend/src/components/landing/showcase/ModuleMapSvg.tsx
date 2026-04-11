import { motion } from "framer-motion";
import { ease } from "@/lib/motion";

const modules = [
  { id: "a", x: 52, y: 28, w: 88, h: 36, label: "Surface" },
  { id: "b", x: 200, y: 24, w: 72, h: 32, label: "Router" },
  { id: "c", x: 120, y: 108, w: 112, h: 44, label: "Core" },
  { id: "d", x: 280, y: 100, w: 80, h: 40, label: "Data" },
  { id: "e", x: 48, y: 188, w: 96, h: 36, label: "Workers" },
];

const links: [string, string][] = [
  ["a", "c"],
  ["b", "c"],
  ["c", "d"],
  ["c", "e"],
];

function centerOf(id: string) {
  const m = modules.find((x) => x.id === id)!;
  return { cx: m.x + m.w / 2, cy: m.y + m.h / 2 };
}

export function ModuleMapSvg() {
  return (
    <svg
      viewBox="0 0 400 260"
      className="h-full w-full max-w-[min(100%,26rem)] text-border/90"
      fill="none"
      aria-hidden
    >
      {links.map(([from, to], i) => {
        const p0 = centerOf(from);
        const p1 = centerOf(to);
        const d = `M ${p0.cx} ${p0.cy} C ${p0.cx} ${(p0.cy + p1.cy) / 2}, ${p1.cx} ${(p0.cy + p1.cy) / 2}, ${p1.cx} ${p1.cy}`;
        return (
          <motion.path
            key={`${from}-${to}`}
            d={d}
            stroke="currentColor"
            strokeWidth="0.75"
            strokeOpacity="0.32"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 1.2, delay: 0.08 * i, ease }}
          />
        );
      })}

      {modules.map((m, i) => (
        <motion.g
          key={m.id}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.65, delay: 0.06 * i, ease }}
        >
          <rect
            x={m.x}
            y={m.y}
            width={m.w}
            height={m.h}
            rx="7"
            className="fill-card/[0.72] stroke-border/50"
            strokeWidth="0.65"
          />
          <text
            x={m.x + m.w / 2}
            y={m.y + m.h / 2}
            dominantBaseline="middle"
            textAnchor="middle"
            className="fill-muted-foreground/90 text-[11px] font-medium"
            style={{ fontFamily: "Inter, system-ui, sans-serif" }}
          >
            {m.label}
          </text>
        </motion.g>
      ))}
    </svg>
  );
}
