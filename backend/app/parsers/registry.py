"""Parser registry — maps file extensions to parser instances."""

from app.parsers.base import BaseParser, ParseResult
from app.parsers.javascript import JavaScriptParser, TypeScriptParser
from app.core.logging import get_logger

logger = get_logger(__name__)

_parsers: list[BaseParser] = [
    JavaScriptParser(),
    TypeScriptParser(),
]


def get_parser(file_path: str) -> BaseParser | None:
    """Get the appropriate parser for a file."""
    for parser in _parsers:
        if parser.can_parse(file_path):
            return parser
    return None


def parse_file(file_path: str, content: str) -> ParseResult | None:
    """Parse a file and return results, or None if no parser available."""
    parser = get_parser(file_path)
    if parser is None:
        return None

    try:
        return parser.parse(file_path, content)
    except Exception as e:
        logger.warning("parser_error", file=file_path, error=str(e))
        return ParseResult(
            file_path=file_path,
            language="unknown",
            errors=[str(e)],
        )


def register_parser(parser: BaseParser) -> None:
    """Register a new parser (for extensibility)."""
    _parsers.append(parser)
