"""Repository Identity Engine.

Determines what kind of project a repository is, what problem it solves, and
who likely uses it — using evidence from routes, components, domain entities,
API paths, service names, README content, and business vocabulary.

Returns a ProjectIdentityResult with:
  - project_type (e.g. "SaaS Dashboard", "Admin Panel", "E-commerce")
  - domain / product purpose
  - likely users
  - confidence level + score
  - evidence bundle
  - supporting signals
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from app.analysis.evidence import (
    ConfidenceLevel,
    EvidenceItem,
    EvidenceType,
    compute_confidence,
    confidence_label,
)

# ─────────────────────────── Project type definitions ───────────────────────────


@dataclass
class ProjectTypeSignature:
    """Defines the signals that identify a particular project type."""

    project_type: str
    display_name: str
    description_template: str
    # Route/path keywords
    route_keywords: list[str] = field(default_factory=list)
    # Component/class name keywords
    component_keywords: list[str] = field(default_factory=list)
    # Service / domain entity keywords
    domain_keywords: list[str] = field(default_factory=list)
    # API path keywords
    api_keywords: list[str] = field(default_factory=list)
    # File/folder name keywords
    file_keywords: list[str] = field(default_factory=list)
    # README / docs keywords
    readme_keywords: list[str] = field(default_factory=list)
    # Base score weight (some types are more specific than others)
    specificity: float = 1.0


PROJECT_SIGNATURES: list[ProjectTypeSignature] = [
    ProjectTypeSignature(
        project_type="admin-panel",
        display_name="Admin Panel",
        description_template="An administrative dashboard for managing {entities}.",
        route_keywords=["admin", "management", "manage", "backoffice", "back-office"],
        component_keywords=[
            "AdminPanel",
            "AdminLayout",
            "AdminDashboard",
            "UserManagement",
            "RoleManager",
            "PermissionManager",
        ],
        domain_keywords=[
            "user",
            "role",
            "permission",
            "audit",
            "log",
            "ban",
            "approve",
            "reject",
            "moderate",
        ],
        api_keywords=["/admin", "/management", "/users/manage"],
        file_keywords=["admin", "management"],
        readme_keywords=["admin", "administration", "manage users", "back office"],
        specificity=1.5,
    ),
    ProjectTypeSignature(
        project_type="ecommerce",
        display_name="E-commerce Platform",
        description_template="An e-commerce platform for selling {entities}.",
        route_keywords=["products", "cart", "checkout", "orders", "shop", "store", "catalog"],
        component_keywords=[
            "ProductCard",
            "CartItem",
            "CheckoutForm",
            "OrderSummary",
            "ProductList",
            "ShoppingCart",
        ],
        domain_keywords=[
            "product",
            "order",
            "cart",
            "payment",
            "shipping",
            "inventory",
            "sku",
            "price",
            "discount",
            "coupon",
        ],
        api_keywords=["/products", "/orders", "/cart", "/checkout", "/payment"],
        file_keywords=["product", "cart", "checkout", "order"],
        readme_keywords=["e-commerce", "ecommerce", "shop", "store", "products", "orders"],
        specificity=1.5,
    ),
    ProjectTypeSignature(
        project_type="saas-dashboard",
        display_name="SaaS Dashboard",
        description_template="A SaaS analytics and management dashboard for {entities}.",
        route_keywords=[
            "dashboard",
            "analytics",
            "reports",
            "settings",
            "billing",
            "subscription",
            "workspace",
            "team",
        ],
        component_keywords=[
            "Dashboard",
            "Analytics",
            "MetricsCard",
            "UsageChart",
            "BillingPage",
            "SubscriptionCard",
        ],
        domain_keywords=[
            "subscription",
            "billing",
            "workspace",
            "team",
            "member",
            "plan",
            "usage",
            "metric",
            "analytics",
            "report",
        ],
        api_keywords=["/dashboard", "/analytics", "/billing", "/subscription", "/workspace"],
        file_keywords=["dashboard", "analytics", "billing", "subscription"],
        readme_keywords=["saas", "dashboard", "analytics", "subscription", "billing"],
        specificity=1.3,
    ),
    ProjectTypeSignature(
        project_type="marketing-site",
        display_name="Marketing Website",
        description_template="A marketing and landing page site for {entities}.",
        route_keywords=[
            "landing",
            "pricing",
            "features",
            "about",
            "contact",
            "blog",
            "testimonials",
        ],
        component_keywords=[
            "Hero",
            "Pricing",
            "Features",
            "Testimonial",
            "CTA",
            "LandingPage",
            "HeroSection",
            "PricingCard",
        ],
        domain_keywords=[
            "hero",
            "pricing",
            "feature",
            "testimonial",
            "call-to-action",
            "newsletter",
            "waitlist",
        ],
        api_keywords=["/contact", "/newsletter", "/waitlist"],
        file_keywords=["landing", "hero", "pricing"],
        readme_keywords=["marketing", "landing page", "website"],
        specificity=1.0,
    ),
    ProjectTypeSignature(
        project_type="api-service",
        display_name="API Service",
        description_template="A backend API service providing {entities}.",
        route_keywords=["api", "endpoint", "route", "controller", "handler"],
        component_keywords=[
            "Controller",
            "Handler",
            "Router",
            "Middleware",
            "Service",
            "Repository",
        ],
        domain_keywords=[
            "endpoint",
            "route",
            "handler",
            "middleware",
            "request",
            "response",
            "payload",
        ],
        api_keywords=["/api/", "/v1/", "/v2/"],
        file_keywords=["controller", "handler", "router", "middleware", "routes"],
        readme_keywords=["api", "rest api", "backend service", "microservice"],
        specificity=1.0,
    ),
    ProjectTypeSignature(
        project_type="cms",
        display_name="Content Management System",
        description_template="A content management system for managing {entities}.",
        route_keywords=["posts", "articles", "pages", "content", "media", "categories", "tags"],
        component_keywords=[
            "PostEditor",
            "ArticleList",
            "MediaLibrary",
            "ContentEditor",
            "PageBuilder",
        ],
        domain_keywords=[
            "post",
            "article",
            "content",
            "page",
            "media",
            "category",
            "tag",
            "slug",
            "publish",
            "draft",
        ],
        api_keywords=["/posts", "/articles", "/content", "/media"],
        file_keywords=["post", "article", "content", "media"],
        readme_keywords=["cms", "content management", "blog", "articles", "posts"],
        specificity=1.3,
    ),
    ProjectTypeSignature(
        project_type="analytics-tool",
        display_name="Analytics Tool",
        description_template="An analytics platform tracking {entities}.",
        route_keywords=["events", "metrics", "reports", "analytics", "tracking", "funnel"],
        component_keywords=[
            "EventTracker",
            "MetricsChart",
            "FunnelView",
            "ReportBuilder",
            "AnalyticsDashboard",
        ],
        domain_keywords=[
            "event",
            "metric",
            "report",
            "funnel",
            "conversion",
            "session",
            "pageview",
            "track",
        ],
        api_keywords=["/events", "/metrics", "/analytics", "/track"],
        file_keywords=["analytics", "metrics", "events", "tracking"],
        readme_keywords=["analytics", "tracking", "metrics", "events"],
        specificity=1.3,
    ),
    ProjectTypeSignature(
        project_type="auth-system",
        display_name="Authentication System",
        description_template="An authentication and identity management system.",
        route_keywords=[
            "login",
            "signup",
            "register",
            "auth",
            "oauth",
            "verify",
            "reset-password",
            "forgot-password",
        ],
        component_keywords=[
            "LoginForm",
            "SignupForm",
            "AuthGuard",
            "ProtectedRoute",
            "OAuthButton",
            "VerifyEmail",
        ],
        domain_keywords=[
            "token",
            "jwt",
            "session",
            "oauth",
            "permission",
            "role",
            "identity",
            "credential",
        ],
        api_keywords=["/auth", "/login", "/signup", "/oauth", "/token"],
        file_keywords=["auth", "login", "signup", "register", "oauth"],
        readme_keywords=["authentication", "auth", "oauth", "jwt", "identity"],
        specificity=1.2,
    ),
    ProjectTypeSignature(
        project_type="developer-tool",
        display_name="Developer Tool",
        description_template="A developer tool or CLI for {entities}.",
        route_keywords=[],
        component_keywords=["CLI", "Plugin", "Extension", "Builder", "Compiler", "Generator"],
        domain_keywords=[
            "cli",
            "plugin",
            "extension",
            "command",
            "compile",
            "build",
            "generate",
            "scaffold",
            "lint",
        ],
        api_keywords=[],
        file_keywords=["cli", "plugin", "bin", "commands"],
        readme_keywords=["cli", "developer tool", "plugin", "command line", "build tool"],
        specificity=1.2,
    ),
    ProjectTypeSignature(
        project_type="documentation-platform",
        display_name="Documentation Platform",
        description_template="A documentation or knowledge base platform.",
        route_keywords=["docs", "guide", "reference", "tutorial", "api-reference"],
        component_keywords=["DocPage", "ApiReference", "GuideLayout", "SearchDocs", "Sidebar"],
        domain_keywords=["documentation", "guide", "reference", "api-docs", "handbook"],
        api_keywords=["/docs", "/guide", "/reference"],
        file_keywords=["docs", "documentation", "guide"],
        readme_keywords=["documentation", "docs", "handbook", "guide", "reference"],
        specificity=1.1,
    ),
    ProjectTypeSignature(
        project_type="productivity-app",
        display_name="Productivity Application",
        description_template="A productivity app for managing {entities}.",
        route_keywords=["tasks", "todos", "projects", "notes", "calendar", "reminders"],
        component_keywords=[
            "TaskList",
            "TodoItem",
            "ProjectBoard",
            "NoteEditor",
            "CalendarView",
            "KanbanBoard",
        ],
        domain_keywords=[
            "task",
            "todo",
            "project",
            "note",
            "calendar",
            "reminder",
            "deadline",
            "priority",
        ],
        api_keywords=["/tasks", "/todos", "/projects", "/notes"],
        file_keywords=["task", "todo", "note", "project"],
        readme_keywords=["productivity", "task management", "todo", "project management", "notes"],
        specificity=1.2,
    ),
    ProjectTypeSignature(
        project_type="booking-system",
        display_name="Booking / Reservation System",
        description_template="A booking and reservation system for {entities}.",
        route_keywords=["booking", "reservations", "schedule", "appointments", "availability"],
        component_keywords=[
            "BookingForm",
            "ReservationCalendar",
            "AppointmentList",
            "AvailabilityPicker",
        ],
        domain_keywords=[
            "booking",
            "reservation",
            "appointment",
            "schedule",
            "availability",
            "slot",
            "booking_id",
        ],
        api_keywords=["/bookings", "/reservations", "/appointments", "/schedule"],
        file_keywords=["booking", "reservation", "appointment"],
        readme_keywords=["booking", "reservation", "appointment", "scheduling"],
        specificity=1.4,
    ),
    ProjectTypeSignature(
        project_type="social-platform",
        display_name="Social Platform",
        description_template="A social platform for {entities}.",
        route_keywords=["feed", "profile", "followers", "following", "messages", "notifications"],
        component_keywords=[
            "FeedItem",
            "UserProfile",
            "FollowButton",
            "MessageThread",
            "NotificationBell",
        ],
        domain_keywords=[
            "follow",
            "follower",
            "following",
            "feed",
            "like",
            "comment",
            "share",
            "mention",
            "notification",
        ],
        api_keywords=["/feed", "/follow", "/messages", "/notifications"],
        file_keywords=["feed", "social", "profile", "follow"],
        readme_keywords=["social", "community", "feed", "followers"],
        specificity=1.3,
    ),
    ProjectTypeSignature(
        project_type="internal-tool",
        display_name="Internal Tool",
        description_template="An internal tool for {entities}.",
        route_keywords=["internal", "ops", "admin", "tools", "support"],
        component_keywords=["InternalDashboard", "OpsView", "SupportPanel"],
        domain_keywords=["internal", "ops", "support", "backoffice", "tooling"],
        api_keywords=["/internal", "/ops", "/tools"],
        file_keywords=["internal", "ops", "tools"],
        readme_keywords=["internal tool", "ops", "operational"],
        specificity=0.8,
    ),
]


# ─────────────────────────── Result model ───────────────────────────


@dataclass
class ProjectIdentityResult:
    project_type: str
    display_name: str
    description: str
    confidence_level: ConfidenceLevel
    confidence_score: float
    evidence_items: list[EvidenceItem] = field(default_factory=list)
    domain_entities: list[str] = field(default_factory=list)
    likely_users: list[str] = field(default_factory=list)
    key_signals: list[str] = field(default_factory=list)
    alternative_types: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "project_type": self.project_type,
            "display_name": self.display_name,
            "description": self.description,
            "confidence_level": self.confidence_level.value,
            "confidence_score": round(self.confidence_score, 3),
            "confidence_label": confidence_label(self.confidence_level),
            "evidence_items": [e.to_dict() for e in self.evidence_items],
            "domain_entities": self.domain_entities,
            "likely_users": self.likely_users,
            "key_signals": self.key_signals,
            "alternative_types": self.alternative_types,
        }


# ─────────────────────────── Engine ───────────────────────────


class IdentityEngine:
    """Determine what kind of project this repository is, using evidence.

    Usage:
        engine = IdentityEngine(file_infos, file_contents, symbol_names)
        result = engine.detect()
    """

    def __init__(
        self,
        file_infos: list[dict],
        file_contents: dict[str, str],
        symbol_names: list[str] | None = None,
    ):
        self.file_infos = file_infos
        self.file_contents = file_contents
        self.symbol_names = symbol_names or []
        self._all_paths = [f["path"] for f in file_infos]
        self._all_path_lower = " ".join(p.lower() for p in self._all_paths)
        self._readme_content = self._get_readme()
        self._symbol_lower = " ".join(n.lower() for n in self.symbol_names)

    def detect(self) -> ProjectIdentityResult:
        scores: list[tuple[ProjectTypeSignature, float, list[EvidenceItem]]] = []

        for sig in PROJECT_SIGNATURES:
            score, evidence_items = self._score_signature(sig)
            if score > 0:
                scores.append((sig, score, evidence_items))

        if not scores:
            return ProjectIdentityResult(
                project_type="unknown",
                display_name="Unknown",
                description="Insufficient evidence to determine project type.",
                confidence_level=ConfidenceLevel.UNKNOWN,
                confidence_score=0.0,
                domain_entities=self._extract_domain_entities(),
            )

        scores.sort(key=lambda x: x[1], reverse=True)
        best_sig, best_score, best_evidence = scores[0]

        # Compute confidence from evidence
        confidence_level, confidence_score = compute_confidence(best_evidence)

        # If score is very high, upgrade to HIGH
        if best_score >= 8.0:
            confidence_level = ConfidenceLevel.HIGH
            confidence_score = min(confidence_score + 0.1, 1.0)
        elif best_score < 2.0:
            confidence_level = ConfidenceLevel.LOW

        domain_entities = self._extract_domain_entities()
        description = best_sig.description_template.format(
            entities=", ".join(domain_entities[:3]) if domain_entities else "various resources"
        )

        alternatives = [
            {
                "project_type": sig.project_type,
                "display_name": sig.display_name,
                "score": round(score, 2),
            }
            for sig, score, _ in scores[1:4]
        ]

        key_signals = self._extract_key_signals(best_sig, best_evidence)

        return ProjectIdentityResult(
            project_type=best_sig.project_type,
            display_name=best_sig.display_name,
            description=description,
            confidence_level=confidence_level,
            confidence_score=confidence_score,
            evidence_items=best_evidence,
            domain_entities=domain_entities,
            likely_users=self._infer_users(best_sig.project_type),
            key_signals=key_signals,
            alternative_types=alternatives,
        )

    def _score_signature(self, sig: ProjectTypeSignature) -> tuple[float, list[EvidenceItem]]:
        evidence_items: list[EvidenceItem] = []
        total_score = 0.0

        # 1. Route/path keywords in file paths
        route_hits = [kw for kw in sig.route_keywords if kw in self._all_path_lower]
        if route_hits:
            hit_files = [p for p in self._all_paths if any(kw in p.lower() for kw in route_hits)]
            score = len(route_hits) * 1.5 * sig.specificity
            total_score += score
            evidence_items.append(
                EvidenceItem(
                    evidence_type=EvidenceType.ROUTE_PATTERN,
                    description=f"Route keywords found: {', '.join(route_hits[:5])}",
                    file_paths=hit_files[:8],
                    weight=min(score / 3.0, 2.0),
                )
            )

        # 2. Component/symbol name keywords
        component_hits = [
            kw
            for kw in sig.component_keywords
            if kw.lower() in self._symbol_lower or kw.lower() in self._all_path_lower
        ]
        if component_hits:
            score = len(component_hits) * 1.0 * sig.specificity
            total_score += score
            evidence_items.append(
                EvidenceItem(
                    evidence_type=EvidenceType.SYMBOL_PATTERN,
                    description=f"Component/symbol patterns found: {', '.join(component_hits[:5])}",
                    symbols=component_hits[:8],
                    weight=min(score / 3.0, 2.0),
                )
            )

        # 3. Domain vocabulary in symbol names and content
        all_identifiers = (self._symbol_lower + " " + self._all_path_lower).lower()
        domain_hits = [kw for kw in sig.domain_keywords if kw.lower() in all_identifiers]
        if domain_hits:
            score = len(domain_hits) * 0.8 * sig.specificity
            total_score += score
            evidence_items.append(
                EvidenceItem(
                    evidence_type=EvidenceType.CONTENT_MATCH,
                    description=f"Domain vocabulary found: {', '.join(domain_hits[:8])}",
                    weight=min(score / 4.0, 1.5),
                )
            )

        # 4. File name keywords
        file_hits = [kw for kw in sig.file_keywords if kw in self._all_path_lower]
        if file_hits:
            hit_files = [p for p in self._all_paths if any(kw in p.lower() for kw in file_hits)]
            score = len(file_hits) * 1.2 * sig.specificity
            total_score += score
            evidence_items.append(
                EvidenceItem(
                    evidence_type=EvidenceType.FILE_PATTERN,
                    description=f"File name patterns: {', '.join(file_hits[:5])}",
                    file_paths=hit_files[:5],
                    weight=min(score / 3.0, 1.5),
                )
            )

        # 5. README keywords (strong signal)
        if self._readme_content:
            readme_lower = self._readme_content.lower()
            readme_hits = [kw for kw in sig.readme_keywords if kw.lower() in readme_lower]
            if readme_hits:
                score = len(readme_hits) * 2.0 * sig.specificity
                total_score += score
                snippet = self._readme_snippet(readme_hits[0])
                evidence_items.append(
                    EvidenceItem(
                        evidence_type=EvidenceType.README_MENTION,
                        description=f"README mentions: {', '.join(readme_hits[:5])}",
                        file_paths=["README.md"],
                        content_snippet=snippet,
                        weight=min(score / 3.0, 2.0),
                    )
                )

        return total_score, evidence_items

    def _extract_domain_entities(self) -> list[str]:
        """Extract likely domain entity names from symbols and file paths."""
        # Common entity-like words (camelCase or PascalCase)
        entity_pattern = re.compile(r"\b([A-Z][a-z]{2,}(?:[A-Z][a-z]+)*)\b")
        all_text = " ".join(self._all_paths) + " " + " ".join(self.symbol_names)
        candidates = entity_pattern.findall(all_text)

        # Filter out framework/generic words
        skip = {
            "React",
            "Next",
            "Vue",
            "Angular",
            "Node",
            "Express",
            "FastAPI",
            "Router",
            "Route",
            "Layout",
            "Page",
            "View",
            "Component",
            "Service",
            "Controller",
            "Config",
            "Props",
            "State",
            "Hook",
            "Index",
            "Main",
            "App",
            "Test",
            "Type",
            "Interface",
            "Utils",
            "Helper",
            "Context",
            "Provider",
            "Store",
            "Reducer",
            "Action",
        }
        counts = Counter(c for c in candidates if c not in skip and len(c) >= 4)
        return [entity for entity, _ in counts.most_common(10)]

    @staticmethod
    def _infer_users(project_type: str) -> list[str]:
        user_map: dict[str, list[str]] = {
            "admin-panel": ["system administrators", "internal staff", "support teams"],
            "ecommerce": ["shoppers", "customers", "store managers"],
            "saas-dashboard": ["business users", "team members", "account administrators"],
            "marketing-site": ["visitors", "prospects", "marketing teams"],
            "api-service": ["developers", "client applications", "internal services"],
            "cms": ["content editors", "marketing teams", "administrators"],
            "analytics-tool": ["data analysts", "product managers", "business stakeholders"],
            "auth-system": ["end users", "developers integrating auth", "security administrators"],
            "developer-tool": ["developers", "engineers", "DevOps teams"],
            "documentation-platform": ["developers", "end users", "technical writers"],
            "productivity-app": ["individuals", "teams", "knowledge workers"],
            "booking-system": ["customers", "service providers", "administrators"],
            "social-platform": ["members", "content creators", "community managers"],
            "internal-tool": ["employees", "operations teams", "internal stakeholders"],
        }
        return user_map.get(project_type, ["end users", "developers"])

    def _get_readme(self) -> str:
        for key in ("README.md", "readme.md", "README.txt", "README"):
            content = self.file_contents.get(key, "")
            if content:
                return content
        return ""

    def _readme_snippet(self, keyword: str) -> str:
        """Return the sentence containing keyword from README."""
        for line in self._readme_content.splitlines():
            if keyword.lower() in line.lower():
                return line.strip()[:200]
        return ""

    @staticmethod
    def _extract_key_signals(sig: ProjectTypeSignature, evidence: list[EvidenceItem]) -> list[str]:
        signals: list[str] = []
        for item in evidence:
            signals.append(item.description)
        return signals[:5]
