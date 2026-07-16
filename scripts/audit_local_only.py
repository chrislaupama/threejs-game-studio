#!/usr/bin/env python3
"""Audit a browser game for unapproved runtime network and package dependencies.

This is conservative static evidence, not proof. Pair it with the bundled live
browser request blocker and a production-preview run.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


RUNTIME_SUFFIXES = {
    ".css", ".frag", ".glsl", ".gltf", ".htm", ".html", ".js", ".jsx",
    ".json", ".mjs", ".cjs", ".svg", ".ts", ".tsx", ".vert",
    ".webmanifest", ".xml",
}

RUNTIME_DIRS = {
    "api", "app", "client", "dist", "functions", "public", "server", "src", "workers",
}

SKIP_DIRS = {
    ".git", ".vite", "coverage", "node_modules", "playwright-report",
    "test-results", "tests",
}

SKIP_FILES = {
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
}

NETWORK_PATTERNS = {
    "remote URL": re.compile(r"(?i)(?:https?|wss?)://"),
    "protocol-relative URL": re.compile(
        r"(?i)(?<!:)//(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d+)?(?:/|(?=['\"]))"
    ),
    "fetch call": re.compile(
        r"(?i)(?:\bfetch|\[\s*['\"]fetch['\"]\s*\])\s*(?:\?\.)?\s*\("
    ),
    "XMLHttpRequest": re.compile(r"\bXMLHttpRequest\b"),
    "WebSocket": re.compile(r"\bWebSocket\s*\("),
    "EventSource": re.compile(r"\bEventSource\s*\("),
    "sendBeacon": re.compile(
        r"(?i)(?:\bsendBeacon|\[\s*['\"]sendBeacon['\"]\s*\])\s*(?:\?\.)?\s*\("
    ),
    "importScripts": re.compile(r"\bimportScripts\s*\("),
    "RTCPeerConnection": re.compile(r"\bRTCPeerConnection\b"),
    "WebTransport": re.compile(r"\bWebTransport\s*\("),
    "axios": re.compile(r"(?:\baxios\b|from\s*['\"]axios['\"])"),
    "credential environment lookup": re.compile(
        r"(?i)(?:import\.meta\.env|process\.env)[^\n;]*(?:key|token|secret|credential)"
    ),
    "MCP runtime reference": re.compile(r"(?i)\bmcp(?:server|client|tool|resource)?\b"),
}

IMPORT_PATTERN = re.compile(
    r"(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*|\brequire\s*\(\s*)"
    r"['\"]([^'\"]+)['\"]",
    re.MULTILINE,
)

DECLARATIVE_NAMESPACE_URIS = {
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/2000/xmlns/",
}

LOCAL_URL_PATTERN = re.compile(
    r"(?i)(?:https?|wss?)://(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)"
    r"(?::\d+)?"
)

NODE_BUILTINS = {
    "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https",
    "module", "os", "path", "perf_hooks", "process", "stream", "url", "util", "worker_threads",
}


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    reason: str
    excerpt: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reject remote runtime URLs, network APIs, credential lookups, and "
            "new browser-runtime packages. Static evidence only; also run live request QA."
        )
    )
    parser.add_argument("project", nargs="?", default=".", help="Project root to audit.")
    parser.add_argument(
        "--baseline-package-json",
        help=(
            "Discovery-time package.json from outside the working tree. Only runtime "
            "dependency names recorded there are grandfathered for an existing project."
        ),
    )
    return parser.parse_args()


def line_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def line_excerpt(text: str, offset: int) -> str:
    start = text.rfind("\n", 0, offset) + 1
    end = text.find("\n", offset)
    if end < 0:
        end = len(text)
    return text[start:end].strip()[:180]


def package_name(specifier: str) -> str:
    if specifier.startswith("@"):
        return "/".join(specifier.split("/")[:2])
    return specifier.split("/", 1)[0]


def is_config_file(path: Path, root: Path) -> bool:
    if path.parent != root:
        return False
    name = path.name.lower()
    return ".config." in name or name.startswith(("vite.", "webpack.", "rollup."))


def is_allowed_import(
    specifier: str,
    runtime_allowed: set[str],
    tooling_allowed: set[str],
    config_file: bool,
) -> bool:
    if specifier.startswith((".", "/", "#", "@/", "~/")):
        return True
    if config_file and (
        specifier.startswith("node:")
        or specifier in NODE_BUILTINS
        or package_name(specifier) in tooling_allowed
    ):
        return True
    return package_name(specifier) in runtime_allowed


def runtime_files(root: Path) -> list[Path]:
    candidates: set[Path] = set()
    for relative in RUNTIME_DIRS:
        base = root / relative
        if base.is_dir():
            candidates.update(path for path in base.rglob("*") if path.is_file())

    for path in root.iterdir():
        if path.is_file() and path.name not in SKIP_FILES:
            candidates.add(path)

    return sorted(
        path
        for path in candidates
        if path.suffix.lower() in RUNTIME_SUFFIXES
        and path.name not in SKIP_FILES
        and not any(part in SKIP_DIRS for part in path.relative_to(root).parts)
        and not path.name.endswith(".map")
        and path.name != "package.json"
    )


def read_package(path: Path) -> tuple[dict[str, object] | None, str | None]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return None, str(error)
    if not isinstance(data, dict):
        return None, "root value must be an object"
    return data, None


def dependency_versions(data: dict[str, object] | None, field: str) -> dict[str, str]:
    if not data or not isinstance(data.get(field), dict):
        return {}
    return {
        str(name): str(version)
        for name, version in data[field].items()  # type: ignore[union-attr]
        if isinstance(name, str) and isinstance(version, str)
    }


def audit_package_json(
    root: Path,
    runtime_allowed: set[str],
    baseline_versions: dict[str, str],
) -> tuple[list[Finding], set[str]]:
    path = root / "package.json"
    if not path.exists():
        return [], set()
    data, error = read_package(path)
    if error or data is None:
        return [Finding(path, 1, "invalid package.json", error or "unknown error")], set()

    findings: list[Finding] = []
    dependencies = dependency_versions(data, "dependencies")
    dev_dependencies = set(dependency_versions(data, "devDependencies"))
    for name, version in dependencies.items():
        if name not in runtime_allowed:
            findings.append(Finding(path, 1, "new/unapproved runtime package", f"{name}: {version}"))
        historical_exact = baseline_versions.get(name) == version
        if re.search(r"(?i)(?:https?://|git(?:\+|://)|github:|file:|\.\./)", version):
            if not historical_exact:
                findings.append(
                    Finding(path, 1, "new URL/git/path runtime dependency", f"{name}: {version}")
                )

    scripts = data.get("scripts", {})
    if isinstance(scripts, dict):
        for name, command in scripts.items():
            if not isinstance(command, str):
                continue
            scan = redact_allowed_uris(command)
            for reason, pattern in NETWORK_PATTERNS.items():
                match = pattern.search(scan)
                if match:
                    findings.append(
                        Finding(path, 1, f"package script {reason}", f"{name}: {command}"[:180])
                    )
    return findings, dev_dependencies


def redact_allowed_uris(text: str) -> str:
    result = text
    for uri in DECLARATIVE_NAMESPACE_URIS:
        result = result.replace(uri, " " * len(uri))
    result = LOCAL_URL_PATTERN.sub(lambda match: " " * len(match.group(0)), result)
    return result


def strip_javascript_comments(text: str) -> str:
    """Replace JS/TS comments with spaces while preserving strings and offsets."""
    chars = list(text)
    index = 0
    state = "code"
    quote = ""
    while index < len(chars):
        char = chars[index]
        next_char = chars[index + 1] if index + 1 < len(chars) else ""
        if state == "code":
            if char in {"'", '"', "`"}:
                state = "string"
                quote = char
            elif char == "/" and next_char == "/":
                chars[index] = chars[index + 1] = " "
                index += 2
                while index < len(chars) and chars[index] not in {"\n", "\r"}:
                    chars[index] = " "
                    index += 1
                continue
            elif char == "/" and next_char == "*":
                chars[index] = chars[index + 1] = " "
                index += 2
                while index < len(chars) - 1:
                    if chars[index] == "*" and chars[index + 1] == "/":
                        chars[index] = chars[index + 1] = " "
                        index += 2
                        break
                    if chars[index] not in {"\n", "\r"}:
                        chars[index] = " "
                    index += 1
                continue
        elif state == "string":
            if char == "\\":
                index += 2
                continue
            if char == quote:
                state = "code"
                quote = ""
        index += 1
    return "".join(chars)


def redact_provenance_comment_urls(text: str) -> str:
    """Redact URL-only source comments that may live inside bundled shader strings."""
    pattern = re.compile(r"(?m)//\s+https?://[^\r\n]*")
    return pattern.sub(lambda match: " " * len(match.group(0)), text)


def audit_file(
    path: Path,
    root: Path,
    runtime_allowed: set[str],
    tooling_allowed: set[str],
) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        return [Finding(path, 1, "unreadable file", str(error))]

    findings: list[Finding] = []
    scan_text = redact_allowed_uris(text)
    if path.suffix.lower() in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}:
        scan_text = strip_javascript_comments(scan_text)
        scan_text = redact_provenance_comment_urls(scan_text)
    built_output = "dist" in path.relative_to(root).parts
    patterns = NETWORK_PATTERNS.items()
    if built_output:
        patterns = (
            (reason, pattern)
            for reason, pattern in NETWORK_PATTERNS.items()
            if reason in {"remote URL", "protocol-relative URL"}
        )
    for reason, pattern in patterns:
        for match in pattern.finditer(scan_text):
            findings.append(
                Finding(
                    path.relative_to(root),
                    line_for_offset(text, match.start()),
                    reason,
                    line_excerpt(text, match.start()),
                )
            )

    if path.suffix.lower() in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}:
        config_file = is_config_file(path, root)
        for match in IMPORT_PATTERN.finditer(text):
            specifier = match.group(1)
            if not is_allowed_import(specifier, runtime_allowed, tooling_allowed, config_file):
                findings.append(
                    Finding(
                        path.relative_to(root),
                        line_for_offset(text, match.start()),
                        "unapproved bare runtime import",
                        specifier,
                    )
                )
    return findings


def main() -> int:
    args = parse_args()
    root = Path(args.project).resolve()
    if not root.is_dir():
        print(f"Project directory not found: {root}", file=sys.stderr)
        return 2

    baseline_versions: dict[str, str] = {}
    if args.baseline_package_json:
        baseline_path = Path(args.baseline_package_json).resolve()
        baseline, error = read_package(baseline_path)
        if error or baseline is None:
            print(f"Invalid baseline package.json: {baseline_path}: {error}", file=sys.stderr)
            return 2
        baseline_versions = dependency_versions(baseline, "dependencies")

    runtime_allowed = {"three", *baseline_versions}
    findings, dev_dependencies = audit_package_json(root, runtime_allowed, baseline_versions)
    tooling_allowed = {*runtime_allowed, *dev_dependencies}
    for path in runtime_files(root):
        findings.extend(audit_file(path, root, runtime_allowed, tooling_allowed))

    if findings:
        print("Local-only audit failed:")
        for finding in sorted(findings, key=lambda item: (str(item.path), item.line, item.reason)):
            print(f"- {finding.path}:{finding.line}: {finding.reason}: {finding.excerpt}")
        return 1

    print(
        "Local-only audit passed: no static remote runtime URLs, network APIs, "
        "credential probes, MCP references, or new runtime packages found. "
        "Run live outbound-request QA as separate evidence."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
