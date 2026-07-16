# Three.js Game Studio

A local-first agent skill for designing, building, polishing, debugging, testing,
and releasing complete browser games with plain Three.js.

It combines provider-independent guidance adapted from
`mintdotgg/mint-threejs-skills` and `majidmanzarpour/threejs-game-skills` into
one cohesive game-development workflow.

## Local-only by design

- No MCP dependency.
- No hosted generators, provider SDKs, remote APIs, CDNs, analytics, or
  credential probes.
- Three.js and browser APIs are the runtime foundation.
- Vite, TypeScript, Playwright, and Python scripts are local development and
  verification tools.
- Assets are procedural, project-owned, or explicitly supplied as local files.

## What is included

- End-to-end game direction, scope, progression, and genre playbooks.
- Gameplay architecture, deterministic simulation, collision, camera, input,
  game feel, audio, UI, shaders, rendering, and technical art.
- Local GLB/FBX intake guidance, animation ownership, provenance, optimization,
  and disposal.
- Browser QA, bot playtesting, visual regression, performance budgets, quality
  gates, and release evidence.
- A Vite + TypeScript + Three.js starter scaffold with desktop/touch controls,
  procedural audio, diagnostics, and Playwright coverage.

The complete operating instructions are in [`SKILL.md`](SKILL.md). Supporting
guidance lives in [`references/`](references/), while reusable templates and the
starter project live in [`assets/`](assets/).

## Install as a Codex skill

Clone or copy the repository into your Codex skills directory with `SKILL.md`
at its root. From a local checkout:

```bash
cp -R /path/to/threejs-game-studio ~/.codex/skills/threejs-game-studio
```

Then start a new Codex task and ask it to build, upgrade, debug, optimize, or
release a Three.js game. The skill routes broad game requests through the full
workflow and narrow requests through only the relevant references.

## Create a starter game

```bash
python3 scripts/create_threejs_game.py ./my-game
cd ./my-game
npm install
npm run dev
```

Before releasing a generated or existing game, run the local-only audit:

```bash
python3 scripts/audit_local_only.py ./my-game
```

To validate changes to this skill package itself:

```bash
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/audit_skill_local_only.py .
```

## License and attribution

Released under the MIT License. See [`NOTICE.md`](NOTICE.md) for upstream
attribution, pinned source commits, adapted scope, and excluded provider
integrations.
