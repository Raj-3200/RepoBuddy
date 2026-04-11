"""Graph analysis — computes metrics, detects cycles, identifies central modules."""

from __future__ import annotations

import networkx as nx

from app.core.logging import get_logger

logger = get_logger(__name__)


def compute_graph_metrics(graph: nx.DiGraph) -> dict:
    """Compute comprehensive graph metrics."""
    metrics = {
        "total_nodes": graph.number_of_nodes(),
        "total_edges": graph.number_of_edges(),
        "density": nx.density(graph) if graph.number_of_nodes() > 1 else 0,
    }

    if graph.number_of_nodes() == 0:
        return metrics

    # Degree centrality
    in_degree = dict(graph.in_degree())
    out_degree = dict(graph.out_degree())

    metrics["avg_in_degree"] = sum(in_degree.values()) / len(in_degree) if in_degree else 0
    metrics["avg_out_degree"] = sum(out_degree.values()) / len(out_degree) if out_degree else 0

    # Most connected (central) files
    total_degree = {n: in_degree.get(n, 0) + out_degree.get(n, 0) for n in graph.nodes()}
    sorted_by_degree = sorted(total_degree.items(), key=lambda x: x[1], reverse=True)
    metrics["central_files"] = [
        {"path": path, "connections": count}
        for path, count in sorted_by_degree[:10]
    ]

    # Most depended-on files
    sorted_by_in = sorted(in_degree.items(), key=lambda x: x[1], reverse=True)
    metrics["most_imported"] = [
        {"path": path, "importers": count}
        for path, count in sorted_by_in[:10]
    ]

    # Files with most dependencies
    sorted_by_out = sorted(out_degree.items(), key=lambda x: x[1], reverse=True)
    metrics["most_dependencies"] = [
        {"path": path, "dependencies": count}
        for path, count in sorted_by_out[:10]
    ]

    return metrics


def detect_cycles(graph: nx.DiGraph) -> list[list[str]]:
    """Detect all circular dependencies in the graph."""
    try:
        cycles = list(nx.simple_cycles(graph))
        # Sort by cycle length (shorter cycles are usually more problematic)
        cycles.sort(key=len)
        return cycles[:50]  # Limit to prevent massive output
    except Exception as e:
        logger.warning("cycle_detection_error", error=str(e))
        return []


def find_isolated_nodes(graph: nx.DiGraph) -> list[str]:
    """Find nodes with no incoming or outgoing edges."""
    return [n for n in graph.nodes() if graph.degree(n) == 0]


def compute_betweenness_centrality(graph: nx.DiGraph) -> dict[str, float]:
    """Compute betweenness centrality for identifying bridge files."""
    if graph.number_of_nodes() < 3:
        return {}

    try:
        centrality = nx.betweenness_centrality(graph)
        # Return top results sorted by centrality
        sorted_centrality = sorted(centrality.items(), key=lambda x: x[1], reverse=True)
        return {path: score for path, score in sorted_centrality[:20] if score > 0}
    except Exception as e:
        logger.warning("centrality_computation_error", error=str(e))
        return {}


def identify_modules(graph: nx.DiGraph) -> list[dict]:
    """Identify logical modules based on directory structure and connectivity."""
    # Group files by directory
    dir_groups: dict[str, list[str]] = {}
    for node in graph.nodes():
        parts = node.split("/")
        if len(parts) > 1:
            module = parts[0]
        else:
            module = "root"
        dir_groups.setdefault(module, []).append(node)

    modules = []
    for module_name, files in sorted(dir_groups.items(), key=lambda x: len(x[1]), reverse=True):
        # Count inter-module and intra-module edges
        internal_edges = 0
        external_edges = 0
        for f in files:
            for _, target in graph.out_edges(f):
                if target in files:
                    internal_edges += 1
                else:
                    external_edges += 1

        modules.append({
            "name": module_name,
            "file_count": len(files),
            "internal_edges": internal_edges,
            "external_edges": external_edges,
            "cohesion": internal_edges / max(internal_edges + external_edges, 1),
        })

    return modules


def compute_risk_scores(graph: nx.DiGraph) -> list[dict]:
    """Compute risk scores for files based on multiple heuristics."""
    risk_items: list[dict] = []
    betweenness = compute_betweenness_centrality(graph)

    for node in graph.nodes():
        in_deg = graph.in_degree(node)
        out_deg = graph.out_degree(node)
        centrality = betweenness.get(node, 0)

        # High fan-in = many files depend on this (risky to change)
        # High fan-out = tightly coupled to many files
        # High betweenness = bridge file
        risk_score = (
            min(in_deg / 10, 1.0) * 0.4
            + min(out_deg / 15, 1.0) * 0.3
            + min(centrality * 10, 1.0) * 0.3
        )

        if risk_score > 0.3:
            risk_items.append({
                "path": node,
                "risk_score": round(risk_score, 3),
                "in_degree": in_deg,
                "out_degree": out_deg,
                "betweenness": round(centrality, 4),
                "reason": _risk_reason(in_deg, out_deg, centrality),
            })

    risk_items.sort(key=lambda x: x["risk_score"], reverse=True)
    return risk_items[:20]


def _risk_reason(in_deg: int, out_deg: int, centrality: float) -> str:
    reasons = []
    if in_deg >= 5:
        reasons.append(f"heavily depended on ({in_deg} importers)")
    if out_deg >= 8:
        reasons.append(f"high coupling ({out_deg} dependencies)")
    if centrality > 0.05:
        reasons.append("critical bridge in dependency chain")
    return "; ".join(reasons) if reasons else "moderate risk"
