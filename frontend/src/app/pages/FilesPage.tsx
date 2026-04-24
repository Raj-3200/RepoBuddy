import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileCode,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  Search,
  Target,
  X,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AnalyzePlaceholder } from "@/app/components/AnalyzePlaceholder";
import {
  getFileTree,
  getFileDetail,
  type FileTreeNode as APIFileTreeNode,
  type FileDetail as APIFileDetail,
} from "@/lib/api";
import {
  Card,
  CardHeader,
  DotSep,
  EmptyState,
  Eyebrow,
  FadeIn,
  MetaText,
  Mono,
  Path,
  Section,
  Skeleton,
  Tag,
} from "../ds";

interface FileNode {
  id: string | null;
  name: string;
  path: string;
  type: "file" | "dir";
  ext: string | null;
  size: number;
  children?: FileNode[];
}

function adapt(nodes: APIFileTreeNode[]): FileNode[] {
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    path: n.path,
    type: n.is_directory ? "dir" : "file",
    ext: n.extension,
    size: n.size_bytes ?? 0,
    children: n.children ? adapt(n.children) : undefined,
  }));
}

function find(nodes: FileNode[], path: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const f = find(n.children, path);
      if (f) return f;
    }
  }
  return undefined;
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce(
    (acc, n) =>
      acc +
      (n.type === "file" ? 1 : 0) +
      (n.children ? countFiles(n.children) : 0),
    0,
  );
}

function findSiblings(
  nodes: FileNode[],
  targetPath: string,
): { folder: string; siblings: FileNode[] } {
  // Find the parent directory of the target file in the tree.
  const walk = (
    items: FileNode[],
    parentPath: string,
  ): { folder: string; siblings: FileNode[] } | null => {
    for (const n of items) {
      if (n.path === targetPath) return { folder: parentPath, siblings: items };
      if (n.children) {
        const r = walk(n.children, n.path);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(nodes, "") ?? { folder: "", siblings: [] };
}

interface LowSignalProfile {
  kind:
    | "documentation"
    | "config"
    | "fixture"
    | "test"
    | "asset"
    | "script"
    | "unknown";
  why: string;
  usage: string;
}

function classifyLowSignal(path: string, ext: string | null): LowSignalProfile {
  const lower = path.toLowerCase();
  const e = (ext ?? "").toLowerCase();
  if (e === ".md" || e === ".mdx" || e === ".rst" || e === ".txt") {
    return {
      kind: "documentation",
      why: "Documentation files don't appear in the dependency graph but often define how the rest of the code is meant to be used.",
      usage:
        "Treat as a contract for intent. Changes here may signal that downstream code should change too.",
    };
  }
  if (
    e === ".json" ||
    e === ".yml" ||
    e === ".yaml" ||
    e === ".toml" ||
    e === ".ini" ||
    e === ".env" ||
    lower.includes("config") ||
    lower.endsWith("rc")
  ) {
    return {
      kind: "config",
      why: "Configuration files are read at runtime by tools or services. They don't import code, but code reads them.",
      usage:
        "A change here can shift behavior across the whole repo without any code edit. Diff carefully.",
    };
  }
  if (
    lower.includes("/__tests__/") ||
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("/tests/") ||
    lower.includes("/fixtures/")
  ) {
    return {
      kind: lower.includes("fixture") ? "fixture" : "test",
      why: "Test and fixture files exercise the rest of the system but typically aren't imported by it.",
      usage:
        "Use as ground truth for expected behavior. If this fails, the code under test is the real subject.",
    };
  }
  if (
    e === ".png" ||
    e === ".jpg" ||
    e === ".jpeg" ||
    e === ".svg" ||
    e === ".gif" ||
    e === ".webp" ||
    e === ".ico"
  ) {
    return {
      kind: "asset",
      why: "Static assets ship with the app but aren't part of the call graph.",
      usage:
        "A swap here is usually visual only. Verify references in markup and CSS still resolve.",
    };
  }
  if (
    e === ".sh" ||
    e === ".ps1" ||
    e === ".bat" ||
    lower.includes("/scripts/") ||
    lower.includes("makefile") ||
    lower.includes("dockerfile")
  ) {
    return {
      kind: "script",
      why: "Scripts and build files orchestrate the project from outside the source tree.",
      usage:
        "Often invoked by CI or developers manually. Check pipeline history before editing.",
    };
  }
  return {
    kind: "unknown",
    why: "The analysis couldn't extract a public surface or graph edges from this file. It may be data, generated, or in a language not currently parsed.",
    usage:
      "Open the raw file to confirm its purpose. If it matters, it likely matters via convention rather than imports.",
  };
}

function filterTree(nodes: FileNode[], q: string): FileNode[] {
  if (!q.trim()) return nodes;
  const lower = q.toLowerCase();
  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === "file") {
      if (node.path.toLowerCase().includes(lower)) acc.push(node);
    } else {
      const kids = filterTree(node.children ?? [], q);
      if (kids.length > 0) acc.push({ ...node, children: kids });
    }
    return acc;
  }, []);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── tree row ───────────────────────────────────────────────────────────────

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
  forceOpen,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (n: FileNode) => void;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(forceOpen || depth < 1);

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            all: "unset",
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            paddingLeft: 8 + depth * 12,
            cursor: "pointer",
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-secondary)",
            borderRadius: "var(--rs-radius-sm)",
            transition: "background var(--rs-dur-fast) var(--rs-ease-standard)",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "var(--rs-surface-1)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "transparent")
          }
        >
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          {open ? (
            <FolderOpen size={11} color="var(--rs-text-muted)" />
          ) : (
            <Folder size={11} color="var(--rs-text-muted)" />
          )}
          <span style={{ fontFamily: "var(--rs-font-mono)" }}>{node.name}</span>
        </button>
        {open && (
          <div>
            {node.children?.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                forceOpen={forceOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <button
      onClick={() => onSelect(node)}
      style={{
        all: "unset",
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        paddingLeft: 8 + depth * 12 + 12,
        cursor: "pointer",
        fontSize: "var(--rs-text-meta)",
        color: isSelected
          ? "var(--rs-text-primary)"
          : "var(--rs-text-secondary)",
        background: isSelected ? "var(--rs-surface-2)" : "transparent",
        borderLeft: isSelected
          ? "2px solid var(--rs-accent)"
          : "2px solid transparent",
        borderRadius: "var(--rs-radius-sm)",
        fontFamily: "var(--rs-font-mono)",
        transition: "background var(--rs-dur-fast) var(--rs-ease-standard)",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--rs-surface-1)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLButtonElement).style.background =
            "transparent";
      }}
    >
      <FileCode
        size={10}
        color={isSelected ? "var(--rs-accent)" : "var(--rs-text-muted)"}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.name}
      </span>
    </button>
  );
}

