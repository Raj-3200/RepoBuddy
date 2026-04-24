"""Base parser interface and data structures."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import ClassVar


class SymbolKind(str, Enum):
    FUNCTION = "function"
    CLASS = "class"
    METHOD = "method"
    VARIABLE = "variable"
    INTERFACE = "interface"
    TYPE_ALIAS = "type_alias"
    ENUM = "enum"
    CONSTANT = "constant"
    EXPORT = "export"


@dataclass
class ParsedSymbol:
    name: str
    kind: SymbolKind
    line_start: int
    line_end: int | None = None
    signature: str | None = None
    docstring: str | None = None
    is_exported: bool = False
    metadata: dict = field(default_factory=dict)


@dataclass
class ParsedImport:
    source: str  # The module path being imported
    specifiers: list[str] = field(default_factory=list)  # Named imports
    is_default: bool = False
    is_side_effect: bool = False
    line: int = 0


@dataclass
class ParsedExport:
    name: str
    kind: str = "named"
    source: str | None = None
    line: int = 0


@dataclass
class ParseResult:
    file_path: str
    language: str
    symbols: list[ParsedSymbol] = field(default_factory=list)
    imports: list[ParsedImport] = field(default_factory=list)
    exports: list[ParsedExport] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    line_count: int = 0


class BaseParser:
    """Abstract base parser. All language parsers must implement this interface."""

    supported_extensions: ClassVar[set[str]] = set()

    def can_parse(self, file_path: str) -> bool:
        return Path(file_path).suffix.lower() in self.supported_extensions

    def parse(self, file_path: str, content: str) -> ParseResult:
        raise NotImplementedError
