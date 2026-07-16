#!/usr/bin/env python3
"""Validate the self-contained structure and r185 scaffold contract of the skill."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote


SKIP_DIRS = {
    ".git",
    ".vite",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
}

LEGAL_FILENAMES = {
    "copying",
    "copying.md",
    "license",
    "license.md",
    "notice.md",
    "third-party-notices.md",
    "third_party_notices.md",
}

MARKDOWN_LINK = re.compile(r"!?\[[^\]\n]*\]\(([^)\n]+)\)")
MARKDOWN_REFERENCE = re.compile(r"(?m)^[ \t]*\[[^\]\n]+\]:[ \t]*(\S[^\n]*)$")
EXTERNAL_TARGET = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
FRONTMATTER_NAME = re.compile(r"(?m)^name:[ \t]*['\"]?([A-Za-z0-9_-]+)")

SKILL_URI = re.compile(r"(?i)\bskill://([A-Za-z0-9][A-Za-z0-9_-]*)")
INSTALLED_SKILL_PATH = re.compile(
    r"(?i)(?:\.codex|\.agents)/skills/([A-Za-z0-9][A-Za-z0-9_-]*)"
)
NAMED_SKILL_PATH = re.compile(
    r"(?i)([A-Za-z0-9][A-Za-z0-9_-]*)/(?:SKILL\.md|references(?:/|\b))"
)
EXPLICIT_SKILL_INVOCATION = re.compile(
    r"(?i)\b(?:use|load|read|invoke|run|call|require|delegate(?:\s+to)?)\s+"
    r"(?:the\s+)?(?:skill\s+)?\$([A-Za-z0-9][A-Za-z0-9_-]*)"
)
NAMED_SKILL_INVOCATION = re.compile(
    r"(?i)\b(?:use|load|read|invoke|run|call|require|delegate(?:\s+to)?)\s+"
    r"(?:the\s+)?([A-Za-z0-9][A-Za-z0-9_-]*)\s+skill\b"
)

STALE_TYPESCRIPT_APIS = (
    (
        "deprecated THREE.Clock timing",
        re.compile(r"\bTHREE\.Clock\b|\bnew\s+Clock\s*\("),
    ),
    (
        "manual requestAnimationFrame loop",
        re.compile(r"\b(?:window\.)?requestAnimationFrame\s*\("),
    ),
    (
        "manual cancelAnimationFrame loop",
        re.compile(r"\b(?:window\.)?cancelAnimationFrame\s*\("),
    ),
    ("removed renderer.outputEncoding", re.compile(r"\.outputEncoding\b")),
    (
        "removed color encoding constant",
        re.compile(r"\b(?:sRGBEncoding|LinearEncoding|GammaEncoding)\b"),
    ),
    (
        "removed renderer gamma setting",
        re.compile(r"\.(?:gammaOutput|gammaFactor)\b"),
    ),
    (
        "stale physical-light compatibility setting",
        re.compile(r"\.(?:physicallyCorrectLights|useLegacyLights)\b"),
    ),
    ("removed WebGL1Renderer", re.compile(r"\bWebGL1Renderer\b")),
    (
        "removed Geometry or Face3 API",
        re.compile(r"\b(?:THREE\.)?(?:Geometry|Face3)\b"),
    ),
    (
        "removed legacy loader or material API",
        re.compile(r"\b(?:JSONLoader|MeshFaceMaterial)\b"),
    ),
    (
        "removed WebGLMultipleRenderTargets",
        re.compile(r"\bWebGLMultipleRenderTargets\b"),
    ),
    (
        "removed ImageUtils.loadTexture",
        re.compile(r"\bImageUtils\.loadTexture\s*\("),
    ),
    ("removed BufferGeometry.addAttribute", re.compile(r"\.addAttribute\s*\(")),
    ("removed Object3D.applyMatrix", re.compile(r"\.applyMatrix\s*\(")),
    ("removed Matrix4.getInverse", re.compile(r"\.getInverse\s*\(")),
    (
        "renamed BufferGeometryUtils.mergeBufferGeometries",
        re.compile(r"\bmergeBufferGeometries\s*\("),
    ),
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


def is_skipped(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        return True
    return any(part in SKIP_DIRS for part in relative.parts)


def safe_read(path: Path, root: Path) -> tuple[str | None, list[Finding]]:
    try:
        return path.read_text(encoding="utf-8", errors="replace"), []
    except OSError as error:
        return None, [
            Finding(path.relative_to(root), 1, "unreadable file", str(error))
        ]


def strip_fenced_markdown(text: str) -> str:
    """Blank fenced code while preserving offsets and line numbering."""
    output: list[str] = []
    fence: str | None = None
    for line in text.splitlines(keepends=True):
        match = re.match(r"^[ \t]{0,3}(`{3,}|~{3,})", line)
        if match:
            marker = match.group(1)
            marker_kind = marker[0]
            if fence is None:
                fence = marker_kind
            elif fence == marker_kind:
                fence = None
            output.append("".join("\n" if char == "\n" else " " for char in line))
            continue
        if fence is None:
            output.append(line)
        else:
            output.append("".join("\n" if char == "\n" else " " for char in line))
    return "".join(output)


def markdown_target(raw_target: str) -> str:
    value = raw_target.strip()
    if value.startswith("<"):
        end = value.find(">", 1)
        return value[1:end] if end >= 0 else value[1:]
    return value.split(None, 1)[0] if value else ""


def is_external_markdown_target(target: str) -> bool:
    return (
        not target
        or target.startswith(("#", "/", "//"))
        or bool(EXTERNAL_TARGET.match(target))
    )


def audit_markdown_links(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in sorted(root.rglob("*.md")):
        if is_skipped(path, root):
            continue
        text, errors = safe_read(path, root)
        findings.extend(errors)
        if text is None:
            continue
        searchable = strip_fenced_markdown(text)
        matches = [*MARKDOWN_LINK.finditer(searchable), *MARKDOWN_REFERENCE.finditer(searchable)]
        for match in sorted(matches, key=lambda item: item.start(1)):
            target = markdown_target(match.group(1))
            if is_external_markdown_target(target):
                continue
            clean_target = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not clean_target:
                continue
            candidate = (path.parent / clean_target).resolve()
            try:
                candidate.relative_to(root)
            except ValueError:
                findings.append(
                    Finding(
                        path.relative_to(root),
                        line_for(text, match.start(1)),
                        "relative Markdown link escapes the skill package",
                        target[:180],
                    )
                )
                continue
            if not candidate.exists():
                findings.append(
                    Finding(
                        path.relative_to(root),
                        line_for(text, match.start(1)),
                        "unresolved relative Markdown link",
                        target[:180],
                    )
                )
    return findings


def audit_skill_files(root: Path) -> tuple[list[Finding], str | None, str]:
    findings: list[Finding] = []
    skill_files = sorted(
        path
        for path in root.rglob("SKILL.md")
        if path.is_file() and not is_skipped(path, root)
    )
    relative_files = [path.relative_to(root) for path in skill_files]
    if len(skill_files) != 1:
        display = ", ".join(str(path) for path in relative_files) or "none"
        findings.append(
            Finding(
                Path("."),
                1,
                "expected exactly one SKILL.md",
                f"found {len(skill_files)}: {display}",
            )
        )

    root_skill = root / "SKILL.md"
    if not root_skill.is_file():
        findings.append(
            Finding(Path("SKILL.md"), 1, "root coordinator SKILL.md is missing", "SKILL.md")
        )
        return findings, None, root.name

    text, errors = safe_read(root_skill, root)
    findings.extend(errors)
    if text is None:
        return findings, None, root.name

    name_match = FRONTMATTER_NAME.search(text)
    skill_name = name_match.group(1) if name_match else root.name
    references_dir = root / "references"
    if references_dir.is_dir():
        for reference in sorted(references_dir.glob("*.md")):
            relative = reference.relative_to(root).as_posix()
            if relative not in text:
                findings.append(
                    Finding(
                        reference.relative_to(root),
                        1,
                        "reference is not directly named in root SKILL.md",
                        relative,
                    )
                )
    return findings, text, skill_name


def is_legal_file(path: Path) -> bool:
    return path.name.lower() in LEGAL_FILENAMES


def audit_cross_skill_references(root: Path, skill_name: str) -> list[Finding]:
    findings: list[Finding] = []
    normalized_name = skill_name.casefold()
    patterns = (
        (SKILL_URI, "cross-skill URI"),
        (INSTALLED_SKILL_PATH, "cross-skill installed path"),
        (NAMED_SKILL_PATH, "cross-skill package path"),
        (EXPLICIT_SKILL_INVOCATION, "cross-skill invocation"),
        (NAMED_SKILL_INVOCATION, "cross-skill invocation"),
    )

    for suffix in ("*.md", "*.yaml", "*.yml"):
        for path in sorted(root.rglob(suffix)):
            if is_skipped(path, root) or is_legal_file(path):
                continue
            text, errors = safe_read(path, root)
            findings.extend(errors)
            if text is None:
                continue
            relative = path.relative_to(root)
            occupied: set[tuple[int, str]] = set()

            for pattern, reason in patterns:
                for match in pattern.finditer(text):
                    target_name = match.group(1).casefold()
                    if target_name == normalized_name:
                        continue
                    key = (match.start(), reason)
                    if key in occupied:
                        continue
                    occupied.add(key)
                    findings.append(
                        Finding(
                            relative,
                            line_for(text, match.start()),
                            reason,
                            excerpt_for(text, match.start()),
                        )
                    )
    return findings


def strip_typescript_comments_and_strings(text: str) -> str:
    """Blank TS comments and strings while preserving offsets and newlines."""
    output = list(text)
    index = 0
    state = "code"
    quote = ""
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if state == "code":
            if char == "/" and following == "/":
                output[index] = output[index + 1] = " "
                index += 2
                state = "line-comment"
                continue
            if char == "/" and following == "*":
                output[index] = output[index + 1] = " "
                index += 2
                state = "block-comment"
                continue
            if char in {"'", '"', "`"}:
                quote = char
                output[index] = " "
                index += 1
                state = "string"
                continue
            index += 1
            continue
        if state == "line-comment":
            if char == "\n":
                state = "code"
            else:
                output[index] = " "
            index += 1
            continue
        if state == "block-comment":
            if char == "*" and following == "/":
                output[index] = output[index + 1] = " "
                index += 2
                state = "code"
                continue
            if char != "\n":
                output[index] = " "
            index += 1
            continue
        if char == "\\" and following:
            output[index] = " "
            if following != "\n":
                output[index + 1] = " "
            index += 2
            continue
        if char == quote:
            output[index] = " "
            index += 1
            state = "code"
            continue
        if char != "\n":
            output[index] = " "
        index += 1
    return "".join(output)


def package_line(text: str, package_name: str) -> int:
    match = re.search(rf'"{re.escape(package_name)}"\s*:', text)
    return line_for(text, match.start()) if match else 1


def audit_scaffold_package(root: Path) -> list[Finding]:
    relative = Path("assets/threejs-vite-game/package.json")
    path = root / relative
    if not path.is_file():
        return [Finding(relative, 1, "scaffold package.json is missing", str(relative))]
    text, errors = safe_read(path, root)
    if text is None:
        return errors
    try:
        package = json.loads(text)
    except json.JSONDecodeError as error:
        return [
            *errors,
            Finding(relative, error.lineno, "invalid scaffold package.json", error.msg),
        ]
    if not isinstance(package, dict):
        return [
            *errors,
            Finding(relative, 1, "invalid scaffold package.json", "top level must be an object"),
        ]

    expectations = (
        ("dependencies", "three", "0.185.1"),
        ("devDependencies", "@types/three", "0.185.1"),
    )
    findings = list(errors)
    for section, package_name, expected in expectations:
        values = package.get(section)
        actual = values.get(package_name) if isinstance(values, dict) else None
        if actual != expected:
            findings.append(
                Finding(
                    relative,
                    package_line(text, package_name),
                    "incorrect Three.js scaffold baseline",
                    f"{section}.{package_name}: expected {expected!r}, found {actual!r}",
                )
            )
    return findings


def audit_scaffold_typescript(root: Path) -> list[Finding]:
    source_root = root / "assets/threejs-vite-game/src"
    relative_root = source_root.relative_to(root)
    if not source_root.is_dir():
        return [Finding(relative_root, 1, "scaffold TypeScript source is missing", str(relative_root))]

    source_files = sorted(source_root.rglob("*.ts"))
    if not source_files:
        return [Finding(relative_root, 1, "scaffold TypeScript source is missing", "no .ts files")]

    findings: list[Finding] = []
    uses_timer = False
    uses_animation_loop = False
    for path in source_files:
        text, errors = safe_read(path, root)
        findings.extend(errors)
        if text is None:
            continue
        code = strip_typescript_comments_and_strings(text)
        if re.search(r"\bnew\s+THREE\.Timer\s*\(", code):
            uses_timer = True
        if re.search(r"\b(?:this\.)?renderer\.setAnimationLoop\s*\(", code):
            uses_animation_loop = True
        for reason, pattern in STALE_TYPESCRIPT_APIS:
            for match in pattern.finditer(code):
                findings.append(
                    Finding(
                        path.relative_to(root),
                        line_for(text, match.start()),
                        reason,
                        excerpt_for(text, match.start()),
                    )
                )

    if not uses_timer:
        findings.append(
            Finding(
                relative_root,
                1,
                "scaffold must use THREE.Timer",
                "expected new THREE.Timer() in scaffold source",
            )
        )
    if not uses_animation_loop:
        findings.append(
            Finding(
                relative_root,
                1,
                "scaffold must use renderer.setAnimationLoop",
                "expected renderer.setAnimationLoop(...) in scaffold source",
            )
        )
    return findings


def audit(root: Path) -> list[Finding]:
    root = root.resolve()
    findings, _skill_text, skill_name = audit_skill_files(root)
    findings.extend(audit_markdown_links(root))
    findings.extend(audit_cross_skill_references(root, skill_name))
    findings.extend(audit_scaffold_package(root))
    findings.extend(audit_scaffold_typescript(root))
    return sorted(
        findings,
        key=lambda item: (item.path.as_posix(), item.line, item.reason, item.excerpt),
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate one coordinator, local links, self-containment, and the r185 scaffold."
    )
    parser.add_argument("skill", nargs="?", default=".", help="Skill package root.")
    args = parser.parse_args()

    root = Path(args.skill).resolve()
    if not root.is_dir():
        print(f"Skill directory not found: {root}", file=sys.stderr)
        return 2

    findings = audit(root)
    if findings:
        print("Skill structure audit failed:")
        for item in findings:
            print(f"- {item.path}:{item.line}: {item.reason}: {item.excerpt}")
        return 1

    print(
        "Skill structure audit passed: one coordinator owns every bundled reference; "
        "relative Markdown links resolve; no operational cross-skill references remain; "
        "and the scaffold uses the declared r185 baseline, Timer, and animation loop contracts."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
