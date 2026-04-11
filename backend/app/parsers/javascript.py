"""JavaScript / TypeScript parser using tree-sitter."""

from __future__ import annotations

from pathlib import Path

from app.core.logging import get_logger
from app.parsers.base import (
    BaseParser,
    ParseResult,
    ParsedSymbol,
    ParsedImport,
    ParsedExport,
    SymbolKind,
)

logger = get_logger(__name__)

# tree-sitter language setup
_js_language = None
_ts_language = None


def _get_js_language():
    global _js_language
    if _js_language is None:
        try:
            import tree_sitter_javascript as tsjs
            from tree_sitter import Language

            _js_language = Language(tsjs.language())
        except Exception as e:
            logger.warning("tree_sitter_js_init_failed", error=str(e))
    return _js_language


def _get_ts_language():
    global _ts_language
    if _ts_language is None:
        try:
            import tree_sitter_typescript as tsts
            from tree_sitter import Language

            _ts_language = Language(tsts.language_typescript())
        except Exception as e:
            logger.warning("tree_sitter_ts_init_failed", error=str(e))
    return _ts_language


class JavaScriptParser(BaseParser):
    supported_extensions = {".js", ".jsx", ".mjs", ".cjs"}

    def parse(self, file_path: str, content: str) -> ParseResult:
        return _parse_js_ts(file_path, content, "JavaScript", _get_js_language())


class TypeScriptParser(BaseParser):
    supported_extensions = {".ts", ".tsx"}

    def parse(self, file_path: str, content: str) -> ParseResult:
        lang = _get_ts_language()
        return _parse_js_ts(file_path, content, "TypeScript", lang)


def _parse_js_ts(
    file_path: str, content: str, language: str, ts_language
) -> ParseResult:
    """Parse JS/TS file using tree-sitter for robust AST extraction."""
    result = ParseResult(
        file_path=file_path,
        language=language,
        line_count=content.count("\n") + 1,
    )

    if ts_language is None:
        # Fallback to regex-based parsing
        return _parse_js_ts_regex(file_path, content, language)

    try:
        from tree_sitter import Parser

        parser = Parser(ts_language)
        tree = parser.parse(content.encode("utf-8"))
        root = tree.root_node

        _extract_from_node(root, content, result)
    except Exception as e:
        logger.warning("tree_sitter_parse_error", file=file_path, error=str(e))
        result.errors.append(str(e))
        # Fallback to regex
        return _parse_js_ts_regex(file_path, content, language)

    return result


def _extract_from_node(node, content: str, result: ParseResult) -> None:
    """Recursively extract symbols and imports from AST nodes."""
    for child in node.children:
        node_type = child.type

        # ── Imports ──
        if node_type == "import_statement":
            _extract_import(child, content, result)

        # ── Function declarations ──
        elif node_type in ("function_declaration", "generator_function_declaration"):
            name = _get_child_text(child, "identifier", content)
            if name:
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.FUNCTION,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        signature=_get_line(content, child.start_point[0]),
                        is_exported=_is_exported_node(child),
                    )
                )

        # ── Class declarations ──
        elif node_type == "class_declaration":
            name = _get_child_text(child, "identifier", content)
            if name:
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.CLASS,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        signature=_get_line(content, child.start_point[0]),
                        is_exported=_is_exported_node(child),
                    )
                )
                # Extract methods
                _extract_class_methods(child, content, result)

        # ── Variable declarations (arrow functions, constants) ──
        elif node_type in ("lexical_declaration", "variable_declaration"):
            _extract_variable_decl(child, content, result)

        # ── Export statements ──
        elif node_type in ("export_statement",):
            _extract_export(child, content, result)

        # ── Interface / Type alias (TypeScript) ──
        elif node_type == "interface_declaration":
            name = _get_child_text(child, "identifier", content)
            if name:
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.INTERFACE,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        is_exported=_is_exported_node(child),
                    )
                )

        elif node_type == "type_alias_declaration":
            name = _get_child_text(child, "identifier", content)
            if name:
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.TYPE_ALIAS,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        is_exported=_is_exported_node(child),
                    )
                )

        elif node_type == "enum_declaration":
            name = _get_child_text(child, "identifier", content)
            if name:
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.ENUM,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        is_exported=_is_exported_node(child),
                    )
                )

        # Recurse into export_statement to find inner declarations
        elif node_type == "export_statement":
            _extract_from_node(child, content, result)
        else:
            _extract_from_node(child, content, result)


def _extract_import(node, content: str, result: ParseResult) -> None:
    """Extract import information from an import statement node."""
    source = None
    specifiers: list[str] = []
    is_default = False

    for child in node.children:
        if child.type == "string":
            source = _node_text(child, content).strip("'\"")
        elif child.type == "identifier":
            specifiers.append(_node_text(child, content))
            is_default = True
        elif child.type == "import_clause":
            for sub in child.children:
                if sub.type == "identifier":
                    specifiers.append(_node_text(sub, content))
                    is_default = True
                elif sub.type == "named_imports":
                    for spec in sub.children:
                        if spec.type == "import_specifier":
                            name = _get_child_text(spec, "identifier", content)
                            if name:
                                specifiers.append(name)

    if source:
        result.imports.append(
            ParsedImport(
                source=source,
                specifiers=specifiers,
                is_default=is_default,
                is_side_effect=len(specifiers) == 0,
                line=node.start_point[0] + 1,
            )
        )


