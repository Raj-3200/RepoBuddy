"""Unit tests for the evidence-based change impact analyzer."""

from app.analysis.impact_analyzer import ImpactAnalyzer


def _fi(path: str, is_entry: bool = False, module: str | None = None) -> dict:
    return {
        "path": path,
        "module": module if module is not None else path.rsplit("/", 1)[0] if "/" in path else "",
        "is_entry_point": is_entry,
        "line_count": 50,
    }


def test_no_dependents_is_safe_to_change():
    files = [_fi("src/utils/orphan.ts"), _fi("src/main.ts", is_entry=True)]
    edges: list[dict] = []
    result = ImpactAnalyzer(edges, files).analyze("src/utils/orphan.ts")

    assert result.blast_radius == 0
    assert result.safe_to_change is True
    assert result.change_risk_label == "low"
    assert result.direct_dependents == []


def test_direct_dependents_are_discovered():
    files = [
        _fi("src/auth/login.ts"),
        _fi("src/api/handlers.ts"),
        _fi("src/pages/index.ts", is_entry=True),
    ]
    edges = [
        {"source_path": "src/api/handlers.ts", "target_path": "src/auth/login.ts"},
        {"source_path": "src/pages/index.ts", "target_path": "src/api/handlers.ts"},
    ]
    result = ImpactAnalyzer(edges, files).analyze("src/auth/login.ts")

    direct_paths = [f.path for f in result.direct_dependents]
    second_paths = [f.path for f in result.second_order_dependents]

    assert "src/api/handlers.ts" in direct_paths
    assert "src/pages/index.ts" in second_paths
    assert result.blast_radius == 2


def test_entry_point_impact_bumps_risk():
    files = [
        _fi("src/config.ts"),
        _fi("src/main.ts", is_entry=True),
    ]
    edges = [
        {"source_path": "src/main.ts", "target_path": "src/config.ts"},
    ]
    result = ImpactAnalyzer(edges, files).analyze("src/config.ts")

    assert "src/main.ts" in result.affected_entry_points
    # Reasoning must flag the entry point hit, even if blast radius is small
    assert any("entry point" in r.lower() for r in result.reasoning)


def test_review_path_is_nonempty_when_dependents_exist():
    files = [
        _fi("src/core/db.ts"),
        _fi("src/api/users.ts"),
        _fi("src/api/posts.ts"),
    ]
    edges = [
        {"source_path": "src/api/users.ts", "target_path": "src/core/db.ts"},
        {"source_path": "src/api/posts.ts", "target_path": "src/core/db.ts"},
    ]
    result = ImpactAnalyzer(edges, files).analyze("src/core/db.ts")

    assert len(result.review_path) > 0
    assert result.blast_radius == 2


def test_unknown_target_returns_empty_not_error():
    """Analyzer must never crash on unknown paths — the API layer handles 404."""
    result = ImpactAnalyzer([], []).analyze("does/not/exist.ts")
    assert result.blast_radius == 0
    assert result.safe_to_change is True


def test_runtime_entry_points_are_detected():
    """Changes that ripple into a Celery task or HTTP route must be flagged —
    these are the signals reviewers repeatedly miss."""
    files = [
        _fi("backend/app/services/email.py"),
        _fi("backend/app/workers/send_emails.py"),       # background worker
        _fi("backend/app/api/notifications.py"),          # HTTP route
        _fi("backend/app/utils/helpers.py"),              # plain util
    ]
    edges = [
        {"source_path": "backend/app/workers/send_emails.py", "target_path": "backend/app/services/email.py"},
        {"source_path": "backend/app/api/notifications.py", "target_path": "backend/app/services/email.py"},
        {"source_path": "backend/app/utils/helpers.py", "target_path": "backend/app/services/email.py"},
    ]
    result = ImpactAnalyzer(edges, files).analyze("backend/app/services/email.py")

    paths = {r["path"] for r in result.affected_runtime_entry_points}
    kinds = {r["kind"] for r in result.affected_runtime_entry_points}
    assert "backend/app/workers/send_emails.py" in paths
    assert "backend/app/api/notifications.py" in paths
    assert "backend/app/utils/helpers.py" not in paths
    assert "background worker" in kinds
    assert "HTTP route" in kinds
    # Reasoning must call it out explicitly
    assert any("runtime entry point" in r.lower() for r in result.reasoning)


def test_suggested_tests_prefers_direct_coverage():
    files = [
        _fi("src/auth.ts"),
        _fi("src/auth.test.ts"),                    # directly imports auth
        _fi("src/consumer.ts"),
        _fi("src/consumer.test.ts"),                # imports consumer (distance 2)
    ]
    edges = [
        {"source_path": "src/auth.test.ts", "target_path": "src/auth.ts"},
        {"source_path": "src/consumer.ts", "target_path": "src/auth.ts"},
        {"source_path": "src/consumer.test.ts", "target_path": "src/consumer.ts"},
    ]
    result = ImpactAnalyzer(edges, files).analyze("src/auth.ts")

    # Direct test must appear first
    assert result.suggested_tests[0]["path"] == "src/auth.test.ts"
    assert "directly" in result.suggested_tests[0]["reason"].lower()
    # Indirect test also suggested
    paths = [s["path"] for s in result.suggested_tests]
    assert "src/consumer.test.ts" in paths


def test_suggested_tests_falls_back_to_proximity():
    """When no test imports the target, suggest tests in the same folder."""
    files = [
        _fi("src/core/widget.ts"),
        _fi("src/core/widget_helpers.ts"),
        _fi("src/core/core.test.ts"),   # same folder — proximity signal
        _fi("src/unrelated/other.test.ts"),
    ]
    edges: list[dict] = []  # nobody imports widget.ts yet
    result = ImpactAnalyzer(edges, files).analyze("src/core/widget.ts")

    paths = [s["path"] for s in result.suggested_tests]
    assert "src/core/core.test.ts" in paths
    # Should NOT suggest a test from a completely unrelated folder before proximity
    assert paths.index("src/core/core.test.ts") <= paths.index("src/unrelated/other.test.ts") \
        if "src/unrelated/other.test.ts" in paths else True
