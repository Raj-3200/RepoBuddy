import { useEffect, useState } from "react";

/**
 * SectionNav — sticky in-page anchor nav for long editorial pages
 * (Insights, Intelligence, Docs). Renders a thin vertical rail.
 */
export function SectionNav({
  items,
}: {
  items: { id: string; label: string }[];
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const onScroll = () => {
      let current = items[0]?.id ?? "";
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - 120 <= 0) current = it.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [items]);

  return (
    <nav
      aria-label="Section navigation"
      style={{
        position: "sticky",
        top: 24,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        paddingLeft: 12,
        borderLeft: "1px solid var(--rs-hairline)",
      }}
    >
      {items.map((it) => {
        const isActive = it.id === active;
        return (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(it.id);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            style={{
              fontSize: "var(--rs-text-meta)",
              fontWeight: isActive ? 500 : 400,
              color: isActive
                ? "var(--rs-text-primary)"
                : "var(--rs-text-muted)",
              textDecoration: "none",
              padding: "4px 0",
              transition: "color var(--rs-dur-fast) var(--rs-ease-standard)",
            }}
          >
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