// ── detail blocks ──────────────────────────────────────────────────────────

function SymbolList({ symbols }: { symbols: APIFileDetail["symbols"] }) {
  if (!symbols || symbols.length === 0) {
    return (
      <EmptyState
        title="No symbols indexed"
        detail="The parser didn't surface any top-level functions or classes in this file."
      />
    );
  }
  return (
    <Card variant="flat" padding={0}>
      {symbols.slice(0, 40).map((s, i) => (
        <div
          key={s.id ?? `${s.name}-${i}`}
          className="flex items-center gap-3"
          style={{
            padding: "8px 14px",
            borderTop: i === 0 ? undefined : "1px solid var(--rs-hairline)",
          }}
        >
          <span
            style={{
              fontSize: "var(--rs-text-micro)",
              color: "var(--rs-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "var(--rs-tracking-wide)",
              minWidth: 56,
            }}
          >
            {s.symbol_type}
          </span>
          <Mono>{s.name}</Mono>
          {s.is_exported && (
            <span
              className="flex items-center gap-1"
              style={{
                fontSize: "var(--rs-text-micro)",
                color: "var(--rs-conf-deterministic)",
              }}
              title="Exported symbol"
            >
              <ArrowUpRight size={10} /> exported
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            L{s.line_start}
            {s.line_end ? `–${s.line_end}` : ""}
          </span>
        </div>
      ))}
    </Card>
  );
}

function RoleSummary({ detail }: { detail: APIFileDetail }) {
  const dependents = detail.dependents?.length ?? 0;
  const dependencies = detail.dependencies?.length ?? 0;
  const symbols = detail.symbols?.length ?? 0;
  const exported = (detail.symbols ?? []).filter((s) => s.is_exported).length;

  let role = "Internal module";
  let detail_text =
    "A regular file in the project. Edit confidently if its blast radius is small.";

  if (detail.is_entry_point) {
    role = "Application entry point";
    detail_text =
      "Boots part of the system. Changes here can affect startup, configuration, or routing — review broadly.";
  } else if (dependents >= 12) {
    role = "Fan-in hub";
    detail_text = `Imported by ${dependents} other files. Treat as a contract: breaking changes here ripple widely.`;
  } else if (dependents >= 4 && exported >= 3) {
    role = "Shared utility";
    detail_text = `${exported} exported symbol${exported === 1 ? "" : "s"} consumed across ${dependents} files. Public surface — keep signatures stable.`;
  } else if (dependencies >= 15) {
    role = "Orchestrator";
    detail_text = `Pulls in ${dependencies} modules. Often glue or coordinator code — bugs here can mask the real failure site.`;
  } else if (dependents === 0 && dependencies === 0) {
    role = "Standalone";
    detail_text =
      "Not connected to the tracked dependency graph. May be a script, fixture, or unused.";
  } else if (symbols === 0) {
    role = "Configuration / data";
    detail_text =
      "No top-level symbols indexed. Likely config, constants, or templated content.";
  }

  return (
    <Card variant="flat" padding={16}>
      <Eyebrow>Role in this codebase</Eyebrow>
      <div
        style={{
          marginTop: 6,
          fontSize: "var(--rs-text-heading)",
          fontWeight: 500,
          color: "var(--rs-text-primary)",
          letterSpacing: "var(--rs-tracking-snug)",
        }}
      >
        {role}
      </div>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "var(--rs-text-body)",
          lineHeight: "var(--rs-leading-relaxed)",
          color: "var(--rs-text-secondary)",
          maxWidth: "60ch",
        }}
      >
        {detail_text}
      </p>
    </Card>
  );
}

