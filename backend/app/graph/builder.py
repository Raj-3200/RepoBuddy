"""Graph builder — constructs NetworkX graph from parsed data."""

from __future__ import annotations

from pathlib import PurePosixPath

import networkx as nx

from app.parsers.base import ParseResult, ParsedImport
from app.core.logging import get_logger

logger = get_logger(__name__)


def build_dependency_graph(
    parse_results: list[ParseResult],
    repo_files: set[str],
) -> nx.DiGraph:
    """Build a directed dependency graph from parse results.

    Nodes are file paths. Edges represent import relationships.
    """
    graph = nx.DiGraph()

    # Add all files as nodes
    for file_path in repo_files:
        graph.add_node(file_path, type="file", label=PurePosixPath(file_path).name)

    # Add edges from imports
    for result in parse_results:
        source = result.file_path
        if source not in graph:
            graph.add_node(source, type="file", label=PurePosixPath(source).name)

        for imp in result.imports:
            resolved = resolve_import(imp.source, source, repo_files)
            if resolved and resolved != source:
                graph.add_edge(
                    source,
                    resolved,
                    type="imports",
                    specifiers=imp.specifiers,
                    line=imp.line,
                )

    return graph


def resolve_import(
    import_source: str,
    importing_file: str,
    repo_files: set[str],
) -> str | None:
    """Resolve an import path to a file path in the repository.

    Handles relative and bare specifier imports.
    """
    if not import_source:
        return None

    # Skip node_modules / external packages
    if not import_source.startswith(".") and not import_source.startswith("/"):
        return None

    importing_dir = str(PurePosixPath(importing_file).parent)

    if import_source.startswith("."):
        # Relative import
        resolved = str(PurePosixPath(importing_dir) / import_source)
        resolved = _normalize_path(resolved)
    else:
        resolved = import_source.lstrip("/")

    # Try various extensions
    candidates = [
        resolved,
        f"{resolved}.js",
        f"{resolved}.jsx",
        f"{resolved}.ts",
        f"{resolved}.tsx",
        f"{resolved}/index.js",
        f"{resolved}/index.ts",
        f"{resolved}/index.jsx",
        f"{resolved}/index.tsx",
    ]

    for candidate in candidates:
        normalized = _normalize_path(candidate)
        if normalized in repo_files:
            return normalized

    return None


def _normalize_path(path: str) -> str:
    """Normalize a path by resolving .. and . segments."""
    parts: list[str] = []
    for part in path.replace("\\", "/").split("/"):
        if part == "..":
            if parts:
                parts.pop()
        elif part != "." and part != "":
            parts.append(part)
    return "/".join(parts)
