"""Tests for JavaScript/TypeScript parsers."""

from app.parsers.javascript import JavaScriptParser, TypeScriptParser, _parse_js_ts_regex
from app.parsers.base import SymbolKind


class TestJavaScriptRegexParser:
    """Test the regex fallback parser for JS files."""

    def test_extracts_imports(self, sample_js_content: str):
        result = _parse_js_ts_regex("test.js", sample_js_content, "JavaScript")
        sources = [imp.source for imp in result.imports]
        assert "react" in sources
        assert "../lib/api" in sources

    def test_extracts_functions(self, sample_js_content: str):
        result = _parse_js_ts_regex("test.js", sample_js_content, "JavaScript")
        func_names = [s.name for s in result.symbols if s.kind == SymbolKind.FUNCTION]
        assert "Dashboard" in func_names

    def test_extracts_classes(self, sample_js_content: str):
        result = _parse_js_ts_regex("test.js", sample_js_content, "JavaScript")
        class_names = [s.name for s in result.symbols if s.kind == SymbolKind.CLASS]
        assert "DataService" in class_names

    def test_detects_exports(self, sample_js_content: str):
        result = _parse_js_ts_regex("test.js", sample_js_content, "JavaScript")
        exported = [s.name for s in result.symbols if s.is_exported]
        assert "Dashboard" in exported

    def test_counts_lines(self, sample_js_content: str):
        result = _parse_js_ts_regex("test.js", sample_js_content, "JavaScript")
        assert result.line_count > 0

    def test_handles_empty_content(self):
        result = _parse_js_ts_regex("empty.js", "", "JavaScript")
        assert result.line_count == 1
        assert len(result.symbols) == 0

    def test_handles_malformed_content(self):
        content = "{{{{invalid javascript syntax!!!}}}}"
        result = _parse_js_ts_regex("bad.js", content, "JavaScript")
        # Should not raise, just return empty results
        assert result.file_path == "bad.js"


class TestTypeScriptRegexParser:
    def test_extracts_interfaces(self, sample_ts_content: str):
        result = _parse_js_ts_regex("test.ts", sample_ts_content, "TypeScript")
        interface_names = [s.name for s in result.symbols if s.kind == SymbolKind.INTERFACE]
        assert "AuthConfig" in interface_names

    def test_extracts_type_aliases(self, sample_ts_content: str):
        result = _parse_js_ts_regex("test.ts", sample_ts_content, "TypeScript")
        type_names = [s.name for s in result.symbols if s.kind == SymbolKind.TYPE_ALIAS]
        assert "UserRole" in type_names

    def test_extracts_classes(self, sample_ts_content: str):
        result = _parse_js_ts_regex("test.ts", sample_ts_content, "TypeScript")
        class_names = [s.name for s in result.symbols if s.kind == SymbolKind.CLASS]
        assert "UserController" in class_names

    def test_extracts_arrow_functions(self, sample_ts_content: str):
        result = _parse_js_ts_regex("test.ts", sample_ts_content, "TypeScript")
        func_names = [s.name for s in result.symbols if s.kind == SymbolKind.FUNCTION]
        assert "createRouter" in func_names


class TestParserCanParse:
    def test_js_parser_extensions(self):
        parser = JavaScriptParser()
        assert parser.can_parse("file.js")
        assert parser.can_parse("file.jsx")
        assert parser.can_parse("file.mjs")
        assert not parser.can_parse("file.ts")
        assert not parser.can_parse("file.py")

    def test_ts_parser_extensions(self):
        parser = TypeScriptParser()
        assert parser.can_parse("file.ts")
        assert parser.can_parse("file.tsx")
        assert not parser.can_parse("file.js")