function LowSignalGuidance({
  path,
  ext,
  tree,
  onSelectFile,
}: {
  path: string;
  ext: string | null;
  tree: FileNode[];
  onSelectFile: (path: string) => void;
}) {
  const profile = classifyLowSignal(path, ext);
  const { folder, siblings } = findSiblings(tree, path);
  const nearby = siblings
    .filter((n) => n.type === "file" && n.path !== path)
    .slice(0, 6);
  const folderLabel = folder || "this folder";

  return (
    <Card variant="flat" padding={16}>
      <Eyebrow>Why this file may still matter</Eyebrow>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "var(--rs-text-body)",
          lineHeight: "var(--rs-leading-relaxed)",
          color: "var(--rs-text-secondary)",
          maxWidth: "62ch",
        }}
      >
        {profile.why}
      </p>

      <div style={{ marginTop: 16 }}>
        <Eyebrow>Likely usage pattern</Eyebrow>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: "var(--rs-text-body)",
            lineHeight: "var(--rs-leading-relaxed)",
            color: "var(--rs-text-secondary)",
            maxWidth: "62ch",
          }}
        >
          {profile.usage}
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        <Eyebrow>Suggested next places to inspect</Eyebrow>
        <ul
          style={{
            margin: "6px 0 0",
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: "var(--rs-text-body)",
            lineHeight: "var(--rs-leading-relaxed)",
            color: "var(--rs-text-secondary)",
          }}
        >
          {profile.kind === "documentation" && (
            <>
              <li>The README or top-level docs that link here.</li>
              <li>Any code that mentions this file by name in a comment.</li>
            </>
          )}
          {profile.kind === "config" && (
            <>
              <li>Code that calls a config loader for this filename.</li>
              <li>CI workflows or Dockerfiles that copy or reference it.</li>
            </>
          )}
          {(profile.kind === "test" || profile.kind === "fixture") && (
            <>
              <li>
                The module under test (typically the matching source file).
              </li>
              <li>Other tests in the same folder for related expectations.</li>
            </>
          )}
          {profile.kind === "asset" && (
            <>
              <li>Markup or styles that reference this asset by path.</li>
              <li>Build configuration that bundles or copies static files.</li>
            </>
          )}
          {profile.kind === "script" && (
            <>
              <li>CI definitions that invoke this script.</li>
              <li>The README "scripts" or "tasks" section.</li>
            </>
          )}
          {profile.kind === "unknown" && (
            <>
              <li>Files in {folderLabel} that may import or reference it.</li>
              <li>The repo README for any explicit mention.</li>
            </>
          )}
        </ul>
      </div>

      {nearby.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Eyebrow>Nearby files in {folderLabel || "the same folder"}</Eyebrow>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {nearby.map((n) => (
              <button
                key={n.path}
                onClick={() => onSelectFile(n.path)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "4px 0",
                  fontSize: "var(--rs-text-body)",
                  fontFamily: "var(--rs-font-mono)",
                  color: "var(--rs-text-primary)",
                }}
              >
                {n.name}
                <span
                  style={{
                    marginLeft: 8,
                    fontFamily: "var(--rs-base)",
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-muted)",
                  }}
                >
                  {formatSize(n.size)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function PathColumn({
  title,
  paths,
  empty,
}: {
  title: string;
  paths: string[];
  empty: string;
}) {
  return (
    <Card variant="flat" padding={14}>
      <CardHeader title={title} />
      <div style={{ marginTop: 10 }}>
        {paths.length === 0 ? (
          <MetaText style={{ fontStyle: "italic" }}>{empty}</MetaText>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {paths.slice(0, 24).map((p) => (
              <Path key={p} value={p} />
            ))}
            {paths.length > 24 && (
              <MetaText>+{paths.length - 24} more</MetaText>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function FilesPage() {
  const navigate = useNavigate();
  const { activeRepoId } = useAppStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileNode | null>(null);
  const [detail, setDetail] = useState<APIFileDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!activeRepoId) {
      setLoadingTree(false);
      return;
    }
    setLoadingTree(true);
    setSelectedPath(null);
    setSelected(null);
    setDetail(null);
    getFileTree(activeRepoId)
      .then((nodes) => setTree(adapt(nodes)))
      .catch(() => {})
      .finally(() => setLoadingTree(false));
  }, [activeRepoId]);

  const filtered = useMemo(() => filterTree(tree, search), [tree, search]);
  const total = useMemo(() => countFiles(tree), [tree]);
  const matching = useMemo(() => countFiles(filtered), [filtered]);

  const pickFile = (n: FileNode) => {
    setSelectedPath(n.path);
    setSelected(n);
    setDetail(null);
    if (!n.id) return;
    setLoadingDetail(true);
    getFileDetail(n.id)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  };

  if (!activeRepoId) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ padding: 32 }}
      >
        <AnalyzePlaceholder
          title="No repository selected"
          detail="Analyze a repository to see further details."
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full"
      style={{ background: "var(--rs-base)", minHeight: 0 }}
    >
      {/* ── Tree rail ─────────────────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0"
        style={{
          width: 280,
          borderRight: "1px solid var(--rs-hairline)",
          background: "var(--rs-surface-0)",
        }}
      >
        <div
          style={{
            padding: "16px 14px 12px",
            borderBottom: "1px solid var(--rs-hairline)",
          }}
        >
          <Eyebrow>Files in repo</Eyebrow>
          <div
            className="flex items-center gap-1.5"
            style={{ marginTop: 4, color: "var(--rs-text-muted)" }}
          >
            <MetaText>
              {total.toLocaleString()} file{total === 1 ? "" : "s"}
            </MetaText>
            {search && (
              <>
                <DotSep />
                <span
                  style={{
                    fontSize: "var(--rs-text-meta)",
                    color: "var(--rs-text-secondary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {matching} matching
                </span>
              </>
            )}
          </div>
        </div>

        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--rs-hairline)",
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              padding: "6px 10px",
              background: "var(--rs-surface-1)",
              border: "1px solid var(--rs-hairline)",
              borderRadius: "var(--rs-radius-md)",
            }}
          >
            <Search size={11} color="var(--rs-text-muted)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by path…"
              spellCheck={false}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-primary)",
                fontFamily: "var(--rs-font-mono)",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  color: "var(--rs-text-muted)",
                  display: "flex",
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 6px" }}>
          {loadingTree ? (
            <div
              style={{
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} width="80%" height={10} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 16 }}>
              <MetaText>
                {search ? "No files match your filter." : "No files indexed."}
              </MetaText>
            </div>
          ) : (
            filtered.map((n) => (
              <TreeRow
                key={n.path}
                node={n}
                depth={0}
                selectedPath={selectedPath}
                onSelect={pickFile}
                forceOpen={!!search}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Detail pane ───────────────────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        {!selectedPath ? (
          <div
            style={{
              maxWidth: 720,
              margin: "0 auto",
              padding: "64px 32px",
            }}
          >
            <Eyebrow>Files</Eyebrow>
            <h1
              style={{
                margin: "8px 0 12px",
                fontSize: "var(--rs-text-display)",
                lineHeight: "var(--rs-leading-tight)",
                letterSpacing: "var(--rs-tracking-tight)",
                fontWeight: 600,
                color: "var(--rs-text-primary)",
              }}
            >
              Browse the codebase by file
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "var(--rs-text-body)",
                lineHeight: "var(--rs-leading-relaxed)",
                color: "var(--rs-text-secondary)",
                maxWidth: 560,
              }}
            >
              Pick any file from the tree on the left. We'll show its symbols,
              imports, and dependents — everything we know about the file's role
              in the graph.
            </p>
            <div style={{ marginTop: 28 }}>
              <EmptyState
                icon={<FileCode size={16} />}
                title="No file selected"
                detail={`Filter the ${total.toLocaleString()} indexed files by path, then click a file to inspect it.`}
              />
            </div>
          </div>
        ) : (
          <FadeIn key={selectedPath}>
            <div
              style={{
                maxWidth: 980,
                margin: "0 auto",
                padding: "32px 32px 64px",
                display: "flex",
                flexDirection: "column",
                gap: 28,
              }}
            >
              {/* header */}
              <header>
                <Eyebrow>File</Eyebrow>
                <div
                  style={{
                    margin: "8px 0 10px",
                    fontFamily: "var(--rs-font-mono)",
                    fontSize: "var(--rs-text-title)",
                    fontWeight: 600,
                    color: "var(--rs-text-primary)",
                    letterSpacing: "var(--rs-tracking-snug)",
                    wordBreak: "break-all",
                  }}
                >
                  {selectedPath}
                </div>
                <div
                  className="flex items-center gap-2 flex-wrap"
                  style={{ color: "var(--rs-text-muted)" }}
                >
                  {detail?.language && <MetaText>{detail.language}</MetaText>}
                  {detail?.language && <DotSep />}
                  <MetaText>
                    {(detail?.line_count ?? 0).toLocaleString()} lines
                  </MetaText>
                  <DotSep />
                  <MetaText>
                    {formatSize(detail?.size_bytes ?? selected?.size ?? 0)}
                  </MetaText>
                  {detail?.is_entry_point && (
                    <>
                      <DotSep />
                      <span
                        className="flex items-center gap-1"
                        style={{ color: "var(--rs-accent)" }}
                        title="Application entry point"
                      >
                        <Target size={11} /> entry point
                      </span>
                    </>
                  )}
                </div>
              </header>

              {loadingDetail || !detail ? (
                <Card variant="flat" padding={20}>
                  <Skeleton width="60%" height={14} />
                  <div style={{ marginTop: 10 }}>
                    <Skeleton width="100%" height={6} radius={3} />
                  </div>
                  <div
                    className="flex items-center gap-2"
                    style={{ marginTop: 14, color: "var(--rs-text-muted)" }}
                  >
                    <Loader2 className="animate-spin" size={12} />
                    <MetaText>Loading file detail…</MetaText>
                  </div>
                </Card>
              ) : (
                <>
                  <RoleSummary detail={detail} />

                  {(detail.symbols?.length ?? 0) === 0 &&
                    (detail.dependencies?.length ?? 0) === 0 &&
                    (detail.dependents?.length ?? 0) === 0 && (
                      <LowSignalGuidance
                        path={detail.path}
                        ext={
                          detail.path.includes(".")
                            ? "." + detail.path.split(".").pop()!
                            : null
                        }
                        tree={tree}
                        onSelectFile={(p) => {
                          const n = find(tree, p);
                          if (n) pickFile(n);
                        }}
                      />
                    )}

                  <Section
                    id="symbols"
                    title="Symbols"
                    description="Top-level functions, classes, and types found in this file."
                  >
                    <SymbolList symbols={detail.symbols} />
                  </Section>

                  <Section
                    id="edges"
                    title="Edges"
                    description="What this file depends on, and what depends on it. Together these are its blast radius."
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      <PathColumn
                        title={`Dependencies (${detail.dependencies?.length ?? 0})`}
                        paths={detail.dependencies ?? []}
                        empty="This file imports nothing tracked by the analysis."
                      />
                      <PathColumn
                        title={`Dependents (${detail.dependents?.length ?? 0})`}
                        paths={detail.dependents ?? []}
                        empty="No other tracked files import this one."
                      />
                    </div>
                  </Section>

                  {detail.imports && detail.imports.length > 0 && (
                    <Section
                      id="imports"
                      title="Raw imports"
                      description="The literal import statements found in this file."
                    >
                      <Card variant="flat" padding={14}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          {detail.imports.slice(0, 40).map((imp, i) => (
                            <Mono key={i}>{imp}</Mono>
                          ))}
                          {detail.imports.length > 40 && (
                            <MetaText>
                              +{detail.imports.length - 40} more
                            </MetaText>
                          )}
                        </div>
                      </Card>
                    </Section>
                  )}

                  <Section
                    id="next"
                    title="Take it further"
                    description="Continue with this file in another view."
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag
                        onClick={() => navigate("/app/graph")}
                        icon={<GitBranch size={11} />}
                      >
                        Open in graph
                      </Tag>
                      <Tag
                        onClick={() => navigate("/app/impact")}
                        icon={<Target size={11} />}
                      >
                        Plan a change to this file
                      </Tag>
                    </div>
                  </Section>
                </>
              )}
            </div>
          </FadeIn>
        )}
      </main>
    </div>
  );
}