def _extract_export(node, content: str, result: ParseResult) -> None:
    """Extract export information."""
    for child in node.children:
        if child.type in (
            "function_declaration",
            "class_declaration",
            "lexical_declaration",
            "variable_declaration",
        ):
            # These will be picked up as symbols with is_exported=True
            _extract_from_node(node, content, result)
            return

    # Re-export: export { x } from './y'
    source = None
    names: list[str] = []
    for child in node.children:
        if child.type == "string":
            source = _node_text(child, content).strip("'\"")
        elif child.type == "export_clause":
            for spec in child.children:
                if spec.type == "export_specifier":
                    name = _get_child_text(spec, "identifier", content)
                    if name:
                        names.append(name)

    for name in names:
        result.exports.append(
            ParsedExport(name=name, source=source, line=node.start_point[0] + 1)
        )


def _extract_variable_decl(node, content: str, result: ParseResult) -> None:
    """Extract variable declarations (especially arrow functions and constants)."""
    for child in node.children:
        if child.type == "variable_declarator":
            name_node = None
            value_node = None
            for sub in child.children:
                if sub.type in ("identifier", "array_pattern", "object_pattern"):
                    name_node = sub
                elif sub.type in (
                    "arrow_function",
                    "function_expression",
                    "function",
                ):
                    value_node = sub

            if name_node and value_node:
                name = _node_text(name_node, content)
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.FUNCTION,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        signature=_get_line(content, child.start_point[0]),
                        is_exported=_is_exported_node(node),
                    )
                )
            elif name_node:
                name = _node_text(name_node, content)
                kind = SymbolKind.CONSTANT if _is_const(node) else SymbolKind.VARIABLE
                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=kind,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        is_exported=_is_exported_node(node),
                    )
                )


def _extract_class_methods(class_node, content: str, result: ParseResult) -> None:
    """Extract methods from a class body."""
    for child in class_node.children:
        if child.type == "class_body":
            for member in child.children:
                if member.type in ("method_definition", "public_field_definition"):
                    name = _get_child_text(member, "property_identifier", content)
                    if not name:
                        name = _get_child_text(member, "identifier", content)
                    if name:
                        result.symbols.append(
                            ParsedSymbol(
                                name=name,
                                kind=SymbolKind.METHOD,
                                line_start=member.start_point[0] + 1,
                                line_end=member.end_point[0] + 1,
                                signature=_get_line(content, member.start_point[0]),
                            )
                        )


# ── Helpers ──


def _node_text(node, content: str) -> str:
    return content[node.start_byte : node.end_byte]


def _get_child_text(node, child_type: str, content: str) -> str | None:
    for child in node.children:
        if child.type == child_type:
            return _node_text(child, content)
    return None


def _get_line(content: str, line_idx: int) -> str:
    lines = content.split("\n")
    if 0 <= line_idx < len(lines):
        return lines[line_idx].strip()
    return ""


def _is_exported_node(node) -> bool:
    if node.parent and node.parent.type == "export_statement":
        return True
    return False


def _is_const(node) -> bool:
    for child in node.children:
        if child.type == "const":
            return True
    return False


# ────────────────────────── Regex fallback ──────────────────────────

import re


def _parse_js_ts_regex(file_path: str, content: str, language: str) -> ParseResult:
    """Fallback regex-based parser when tree-sitter is unavailable."""
    result = ParseResult(
        file_path=file_path,
        language=language,
        line_count=content.count("\n") + 1,
    )

    lines = content.split("\n")

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Imports
        import_match = re.match(
            r"""(?:import\s+(?:(?:(?:[\w*\s{},]*)\s+from\s+)?['"](.+?)['"]|['"](.+?)['"]))\s*;?""",
            stripped,
        )
        if import_match:
            source = import_match.group(1) or import_match.group(2)
            if source:
                result.imports.append(ParsedImport(source=source, line=i + 1))

        # require() calls
        require_match = re.match(r"""(?:const|let|var)\s+\w+\s*=\s*require\(['"](.+?)['"]\)""", stripped)
        if require_match:
            result.imports.append(ParsedImport(source=require_match.group(1), line=i + 1))

        # Function declarations
        func_match = re.match(
            r"(?:export\s+)?(?:async\s+)?function\s+(\w+)", stripped
        )
        if func_match:
            result.symbols.append(
                ParsedSymbol(
                    name=func_match.group(1),
                    kind=SymbolKind.FUNCTION,
                    line_start=i + 1,
                    signature=stripped,
                    is_exported=stripped.startswith("export"),
                )
            )

        # Arrow functions assigned to const/let
        arrow_match = re.match(
            r"(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>",
            stripped,
        )
        if arrow_match:
            result.symbols.append(
                ParsedSymbol(
                    name=arrow_match.group(1),
                    kind=SymbolKind.FUNCTION,
                    line_start=i + 1,
                    signature=stripped,
                    is_exported=stripped.startswith("export"),
                )
            )

        # Class declarations
        class_match = re.match(
            r"(?:export\s+)?(?:abstract\s+)?class\s+(\w+)", stripped
        )
        if class_match:
            result.symbols.append(
                ParsedSymbol(
                    name=class_match.group(1),
                    kind=SymbolKind.CLASS,
                    line_start=i + 1,
                    signature=stripped,
                    is_exported=stripped.startswith("export"),
                )
            )

        # Interface declarations
        iface_match = re.match(r"(?:export\s+)?interface\s+(\w+)", stripped)
        if iface_match:
            result.symbols.append(
                ParsedSymbol(
                    name=iface_match.group(1),
                    kind=SymbolKind.INTERFACE,
                    line_start=i + 1,
                    is_exported=stripped.startswith("export"),
                )
            )

        # Type alias
        type_match = re.match(r"(?:export\s+)?type\s+(\w+)\s*=", stripped)
        if type_match:
            result.symbols.append(
                ParsedSymbol(
                    name=type_match.group(1),
                    kind=SymbolKind.TYPE_ALIAS,
                    line_start=i + 1,
                    is_exported=stripped.startswith("export"),
                )
            )

    return result
