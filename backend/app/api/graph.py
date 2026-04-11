"""Graph exploration routes."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.repository import Analysis, DependencyEdge, RepoFile
from app.schemas.repository import (
    GraphResponse,
    GraphNode,
    GraphEdge,
    GraphNeighborhoodRequest,
)
from app.core.exceptions import raise_not_found

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

    # Build nodes
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
