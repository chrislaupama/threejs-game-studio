#!/usr/bin/env python3
"""Create a Three.js Vite game from the packaged skill scaffold."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path


EXCLUDE_DIRS = {
    "node_modules",
    "dist",
    "artifacts",
    "test-results",
    "playwright-report",
    "coverage",
    "__pycache__",
}
EXCLUDE_FILES = {".DS_Store"}


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def scaffold_dir() -> Path:
    return skill_dir() / "assets" / "threejs-vite-game"


def normalized_project_name(target: Path) -> str:
    name = re.sub(r"[^a-z0-9._-]+", "-", target.resolve().name.lower()).strip("-")
    return name or "threejs-vite-game"


def ignore(_directory: str, names: list[str]) -> set[str]:
    ignored: set[str] = set()
    for name in names:
        if name in EXCLUDE_DIRS or name in EXCLUDE_FILES:
            ignored.add(name)
    return ignored


def rewrite_json_name(path: Path, name: str) -> None:
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    data["name"] = name
    if isinstance(data.get("packages"), dict) and "" in data["packages"]:
        data["packages"][""]["name"] = name
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def create_game(target: Path) -> None:
    source = scaffold_dir()
    if not source.is_dir():
        raise SystemExit(f"Scaffold not found: {source}")

    if target.exists() and any(target.iterdir()):
        raise SystemExit(
            f"Target is not empty: {target}\n"
            "Choose an empty directory so existing project files are never overlaid."
        )

    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, dirs_exist_ok=True, ignore=ignore)
    (target / "scripts").mkdir(exist_ok=True)
    shutil.copy2(skill_dir() / "scripts" / "audit_local_only.py", target / "scripts" / "audit_local_only.py")
    shutil.copy2(
        skill_dir() / "scripts" / "inspect-threejs-canvas.mjs",
        target / "scripts" / "inspect-threejs-canvas.mjs",
    )
    (target / "docs").mkdir(exist_ok=True)
    shutil.copy2(
        skill_dir() / "assets" / "content-provenance.template.md",
        target / "docs" / "content-provenance.md",
    )
    shutil.copy2(
        skill_dir() / "assets" / "game-report.template.md",
        target / "docs" / "game-report.md",
    )

    project_name = normalized_project_name(target)
    rewrite_json_name(target / "package.json", project_name)
    rewrite_json_name(target / "package-lock.json", project_name)

    print(f"Created Three.js game scaffold at {target.resolve()}")
    print(f"Next: cd {target} && npm install && npm run dev")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Create a Vite + TypeScript + Three.js browser game scaffold.")
    parser.add_argument("target", help="Target directory to create or populate.")
    args = parser.parse_args(argv)

    create_game(Path(args.target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
