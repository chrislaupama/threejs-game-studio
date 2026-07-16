#!/usr/bin/env python3
"""Audit a Three.js game evidence report for scope-appropriate completion markers."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


BASE_REQUIRED = [
    "phase ledger",
    "local content plan",
    "gameplay",
    "visual",
    "ui",
    "debug/performance",
    "qa/release",
    "controls",
    "checks not run",
    "remaining risks",
]

DESIGN_REQUIRED = [
    "game design brief",
    "core loop",
    "level/encounter plan",
    "sustained human play",
]

PREMIUM_CATEGORIES = [
    "art direction",
    "hero/player",
    "obstacles/enemies",
    "rewards/interactables",
    "world/environment",
    "materials/textures",
    "lighting/render",
    "vfx/motion",
    "ui/hud",
    "performance evidence",
]

PREMIUM_REQUIRED = [
    "measured evidence",
    "fresh-eyes review",
    "automatic failures remaining",
    "technical art",
    "render budget",
    "visual test harness",
]

PHYSICS_REQUIRED = ["collision model", "timestep", "collider"]
AUDIO_REQUIRED = ["audio", "gesture unlock", "mute", "pause/restart"]
DIFFICULTY_REQUIRED = ["two-reaction-delay bot comparison"]

PASS_PATTERNS = {
    "build must explicitly pass": re.compile(
        r"(?m)^\s*(?:[-*]\s*)?build(?:/typecheck)?(?:\s+result)?\s*[:=-]\s*"
        r"(?:pass|passed|clean)\b"
    ),
    "local-only audit must explicitly pass": re.compile(
        r"(?m)^\s*(?:[-*]\s*)?local-only audit\s*[:=-]\s*"
        r"(?:pass|passed|clean|0 findings|0 failures)\b"
    ),
}

CONTENT_SOURCE_PATTERN = re.compile(
    r"(?m)^\s*(?:[-*]\s*)?local content sources\s*[:=-]\s*([^\n]+)$"
)
ALLOWED_CONTENT_SOURCES = {"procedural", "project-local", "user-supplied", "deferred"}


def normalize(text: str) -> str:
    replacements = {
        "phase evidence": "phase ledger",
        "content strategy": "local content plan",
        "asset plan": "local content plan",
        "design brief": "game design brief",
        "playable loop": "core loop",
        "level plan": "level/encounter plan",
        "encounter plan": "level/encounter plan",
        "technical-art": "technical art",
        "fresh eyes": "fresh-eyes",
        "local only audit": "local-only audit",
        "unrun checks": "checks not run",
        "residual risks": "remaining risks",
        "debug and performance": "debug/performance",
        "qa and release": "qa/release",
        "physics engine": "collision model",
    }
    text = text.lower()
    for before, after in replacements.items():
        text = text.replace(before, after)
    return text


def missing_markers(text: str, markers: list[str]) -> list[str]:
    return [marker for marker in markers if marker not in text]


def score_for(text: str, category: str) -> float | None:
    escaped = re.escape(category)
    patterns = [
        rf"{escaped}[^\n]*?after\s*[:=]?\s*([0-3](?:\.\d+)?)",
        rf"{escaped}\s*[:=-]\s*([0-3](?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return float(match.group(1))
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check a Three.js game report for design, implementation, and QA evidence."
    )
    parser.add_argument("report", help="Markdown/text report path.")
    parser.add_argument("--premium", action="store_true", help="Enforce scorecard gates.")
    parser.add_argument("--physics", action="store_true", help="Require physics evidence.")
    parser.add_argument("--audio", action="store_true", help="Require audio evidence.")
    parser.add_argument(
        "--difficulty",
        action="store_true",
        help="Require two seeded reaction-delay bot routes for difficulty/fairness work.",
    )
    parser.add_argument(
        "--no-design",
        action="store_true",
        help="Skip design markers for a debug/performance/QA-only task.",
    )
    args = parser.parse_args()

    path = Path(args.report)
    if not path.is_file():
        print(f"Missing report file: {path}", file=sys.stderr)
        return 2

    text = normalize(path.read_text(encoding="utf-8"))
    missing = missing_markers(text, BASE_REQUIRED)
    if not args.no_design:
        missing.extend(missing_markers(text, DESIGN_REQUIRED))
    if args.physics:
        missing.extend(missing_markers(text, PHYSICS_REQUIRED))
    if args.audio:
        missing.extend(missing_markers(text, AUDIO_REQUIRED))
    if args.difficulty:
        missing.extend(missing_markers(text, DIFFICULTY_REQUIRED))

    semantic_failures = [label for label, pattern in PASS_PATTERNS.items() if not pattern.search(text)]
    source_match = CONTENT_SOURCE_PATTERN.search(text)
    if not source_match:
        semantic_failures.append(
            "local content sources must list procedural, project-local, user-supplied, and/or deferred"
        )
    else:
        source_values = {
            value.strip()
            for value in source_match.group(1).split(",")
            if value.strip()
        }
        unknown_sources = sorted(source_values - ALLOWED_CONTENT_SOURCES)
        if not source_values or unknown_sources:
            semantic_failures.append(
                "invalid local content source value(s): "
                + (", ".join(unknown_sources) if unknown_sources else "none supplied")
            )

    score_failures: list[str] = []
    if args.premium:
        missing.extend(missing_markers(text, PREMIUM_REQUIRED))
        scores: list[float] = []
        for category in PREMIUM_CATEGORIES:
            score = score_for(text, category)
            if score is None:
                score_failures.append(f"missing parseable score: {category}")
            else:
                scores.append(score)
                if score < 2:
                    score_failures.append(f"score below 2: {category}={score:g}")
                if score > 3:
                    score_failures.append(f"score above 3: {category}={score:g}")
        if len(scores) == len(PREMIUM_CATEGORIES):
            average = sum(scores) / len(scores)
            if average < 2.3:
                score_failures.append(f"scorecard average below 2.3: {average:.2f}")
        if not re.search(r"automatic failures remaining\s*[:=-]\s*(?:none|0)\b", text):
            score_failures.append("automatic failures remaining must be none or 0")

    failures = [*dict.fromkeys([*missing, *semantic_failures, *score_failures])]
    if failures:
        print("Game report audit failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Game report evidence-structure audit passed; inspect cited artifacts separately.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
