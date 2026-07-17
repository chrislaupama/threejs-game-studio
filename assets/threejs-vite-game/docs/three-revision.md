# Checking The Installed Three.js Revision

This scaffold targets **Three.js r185 and onwards** with an open dependency
range (`three` / `@types/three` at `^0.185.0`). It is not pinned to a single
patch such as `0.185.1`.

## Commands

```bash
npm ls three
node -e "import('three').then((THREE) => console.log(THREE.REVISION))"
npm view three version
```

From the skill package (optional):

```bash
npm run probe:three -- .
npm run audit:project-apis -- .
```

## Authority order

1. Installed `three` revision and types
2. Matching official docs, examples, and migration guide
3. Skill recipes in `references/`

When npm latest moves ahead of recipes last verified against, re-check the
migration guide before copying APIs. Do not treat skill prose as frozen API law.
