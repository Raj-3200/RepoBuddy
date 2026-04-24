"""Python parser using tree-sitter-python with regex fallback."""

from __future__ import annotations

import re
from typing import ClassVar

from app.core.logging import get_logger
from app.parsers.base import (
    BaseParser,
    ParsedExport,
    ParsedImport,
    ParsedSymbol,
    ParseResult,
    SymbolKind,
)

logger = get_logger(__name__)

_py_language = None


def _get_py_language():
    global _py_language
    if _py_language is None:
        try:
            import tree_sitter_python as tspy
            from tree_sitter import Language

            _py_language = Language(tspy.language())
        except Exception as e:
            logger.warning("tree_sitter_python_init_failed", error=str(e))
    return _py_language


class PythonParser(BaseParser):
    supported_extensions: ClassVar[set[str]] = {".py"}

    def parse(self, file_path: str, content: str) -> ParseResult:
        lang = _get_py_language()
        if lang is None:
            return _parse_python_regex(file_path, content)
        return _parse_python_tree_sitter(file_path, content, lang)


def _parse_python_tree_sitter(file_path: str, content: str, ts_language) -> ParseResult:
    """Parse Python using tree-sitter AST."""
    result = ParseResult(
        file_path=file_path,
        language="Python",
        line_count=content.count("\n") + 1,
    )

    try:
        from tree_sitter import Parser

        parser = Parser(ts_language)
        tree = parser.parse(content.encode("utf-8"))
        root = tree.root_node

        _extract_symbols(root, result, content)
        _extract_imports(root, result, content)
        _extract_exports(result, file_path)

    except Exception as e:
        logger.warning("python_tree_sitter_parse_error", file=file_path, error=str(e))
        return _parse_python_regex(file_path, content)

    return result


def _extract_symbols(node, result: ParseResult, content: str) -> None:
    """Recursively extract symbols from the AST."""
    for child in node.children:
        if child.type == "function_definition":
            name_node = child.child_by_field_name("name")
            params_node = child.child_by_field_name("parameters")
            return_node = child.child_by_field_name("return_type")

            if name_node:
                name = name_node.text.decode("utf-8")
                sig = f"def {name}"
                if params_node:
                    sig += params_node.text.decode("utf-8")
                if return_node:
                    sig += f" -> {return_node.text.decode('utf-8')}"

                docstring = _extract_docstring(child, content)

                result.symbols.append(
                    ParsedSymbol(
                        name=name,
                        kind=SymbolKind.FUNCTION,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        signature=sig,
                        docstring=docstring,
                        is_exported=not name.startswith("_"),
                    )
                )

        elif child.type == "class_definition":
            name_node = child.child_by_field_name("name")
            if name_node:
                class_name = name_node.text.decode("utf-8")

                # Get base classes
                bases = []
                superclasses = child.child_by_field_name("superclasses")
                if superclasses:
                    bases_text = superclasses.text.decode("utf-8")
                    sig = f"class {class_name}{bases_text}"
                else:
                    sig = f"class {class_name}"

                docstring = _extract_docstring(child, content)

                result.symbols.append(
                    ParsedSymbol(
                        name=class_name,
                        kind=SymbolKind.CLASS,
                        line_start=child.start_point[0] + 1,
                        line_end=child.end_point[0] + 1,
                        signature=sig,
                        docstring=docstring,
                        is_exported=not class_name.startswith("_"),
                        metadata={"bases": bases},
                    )
                )

                # Extract methods
                body = child.child_by_field_name("body")
                if body:
                    for item in body.children:
                        if item.type == "function_definition":
                            method_name_node = item.child_by_field_name("name")
                            if method_name_node:
                                method_name = method_name_node.text.decode("utf-8")
                                method_params = item.child_by_field_name("parameters")
                                method_sig = f"{class_name}.{method_name}"
                                if method_params:
                                    method_sig += method_params.text.decode("utf-8")

                                result.symbols.append(
                                    ParsedSymbol(
                                        name=f"{class_name}.{method_name}",
                                        kind=SymbolKind.METHOD,
                                        line_start=item.start_point[0] + 1,
                                        line_end=item.end_point[0] + 1,
                                        signature=method_sig,
                                        docstring=_extract_docstring(item, content),
                                        is_exported=not method_name.startswith("_"),
                                    )
                                )

        elif child.type == "decorated_definition":
            # Recurse into decorated definitions (e.g., @staticmethod, @dataclass)
            _extract_symbols(child, result, content)

        elif child.type == "expression_statement":
            # Top-level assignments (constants)
            expr = child.children[0] if child.children else None
            if expr and expr.type == "assignment":
                targets = expr.child_by_field_name("left")
                if targets and targets.type == "identifier":
                    name = targets.text.decode("utf-8")
                    if name.isupper():
                        result.symbols.append(
                            ParsedSymbol(
                                name=name,
                                kind=SymbolKind.CONSTANT,
                                line_start=child.start_point[0] + 1,
                                line_end=child.end_point[0] + 1,
                                is_exported=not name.startswith("_"),
                            )
                        )


