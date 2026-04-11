import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/AppShell";
import { Folder, FileText, ChevronRight, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import {
  getFileTree,
  getFileDetail,
  type FileTreeNode,
  type FileDetail,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/files")({
  head: () => ({
    meta: [
      { title: "Files — RepoSage" },
      {
        name: "description",
        content: "Browse and explore your codebase file structure.",
      },
    ],
  }),
  component: FilesPage,
});

function TreeNodeView({
  node,
  depth = 0,
  onSelect,
}: {
  node: FileTreeNode;
  depth?: number;
  onSelect: (node: FileTreeNode) => void;
}) {
  const [open, setOpen] = useState(depth < 1);

  return (
    <div>
      <button
        onClick={() => {
          if (node.is_directory) setOpen(!open);
          else onSelect(node);
        }}
        className={`w-full flex items-center gap-2 py-2 px-3 text-left transition-smooth hover:bg-secondary/30 rounded-md group ${
          node.is_directory ? "cursor-pointer" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {node.is_directory ? (
          <ChevronRight
            className={`w-3 h-3 text-muted-foreground/40 transition-transform ${open ? "rotate-90" : ""}`}
          />
        ) : (
          <div className="w-3" />
        )}
        {node.is_directory ? (
          <Folder className="w-3.5 h-3.5 text-primary/50" strokeWidth={1.5} />
        ) : (
          <FileText
            className="w-3.5 h-3.5 text-muted-foreground/40"
            strokeWidth={1.5}
          />
        )}
        <span className="text-[13px] text-foreground font-mono flex-1 truncate">
          {node.name}
        </span>
        {!node.is_directory && node.size_bytes > 0 && (
          <span className="text-[10px] text-muted-foreground/40 font-mono hidden group-hover:block">
            {Math.ceil(node.size_bytes / 1024)}KB
          </span>
        )}
      </button>
      {node.is_directory &&
        open &&
        node.children?.map((child) => (
          <TreeNodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function FilesPage() {
  const { activeRepoId } = useAppStore();
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    if (!activeRepoId) {
      setLoading(false);
      return;
    }
    getFileTree(activeRepoId)
      .then(setTree)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeRepoId]);

  const handleFileSelect = (node: FileTreeNode) => {
    if (!node.id || node.is_directory) return;
    setFileLoading(true);
    getFileDetail(node.id)
      .then(setSelectedFile)
      .catch(() => {})
      .finally(() => setFileLoading(false));
  };

  if (!activeRepoId) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            No repository selected.{" "}
            <a href="/upload" className="text-primary hover:underline">
              Connect one
            </a>
            .
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full">
        {/* File tree */}
        <div className="w-72 border-r border-border/40 p-3 overflow-y-auto shrink-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            tree.map((node) => (
              <TreeNodeView
                key={node.path}
                node={node}
                onSelect={handleFileSelect}
              />
            ))
          )}
          {!loading && tree.length === 0 && (
            <p className="text-[12px] text-muted-foreground px-3 py-4">
              No files found.
            </p>
          )}
        </div>

        {/* File preview */}
        <div className="flex-1 p-6 md:p-10 overflow-y-auto">
          {fileLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedFile ? (
            <>
              <div className="mb-6">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-2">
                  {selectedFile.path.split("/").map((part, i, arr) => (
                    <span key={i} className="flex items-center gap-2">
                      {i > 0 && <ChevronRight className="w-3 h-3" />}
                      <span
                        className={
                          i === arr.length - 1 ? "text-foreground" : ""
                        }
                      >
                        {part}
                      </span>
                    </span>
                  ))}
                </div>
                <h2 className="text-lg font-semibold text-foreground tracking-tight">
                  {selectedFile.name}
                </h2>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-8">
                {[
                  ["Lines", String(selectedFile.line_count)],
                  ["Dependencies", String(selectedFile.dependencies.length)],
                  ["Dependents", String(selectedFile.dependents.length)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="p-3 rounded-lg border border-border/40 bg-card/15"
                  >
                    <span className="text-[10px] text-muted-foreground block mb-1">
                      {label}
                    </span>
                    <span className="text-sm font-mono text-foreground font-medium">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Symbols */}
              {selectedFile.symbols.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">
                    Symbols
                  </h3>
                  <div className="space-y-1">
                    {selectedFile.symbols.map((sym) => (
                      <div
                        key={sym.id}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-secondary/20 text-[12px]"
                      >
                        <span className="text-[10px] text-muted-foreground/60 font-mono w-16 shrink-0">
                          {sym.symbol_type}
                        </span>
                        <span className="font-mono text-foreground">
                          {sym.name}
                        </span>
                        {sym.is_exported && (
                          <span className="text-[9px] text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded">
                            exported
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Code preview */}
              {selectedFile.content && (
                <div className="rounded-xl border border-border/40 bg-card/20 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border/40 flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      Preview
                    </span>
                  </div>
                  <pre className="p-5 text-[12px] font-mono text-muted-foreground leading-6 overflow-x-auto max-h-96">
                    <code>{selectedFile.content}</code>
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">
                Select a file to preview
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
