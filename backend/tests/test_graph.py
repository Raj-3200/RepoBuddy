"""Tests for graph builder and analyzer."""

import networkx as nx

from app.graph.builder import build_dependency_graph, resolve_import
from app.graph.analyzer import (
    compute_graph_metrics,
    detect_cycles,
    compute_risk_scores,
    identify_modules,
    find_isolated_nodes,
)
from app.parsers.base import ParseResult, ParsedImport


class TestGraphBuilder:
    def test_builds_graph_from_parse_results(self):
        results = [
            ParseResult(
                file_path="src/index.ts",
                language="TypeScript",
                imports=[ParsedImport(source="./utils", specifiers=["helper"])],
            ),
            ParseResult(
                file_path="src/utils.ts",
                language="TypeScript",
                imports=[ParsedImport(source="./config", specifiers=["settings"])],
            ),
        ]
        repo_files = {"src/index.ts", "src/utils.ts", "src/config.ts"}
        graph = build_dependency_graph(results, repo_files)

        assert graph.number_of_nodes() == 3
        assert graph.has_edge("src/index.ts", "src/utils.ts")
        assert graph.has_edge("src/utils.ts", "src/config.ts")

    def test_skips_external_imports(self):
        results = [
            ParseResult(
                file_path="src/app.ts",
                language="TypeScript",
                imports=[
                    ParsedImport(source="react", specifiers=["useState"]),
                    ParsedImport(source="./lib", specifiers=["api"]),
                ],
            ),
        ]
        repo_files = {"src/app.ts", "src/lib.ts"}
        graph = build_dependency_graph(results, repo_files)

        # react should not be a node
        assert "react" not in graph.nodes()
        assert graph.has_edge("src/app.ts", "src/lib.ts")


class TestImportResolution:
    def test_resolves_relative_import(self):
        repo_files = {"src/utils.ts", "src/index.ts"}
        result = resolve_import("./utils", "src/index.ts", repo_files)
        assert result == "src/utils.ts"

    def test_resolves_index_file(self):
        repo_files = {"src/lib/index.ts", "src/app.ts"}
        result = resolve_import("./lib", "src/app.ts", repo_files)
        assert result == "src/lib/index.ts"

    def test_skips_external_packages(self):
        repo_files = {"src/app.ts"}
        result = resolve_import("react", "src/app.ts", repo_files)
        assert result is None

    def test_resolves_parent_directory(self):
        repo_files = {"src/utils.ts", "src/components/Button.ts"}
        result = resolve_import("../utils", "src/components/Button.ts", repo_files)
        assert result == "src/utils.ts"


class TestGraphAnalyzer:
    def _build_sample_graph(self) -> nx.DiGraph:
        g = nx.DiGraph()
        g.add_edges_from([
            ("src/index.ts", "src/app.ts"),
            ("src/app.ts", "src/utils.ts"),
            ("src/app.ts", "src/config.ts"),
            ("src/utils.ts", "src/config.ts"),
            ("src/routes.ts", "src/app.ts"),
            ("src/routes.ts", "src/utils.ts"),
        ])
        g.add_node("src/isolated.ts")
        return g

    def test_compute_metrics(self):
        graph = self._build_sample_graph()
        metrics = compute_graph_metrics(graph)
        assert metrics["total_nodes"] == 6
        assert metrics["total_edges"] == 6
        assert len(metrics["central_files"]) > 0

    def test_detect_cycles(self):
        g = nx.DiGraph()
        g.add_edges_from([("a", "b"), ("b", "c"), ("c", "a")])
        cycles = detect_cycles(g)
        assert len(cycles) > 0

    def test_no_cycles(self):
        g = nx.DiGraph()
        g.add_edges_from([("a", "b"), ("b", "c")])
        cycles = detect_cycles(g)
        assert len(cycles) == 0

    def test_find_isolated(self):
        graph = self._build_sample_graph()
        isolated = find_isolated_nodes(graph)
        assert "src/isolated.ts" in isolated

    def test_identify_modules(self):
        graph = self._build_sample_graph()
        modules = identify_modules(graph)
        assert len(modules) > 0
        module_names = [m["name"] for m in modules]
        assert "src" in module_names
