"""Graph exploration routes."""

import uuid
from collections import deque

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import raise_not_found
from app.dependencies import get_db
from app.models.repository import Analysis, DependencyEdge, RepoFile, Symbol
from app.schemas.repository import (
    GraphEdge,
    GraphNeighborhoodRequest,
    GraphNode,
    GraphResponse,
)

router = APIRouter()


@router.get("/{analysis_id}", response_model=GraphResponse)
async def get_graph(
    analysis_id: uuid.UUID,
    edge_type: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Get dependency graph for an analysis. Returns a limited subgraph by default."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    # Query edges
    edge_query = select(DependencyEdge).where(DependencyEdge.analysis_id == analysis_id)
    if edge_type:
        edge_query = edge_query.where(DependencyEdge.edge_type == edge_type)
    edge_query = edge_query.limit(limit)

    edge_result = await db.execute(edge_query)
    edges = edge_result.scalars().all()

    # Collect unique node IDs
    node_ids: set[str] = set()
    graph_edges: list[GraphEdge] = []
    for edge in edges:
        node_ids.add(edge.source_path)
        node_ids.add(edge.target_path)
        graph_edges.append(
            GraphEdge(
                source=edge.source_path,
                target=edge.target_path,
                type=edge.edge_type.value if hasattr(edge.edge_type, "value") else edge.edge_type,
                label=edge.source_symbol,
            )
        )

    # Build nodes from edges
    graph_nodes: list[GraphNode] = []
    for node_id in node_ids:
        name = node_id.rsplit("/", 1)[-1] if "/" in node_id else node_id
        graph_nodes.append(
            GraphNode(
                id=node_id,
                label=name,
                type="file",
                metadata={},
            )
        )

    # If no edges found, build a file-based graph from repo files and symbols
    if not graph_nodes:
        repo_id = analysis.repository_id

        # Get source files (skip non-code files)
        code_extensions = {
            ".py",
            ".js",
            ".ts",
            ".tsx",
            ".jsx",
            ".java",
            ".go",
            ".rs",
            ".rb",
            ".php",
            ".c",
            ".cpp",
            ".h",
            ".cs",
            ".swift",
            ".kt",
        }
        file_result = await db.execute(
            select(RepoFile)
            .where(RepoFile.repository_id == repo_id)
            .where(RepoFile.extension.in_(code_extensions))
            .order_by(RepoFile.line_count.desc())
            .limit(limit)
        )
        repo_files = file_result.scalars().all()

        # Get symbols to create richer node metadata
        symbol_result = await db.execute(
            select(Symbol.file_path, func.count(Symbol.id).label("symbol_count"))
            .where(Symbol.analysis_id == analysis_id)
            .group_by(Symbol.file_path)
        )
        symbol_counts = {row.file_path: row.symbol_count for row in symbol_result}

        # Build directory groupings for edges
        dir_files: dict[str, list[str]] = {}
        for f in repo_files:
            parts = f.path.rsplit("/", 1)
            dir_name = parts[0] if len(parts) > 1 else "root"
            dir_files.setdefault(dir_name, []).append(f.path)

        # Add file nodes
        for f in repo_files:
            sym_count = symbol_counts.get(f.path, 0)
            graph_nodes.append(
                GraphNode(
                    id=f.path,
                    label=f.name,
                    type="file",
                    metadata={"language": f.language, "lines": f.line_count, "symbols": sym_count},
                )
            )

        # Create directory nodes and edges (file -> directory containment)
        for dir_name, files in dir_files.items():
            if len(files) >= 2:
                short_name = dir_name.rsplit("/", 1)[-1] if "/" in dir_name else dir_name
                graph_nodes.append(
                    GraphNode(
                        id=f"dir:{dir_name}",
                        label=short_name,
                        type="directory",
                        metadata={"file_count": len(files)},
                    )
                )
                for file_path in files:
                    graph_edges.append(
                        GraphEdge(
                            source=f"dir:{dir_name}",
                            target=file_path,
                            type="contains",
                            label=None,
                        )
                    )

    return GraphResponse(
        nodes=graph_nodes,
        edges=graph_edges,
        metadata={"total_nodes": len(graph_nodes), "total_edges": len(graph_edges)},
    )


@router.post("/{analysis_id}/neighborhood", response_model=GraphResponse)
async def get_graph_neighborhood(
    analysis_id: uuid.UUID,
    request: GraphNeighborhoodRequest,
    db: AsyncSession = Depends(get_db),
):
    """Get the neighborhood of a specific node in the graph."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    if not result.scalar_one_or_none():
        raise_not_found("Analysis not found")

    visited: set[str] = set()
    to_visit = {request.node_id}
    all_edges: list[DependencyEdge] = []

    for _depth in range(request.depth):
        if not to_visit:
            break

        for node_id in list(to_visit):
            if node_id in visited:
                continue
            visited.add(node_id)

            query = select(DependencyEdge).where(
                DependencyEdge.analysis_id == analysis_id,
                (DependencyEdge.source_path == node_id) | (DependencyEdge.target_path == node_id),
            )
            if request.edge_types:
                query = query.where(DependencyEdge.edge_type.in_(request.edge_types))

            edge_result = await db.execute(query)
            edges = edge_result.scalars().all()
            all_edges.extend(edges)

            for edge in edges:
                if edge.source_path not in visited:
                    to_visit.add(edge.source_path)
                if edge.target_path not in visited:
                    to_visit.add(edge.target_path)

        to_visit -= visited

    # Deduplicate
    seen_edge_ids: set[uuid.UUID] = set()
    graph_edges: list[GraphEdge] = []
    node_ids: set[str] = set()

    for edge in all_edges:
        if edge.id in seen_edge_ids:
            continue
        seen_edge_ids.add(edge.id)
        node_ids.add(edge.source_path)
        node_ids.add(edge.target_path)
        graph_edges.append(
            GraphEdge(
                source=edge.source_path,
                target=edge.target_path,
                type=edge.edge_type.value if hasattr(edge.edge_type, "value") else edge.edge_type,
            )
        )

    graph_nodes = [
        GraphNode(
            id=nid,
            label=nid.rsplit("/", 1)[-1] if "/" in nid else nid,
            type="file",
            metadata={"is_center": nid == request.node_id},
        )
        for nid in node_ids
    ]

    return GraphResponse(nodes=graph_nodes, edges=graph_edges)


# ────────────────────────── Change Impact Analysis ──────────────────────────


class ChangeImpactRequest(BaseModel):
    file_path: str
    depth: int = Field(default=3, ge=1, le=5)


class ImpactedFile(BaseModel):
    path: str
    distance: int
    fan_in: int = 0
    fan_out: int = 0
    risk_score: float = 0.0
    reason: str = ""


class ChangeImpactResponse(BaseModel):
    target_file: str
    direct_dependents: list[str]
    direct_dependencies: list[str]
    blast_radius: list[ImpactedFile]
    total_impacted: int
    risk_level: str  # low / medium / high / critical
    risk_score: float
    suggested_review: list[str]
    suggested_test_areas: list[str]
    graph: GraphResponse


@router.post("/{analysis_id}/impact", response_model=ChangeImpactResponse)
async def get_change_impact(
    analysis_id: uuid.UUID,
    request: ChangeImpactRequest,
    db: AsyncSession = Depends(get_db),
):
    """Compute the blast radius and impact of changing a specific file."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    if not result.scalar_one_or_none():
        raise_not_found("Analysis not found")

    # Load all edges for this analysis
    edge_result = await db.execute(
        select(DependencyEdge).where(DependencyEdge.analysis_id == analysis_id)
    )
    all_edges = edge_result.scalars().all()

    # Build adjacency maps
    dependents_map: dict[str, set[str]] = {}  # who imports this file
    dependencies_map: dict[str, set[str]] = {}  # what this file imports
    for edge in all_edges:
        dependents_map.setdefault(edge.target_path, set()).add(edge.source_path)
        dependencies_map.setdefault(edge.source_path, set()).add(edge.target_path)

    target = request.file_path
    direct_dependents = sorted(dependents_map.get(target, set()))
    direct_dependencies = sorted(dependencies_map.get(target, set()))

    # BFS to find transitive dependents (blast radius)
    visited: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque()
    for dep in dependents_map.get(target, set()):
        queue.append((dep, 1))

    while queue:
        node, dist = queue.popleft()
        if node in visited or dist > request.depth:
            continue
        visited[node] = dist
        for parent in dependents_map.get(node, set()):
            if parent not in visited and parent != target:
                queue.append((parent, dist + 1))

    # Compute per-file risk in blast radius
    blast_radius: list[ImpactedFile] = []
    for path, distance in sorted(visited.items(), key=lambda x: (x[1], x[0])):
        fan_in = len(dependents_map.get(path, set()))
        fan_out = len(dependencies_map.get(path, set()))
        risk = min(fan_in / 10, 1.0) * 0.4 + min(fan_out / 15, 1.0) * 0.3 + (1.0 / distance) * 0.3
        reasons = []
        if fan_in >= 5:
            reasons.append(f"heavily depended on ({fan_in} importers)")
        if fan_out >= 8:
            reasons.append(f"high coupling ({fan_out} deps)")
        if distance == 1:
            reasons.append("direct dependent")
        blast_radius.append(
            ImpactedFile(
                path=path,
                distance=distance,
                fan_in=fan_in,
                fan_out=fan_out,
                risk_score=round(risk, 3),
                reason="; ".join(reasons)
                if reasons
                else f"transitive dependent (depth {distance})",
            )
        )

    blast_radius.sort(key=lambda x: (-x.risk_score, x.distance))

    # Overall risk
    target_fan_in = len(dependents_map.get(target, set()))
    target_fan_out = len(dependencies_map.get(target, set()))
    overall_risk = (
        min(target_fan_in / 10, 1.0) * 0.5
        + min(len(visited) / 20, 1.0) * 0.3
        + min(target_fan_out / 15, 1.0) * 0.2
    )
    risk_level = (
        "low"
        if overall_risk < 0.3
        else "medium"
        if overall_risk < 0.5
        else "high"
        if overall_risk < 0.7
        else "critical"
    )

    # Suggested review: top-risk files in blast radius
    suggested_review = [f.path for f in blast_radius[:8] if f.risk_score > 0.3]
    # Suggested test areas: direct dependents + high-risk transitive
    suggested_test = (
        direct_dependents[:5]
        + [f.path for f in blast_radius if f.distance <= 2 and f.path not in direct_dependents][:5]
    )

    # Build subgraph for visualization
    impact_nodes: set[str] = {target}
    impact_edges: list[GraphEdge] = []
    for edge in all_edges:
        if (
            edge.source_path in visited
            or edge.target_path in visited
            or edge.source_path == target
            or edge.target_path == target
        ):
            if edge.source_path in visited or edge.source_path == target:
                if edge.target_path in visited or edge.target_path == target:
                    impact_nodes.add(edge.source_path)
                    impact_nodes.add(edge.target_path)
                    impact_edges.append(
                        GraphEdge(
                            source=edge.source_path,
                            target=edge.target_path,
                            type=edge.edge_type.value
                            if hasattr(edge.edge_type, "value")
                            else edge.edge_type,
                        )
                    )

    graph_nodes = [
        GraphNode(
            id=nid,
            label=nid.rsplit("/", 1)[-1] if "/" in nid else nid,
            type="target" if nid == target else "impacted",
            metadata={"distance": visited.get(nid, 0), "is_target": nid == target},
        )
        for nid in impact_nodes
    ]

    return ChangeImpactResponse(
        target_file=target,
        direct_dependents=direct_dependents,
        direct_dependencies=direct_dependencies,
        blast_radius=blast_radius,
        total_impacted=len(visited),
        risk_level=risk_level,
        risk_score=round(overall_risk, 3),
        suggested_review=suggested_review,
        suggested_test_areas=suggested_test,
        graph=GraphResponse(nodes=graph_nodes, edges=impact_edges),
    )


# ────────────────────────── Module Intelligence ──────────────────────────


class ModuleFile(BaseModel):
    path: str
    name: str
    fan_in: int = 0
    fan_out: int = 0
    risk_score: float = 0.0
    is_entry_point: bool = False
    symbol_count: int = 0


class ModuleDetail(BaseModel):
    name: str
    file_count: int
    total_lines: int = 0
    total_symbols: int = 0
    internal_edges: int
    external_edges: int
    cohesion: float
    risk_score: float = 0.0
    central_files: list[str] = []
    risky_files: list[str] = []
    entry_points: list[str] = []
    files: list[ModuleFile] = []
    related_modules: list[str] = []
    dependency_in: list[str] = []  # modules that depend on this one
    dependency_out: list[str] = []  # modules this one depends on


class ModuleListResponse(BaseModel):
    modules: list[ModuleDetail]
    total: int


@router.get("/{analysis_id}/modules", response_model=ModuleListResponse)
async def get_modules(
    analysis_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get rich module intelligence for the analyzed repository."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise_not_found("Analysis not found")

    # Load all edges
    edge_result = await db.execute(
        select(DependencyEdge).where(DependencyEdge.analysis_id == analysis_id)
    )
    all_edges = edge_result.scalars().all()

    # Load file info
    file_result = await db.execute(
        select(RepoFile).where(RepoFile.repository_id == analysis.repository_id)
    )
    all_files = file_result.scalars().all()
    file_map = {f.path: f for f in all_files}

    # Load symbol counts per file
    sym_result = await db.execute(
        select(Symbol.file_path, func.count(Symbol.id))
        .where(Symbol.analysis_id == analysis_id)
        .group_by(Symbol.file_path)
    )
    symbol_counts = dict(sym_result.all())

    # Build adjacency maps
    dependents_map: dict[str, set[str]] = {}
    dependencies_map: dict[str, set[str]] = {}
    for edge in all_edges:
        dependents_map.setdefault(edge.target_path, set()).add(edge.source_path)
        dependencies_map.setdefault(edge.source_path, set()).add(edge.target_path)

    # Group files by top-level directory (module)
    dir_groups: dict[str, list[str]] = {}
    for f in all_files:
        parts = f.path.split("/")
        module = parts[0] if len(parts) > 1 else "root"
        dir_groups.setdefault(module, []).append(f.path)

    modules: list[ModuleDetail] = []
    module_files_map: dict[str, set[str]] = {m: set(fs) for m, fs in dir_groups.items()}

    for module_name, file_paths in sorted(
        dir_groups.items(), key=lambda x: len(x[1]), reverse=True
    ):
        file_set = set(file_paths)

        internal_edges = 0
        external_edges = 0
        dep_in_modules: set[str] = set()
        dep_out_modules: set[str] = set()

        for fpath in file_paths:
            for _, target in (
                (e.source_path, e.target_path) for e in all_edges if e.source_path == fpath
            ):
                if target in file_set:
                    internal_edges += 1
                else:
                    external_edges += 1
                    # Find which module the target belongs to
                    for mn, mfs in module_files_map.items():
                        if target in mfs and mn != module_name:
                            dep_out_modules.add(mn)
                            break
            for source, _ in (
                (e.source_path, e.target_path) for e in all_edges if e.target_path == fpath
            ):
                if source not in file_set:
                    for mn, mfs in module_files_map.items():
                        if source in mfs and mn != module_name:
                            dep_in_modules.add(mn)
                            break

        cohesion = internal_edges / max(internal_edges + external_edges, 1)

        # Build file details
        mod_files: list[ModuleFile] = []
        total_lines = 0
        total_symbols = 0
        risky_files: list[str] = []

        for fpath in file_paths:
            fi = file_map.get(fpath)
            fan_in = len(dependents_map.get(fpath, set()))
            fan_out = len(dependencies_map.get(fpath, set()))
            risk = min(fan_in / 10, 1.0) * 0.4 + min(fan_out / 15, 1.0) * 0.3
            sc = symbol_counts.get(fpath, 0)
            total_symbols += sc
            if fi:
                total_lines += fi.line_count
            if risk > 0.4:
                risky_files.append(fpath)

            mod_files.append(
                ModuleFile(
                    path=fpath,
                    name=fpath.rsplit("/", 1)[-1] if "/" in fpath else fpath,
                    fan_in=fan_in,
                    fan_out=fan_out,
                    risk_score=round(risk, 3),
                    is_entry_point=fi.is_entry_point if fi else False,
                    symbol_count=sc,
                )
            )

        mod_files.sort(key=lambda x: -x.risk_score)

        # Central files: highest combined degree
        central = sorted(mod_files, key=lambda x: x.fan_in + x.fan_out, reverse=True)[:5]
        entry_pts = [f.path for f in mod_files if f.is_entry_point]

        # Module-level risk
        mod_risk = (
            min(external_edges / max(len(file_paths) * 3, 1), 1.0) * 0.4
            + (1 - cohesion) * 0.3
            + min(len(risky_files) / max(len(file_paths), 1), 1.0) * 0.3
        )

        modules.append(
            ModuleDetail(
                name=module_name,
                file_count=len(file_paths),
                total_lines=total_lines,
                total_symbols=total_symbols,
                internal_edges=internal_edges,
                external_edges=external_edges,
                cohesion=round(cohesion, 3),
                risk_score=round(mod_risk, 3),
                central_files=[f.path for f in central],
                risky_files=risky_files[:10],
                entry_points=entry_pts,
                files=mod_files,
                related_modules=sorted(dep_in_modules | dep_out_modules),
                dependency_in=sorted(dep_in_modules),
                dependency_out=sorted(dep_out_modules),
            )
        )

    modules.sort(key=lambda x: (-x.file_count,))

    return ModuleListResponse(modules=modules, total=len(modules))