def _extract_docstring(node, content: str) -> str | None:
    """Extract docstring from the first expression statement in a body."""
    body = node.child_by_field_name("body")
    if not body or not body.children:
        return None

    first = body.children[0]
    if first.type == "expression_statement" and first.children:
        expr = first.children[0]
        if expr.type == "string":
            text = expr.text.decode("utf-8")
            # Strip triple quotes
            if text.startswith('"""') or text.startswith("'''"):
                return text[3:-3].strip()
            elif text.startswith('"') or text.startswith("'"):
                return text[1:-1].strip()
    return None


def _extract_imports(node, result: ParseResult, content: str) -> None:
    """Extract import statements."""
    for child in node.children:
        if child.type == "import_statement":
            # import foo, import foo.bar
            text = child.text.decode("utf-8")
            match = re.match(r"import\s+([\w.]+)", text)
            if match:
                result.imports.append(
                    ParsedImport(
                        source=match.group(1),
                        line=child.start_point[0] + 1,
                    )
                )

        elif child.type == "import_from_statement":
            # from foo import bar, baz
            module_node = child.child_by_field_name("module_name")
            source = module_node.text.decode("utf-8") if module_node else ""

            specifiers = []
            for c in child.children:
                if c.type == "dotted_name" and c != module_node:
                    specifiers.append(c.text.decode("utf-8"))
                elif c.type == "aliased_import":
                    name_node = c.child_by_field_name("name")
                    if name_node:
                        specifiers.append(name_node.text.decode("utf-8"))
                elif c.type == "wildcard_import":
                    specifiers.append("*")

            result.imports.append(
                ParsedImport(
                    source=source,
                    specifiers=specifiers,
                    line=child.start_point[0] + 1,
                )
            )


def _extract_exports(result: ParseResult, file_path: str) -> None:
    """In Python, exported symbols = public symbols (no leading _)."""
    for sym in result.symbols:
        base_name = sym.name.split(".")[-1]
        if not base_name.startswith("_"):
            result.exports.append(
                ParsedExport(
                    name=sym.name,
                    kind="named",
                    line=sym.line_start,
                )
            )


# ── Regex fallback ──


def _parse_python_regex(file_path: str, content: str) -> ParseResult:
    """Fallback regex-based Python parsing."""
    result = ParseResult(
        file_path=file_path,
        language="Python",
        line_count=content.count("\n") + 1,
    )

    lines = content.split("\n")

    # Functions
    for i, line in enumerate(lines):
        stripped = line.strip()

        # Top-level and nested functions
        fn_match = re.match(r"^(\s*)def\s+(\w+)\s*\((.*?)(?:\).*)?$", stripped)
        if fn_match:
            fn_match.group(1)
            name = fn_match.group(2)
            params = fn_match.group(3)

            # Find end of function (next line at same or less indent)
            end_line = i + 1
            fn_indent = len(line) - len(line.lstrip())
            for j in range(i + 1, len(lines)):
                if lines[j].strip() and (len(lines[j]) - len(lines[j].lstrip())) <= fn_indent:
                    end_line = j
                    break
            else:
                end_line = len(lines)

            kind = SymbolKind.METHOD if fn_indent > 0 else SymbolKind.FUNCTION
            result.symbols.append(
                ParsedSymbol(
                    name=name,
                    kind=kind,
                    line_start=i + 1,
                    line_end=end_line,
                    signature=f"def {name}({params})",
                    is_exported=not name.startswith("_"),
                )
            )

        # Classes
        cls_match = re.match(r"^class\s+(\w+)(?:\(([^)]*)\))?:", stripped)
        if cls_match:
            name = cls_match.group(1)
            bases = cls_match.group(2) or ""

            end_line = i + 1
            for j in range(i + 1, len(lines)):
                if (
                    lines[j].strip()
                    and not lines[j].startswith(" ")
                    and not lines[j].startswith("\t")
                ):
                    end_line = j
                    break
            else:
                end_line = len(lines)

            result.symbols.append(
                ParsedSymbol(
                    name=name,
                    kind=SymbolKind.CLASS,
                    line_start=i + 1,
                    line_end=end_line,
                    signature=f"class {name}({bases})" if bases else f"class {name}",
                    is_exported=not name.startswith("_"),
                )
            )

        # Imports
        import_match = re.match(r"^from\s+([\w.]+)\s+import\s+(.+)$", stripped)
        if import_match:
            source = import_match.group(1)
            specs = [s.strip().split(" as ")[0] for s in import_match.group(2).split(",")]
            result.imports.append(
                ParsedImport(
                    source=source,
                    specifiers=specs,
                    line=i + 1,
                )
            )
        else:
            simple_import = re.match(r"^import\s+([\w.]+)", stripped)
            if simple_import:
                result.imports.append(
                    ParsedImport(
                        source=simple_import.group(1),
                        line=i + 1,
                    )
                )

        # Constants
        const_match = re.match(r"^([A-Z][A-Z_0-9]+)\s*=", stripped)
        if const_match:
            result.symbols.append(
                ParsedSymbol(
                    name=const_match.group(1),
                    kind=SymbolKind.CONSTANT,
                    line_start=i + 1,
                    line_end=i + 1,
                    is_exported=True,
                )
            )

    # Exports
    _extract_exports(result, file_path)

    return result
