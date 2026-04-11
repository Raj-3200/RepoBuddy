"""Application-wide exception types and handlers."""

from fastapi import HTTPException, status


class RepoBuddyError(Exception):
    """Base exception for all RepoBuddy errors."""

    def __init__(self, message: str = "An internal error occurred"):
        self.message = message
        super().__init__(self.message)


class RepositoryNotFoundError(RepoBuddyError):
    def __init__(self, repo_id: str):
        super().__init__(f"Repository not found: {repo_id}")


class AnalysisNotFoundError(RepoBuddyError):
    def __init__(self, analysis_id: str):
        super().__init__(f"Analysis not found: {analysis_id}")


class InvalidRepositoryError(RepoBuddyError):
    def __init__(self, reason: str = "Invalid repository"):
        super().__init__(reason)


class ParserError(RepoBuddyError):
    def __init__(self, file_path: str, reason: str):
        super().__init__(f"Failed to parse {file_path}: {reason}")


class IngestionError(RepoBuddyError):
    def __init__(self, reason: str):
        super().__init__(f"Ingestion failed: {reason}")


class FileTooLargeError(RepoBuddyError):
    def __init__(self, max_mb: int):
        super().__init__(f"File exceeds maximum upload size of {max_mb}MB")


class UnsupportedFileTypeError(RepoBuddyError):
    def __init__(self, file_type: str):
        super().__init__(f"Unsupported file type: {file_type}")


def raise_not_found(detail: str = "Resource not found") -> None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def raise_bad_request(detail: str = "Bad request") -> None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def raise_conflict(detail: str = "Conflict") -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
