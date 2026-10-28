"""Local configuration and the user-facing rehearsal contract."""

import hashlib
import os
import re
from pathlib import Path

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
ENV = dotenv_values(ROOT / ".env")
if os.environ.get("ORICLUS_AWS") == "1":
    ENV.update(os.environ)
DATA = ROOT / ".oriclus"
WORKSPACE = hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
IMAGE = ENV.get("SANDBOX_IMAGE") or "oriclus-python:local"
MODEL = ENV.get("NEBIUS_MODEL") or ""
KEY = ENV.get("NEBIUS_API_KEY") or ""
TAVILY_KEY = ENV.get("TAVILY_API_KEY") or ""
BASE_URL = (ENV.get("NEBIUS_BASE_URL") or "").rstrip("/")
MAX_TURNS = int(ENV.get("AGENT_MAX_TURNS") or 32)
MAX_TOKENS = int(ENV.get("AGENT_MAX_TOKENS") or 8192)


class BoundaryError(RuntimeError):
    """An expected integration failure safe to show in run history."""


def safe_error(error: Exception) -> str:
    text = str(error)
    for key in (KEY, TAVILY_KEY, ENV.get("NEBIUS_SANDBOX_API_KEY")):
        if key:
            text = text.replace(key, "[redacted]")
    return text


def repository_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value):
        raise ValueError(
            "Use a public HTTPS GitHub repository URL without credentials or query parameters."
        )
    return value.removesuffix(".git")


def git_ref(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,199}", value) or ".." in value:
        raise ValueError("Use a Git tag, branch, commit SHA or pull/NUMBER/head ref.")
    return value


class Consumer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repository: str
    ref: str = "HEAD"
    install_command: str = Field(min_length=1, max_length=8000)
    test_command: str = Field(min_length=1, max_length=8000)
    editable_paths: list[str] = Field(min_length=1, max_length=12)

    _repository = field_validator("repository")(repository_url)
    _ref = field_validator("ref")(git_ref)

    @field_validator("install_command", "test_command")
    @classmethod
    def nonempty_command(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Supply an actual command, not whitespace.")
        return value

    @field_validator("editable_paths")
    @classmethod
    def source_paths(cls, values: list[str]) -> list[str]:
        for value in values:
            if not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/", value):
                raise ValueError(
                    "Editable paths must be relative source directories ending in /, such as src/."
                )
        return values


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    upstream: str
    baseline_ref: str
    candidate_ref: str
    package: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
    consumers: list[Consumer] = Field(min_length=1, max_length=10)
    repair_attempts: int = Field(default=3, ge=0, le=3)

    _upstream = field_validator("upstream")(repository_url)
    _refs = field_validator("baseline_ref", "candidate_ref")(git_ref)


class DiscoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    upstream: str
    baseline_ref: str = ""
    candidate_ref: str = ""
    consumers: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("upstream")
    @classmethod
    def upstream_url(cls, value: str) -> str:
        value = value.strip()
        if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value):
            value = f"https://github.com/{value}"
        return repository_url(value)

    @field_validator("consumers")
    @classmethod
    def consumer_urls(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(cls.upstream_url(value) for value in values))

    @field_validator("baseline_ref", "candidate_ref")
    @classmethod
    def optional_ref(cls, value: str) -> str:
        return git_ref(value.strip()) if value.strip() else ""
