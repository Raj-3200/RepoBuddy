"""Tests for clone error classification in repository_service."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import git
import pytest

from app.core.exceptions import InvalidRepositoryError
from app.services.repository_service import clone_github_repo


def _raise(stderr: str):
    def _side_effect(*_args, **_kwargs):
        err = git.exc.GitCommandError(["git", "clone"], 128)
        err.stderr = stderr
        raise err

    return _side_effect


def test_private_repo_message(tmp_path: Path):
    with patch("git.Repo.clone_from", side_effect=_raise(
        "fatal: could not read Username for 'https://github.com': No such device"
    )):
        with pytest.raises(InvalidRepositoryError) as exc:
            clone_github_repo("https://github.com/owner/repo", tmp_path / "r", None)
    assert "private" in str(exc.value).lower() or "authentication" in str(exc.value).lower()


def test_not_found_message(tmp_path: Path):
    with patch("git.Repo.clone_from", side_effect=_raise(
        "remote: Repository not found.\nfatal: repository ... not found"
    )):
        with pytest.raises(InvalidRepositoryError) as exc:
            clone_github_repo("https://github.com/owner/nope", tmp_path / "r", None)
    assert "not found" in str(exc.value).lower()


def test_network_error_message(tmp_path: Path):
    with patch("git.Repo.clone_from", side_effect=_raise(
        "fatal: unable to access ...: Could not resolve host: github.com"
    )):
        with pytest.raises(InvalidRepositoryError) as exc:
            clone_github_repo("https://github.com/owner/repo", tmp_path / "r", None)
    assert "network" in str(exc.value).lower()


def test_partial_clone_dir_is_cleaned_up(tmp_path: Path):
    target = tmp_path / "r"
    target.mkdir()
    (target / "leftover.txt").write_text("partial")

    with patch("git.Repo.clone_from", side_effect=_raise(
        "fatal: authentication failed"
    )):
        with pytest.raises(InvalidRepositoryError):
            clone_github_repo("https://github.com/owner/repo", target, None)

    assert not target.exists(), "Partial clone dir must be removed before raising"
