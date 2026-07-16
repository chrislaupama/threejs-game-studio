#!/usr/bin/env python3
"""Reject provider/API tooling and remote dependencies bundled in this skill.

This audits the reusable skill package itself. Use audit_local_only.py for game
projects and live browser request blocking for runtime evidence.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


TEXT_SUFFIXES = {
    ".css", ".frag", ".glsl", ".html", ".js", ".json", ".md", ".mjs",
    ".py", ".sh", ".svg", ".ts", ".tsx", ".txt", ".vert", ".yaml", ".yml",
}

SKIP_DIRS = {
    ".git", ".vite", "dist", "node_modules", "playwright-report", "test-results",
}

# These files must contain detection fixtures/patterns or legal attribution.
EXEMPT_PATHS = {
    Path("LICENSE"),
    Path("NOTICE.md"),
    Path("scripts/audit_local_only.py"),
    Path("scripts/audit_skill_local_only.py"),
    Path("scripts/test_audit_local_only.py"),
    Path("scripts/test_audit_skill_local_only.py"),
    Path("assets/threejs-vite-game/scripts/audit_local_only.py"),
}

SKIP_NAMES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"}

FORBIDDEN_FILENAMES = {
    "generate_image.py",
    "probe_asset_credentials.sh",
    "threejs_3d_asset.py",
    "threejs_audio_asset.py",
}

CONTENT_PATTERNS = {
    "provider credential": re.compile(
        r"(?i)\b(?:TRIPO|GEMINI|GOOGLE|ELEVENLABS)_API_KEY\b"
    ),
    "provider API/SDK": re.compile(
        r"(?i)(?:api\.tripo3d\.ai|api\.elevenlabs\.io|google-genai|"
        r"gemini-[a-z0-9.-]+|xi-api-key|Authorization\s*:\s*Bearer)"
    ),
    "provider helper reference": re.compile(
        r"(?i)\b(?:probe_asset_credentials|threejs_3d_asset|generate_image\.py|"
        r"threejs_audio_asset)\b"
    ),
    "MCP invocation syntax": re.compile(
        r"(?i)\b(?:mcp__[a-z0-9_]+|(?:list|read)_mcp_(?:resources?|resource_templates))\b"
    ),
}

REMOTE_URL = re.compile(r"(?i)(?:https?|wss?)://[^\s'\"`)<>]+")
ALLOWED_URL = re.compile(
    r"(?i)(?:https?|wss?)://(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)"
    r"(?::\d+)?(?:/|$)"
)
ALLOWED_NAMESPACE_URLS = {
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/2000/xmlns/",
}
ALLOWED_DOCUMENTATION_URLS = {
    Path("README.md"): {
        "https://github.com/chrislaupama/threejs-game-studio",
    },
}

NETWORK_CLIENT = re.compile(
    r"(?im)^\s*(?:(?:from|import)\s+(?:requests|httpx|aiohttp|urllib\.request)\b|"
    r"(?:curl|wget)\s+)"
)


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    reason: str
    excerpt: str


def line_for(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def excerpt_for(text: str, offset: int) -> str:
    start = text.rfind("\n", 0, offset) + 1
    end = text.find("\n", offset)
    if end < 0:
        end = len(text)
    return text[start:end].strip()[:180]


def files_to_scan(root: Path) -> list[Path]:
    result: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_DIRS for part in relative.parts):
            continue
        if relative in EXEMPT_PATHS or path.name in SKIP_NAMES:
            continue
        if path.suffix.lower() in TEXT_SUFFIXES or path.name == "package.json":
            result.append(path)
    return sorted(result)


def audit_file(path: Path, root: Path) -> list[Finding]:
    relative = path.relative_to(root)
    findings: list[Finding] = []
    if path.name in FORBIDDEN_FILENAMES:
        findings.append(Finding(relative, 1, "provider helper file", path.name))

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        return [Finding(relative, 1, "unreadable file", str(error))]

    for reason, pattern in CONTENT_PATTERNS.items():
        for match in pattern.finditer(text):
            findings.append(
                Finding(relative, line_for(text, match.start()), reason, excerpt_for(text, match.start()))
            )

    for match in REMOTE_URL.finditer(text):
        value = match.group(0).rstrip(".,;")
        if (
            value in ALLOWED_NAMESPACE_URLS
            or value in ALLOWED_DOCUMENTATION_URLS.get(relative, set())
            or ALLOWED_URL.match(value)
        ):
            continue
        findings.append(
            Finding(relative, line_for(text, match.start()), "non-local URL", value[:180])
        )

    if path.suffix.lower() in {".py", ".sh"}:
        for match in NETWORK_CLIENT.finditer(text):
            findings.append(
                Finding(relative, line_for(text, match.start()), "network client command/import", excerpt_for(text, match.start()))
            )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reject bundled provider generators, MCP calls, credentials, and remote URLs."
    )
    parser.add_argument("skill", nargs="?", default=".", help="Skill package root.")
    args = parser.parse_args()

    root = Path(args.skill).resolve()
    if not root.is_dir():
        print(f"Skill directory not found: {root}", file=sys.stderr)
        return 2

    findings: list[Finding] = []
    for path in files_to_scan(root):
        findings.extend(audit_file(path, root))

    if findings:
        print("Skill local-only audit failed:")
        for item in sorted(findings, key=lambda value: (str(value.path), value.line, value.reason)):
            print(f"- {item.path}:{item.line}: {item.reason}: {item.excerpt}")
        return 1

    print(
        "Skill local-only audit passed: no bundled provider helpers, credentials, "
        "MCP invocations, network clients, or non-local URLs found outside "
        "legal/fixture files and the documented repository install URL."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
