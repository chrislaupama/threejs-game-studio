# Checking The Installed Three.js Revision

This scaffold is verified against the **Three.js r185 patch line**, specifically
`three@0.185.1` with the separately maintained community
`@types/three@0.185.1` compile contract in the committed lockfile. Its
declared range is explicit: `>=0.185.1 <0.186.0`. That permits compatible r185
patches while deliberately excluding r186 until the migration guide, build,
browser tests, and visual baselines have been reviewed.

`THREE.REVISION` reports the release number as a string such as `"185"`; it
does not include the npm patch component. Use it for a semantic minimum check,
not as proof that a particular patch such as `0.185.1` is installed.

## Commands

```bash
npm ci
npm ls three @types/three
npm run verify:three
npm run probe:three
node -e "import('three').then(({ REVISION }) => console.log({ revision: Number(String(REVISION).trim()) }))"
```

`npm run verify:three` rejects a missing, nonnumeric, or pre-r185 runtime. It
accepts revisions above r185 so a deliberate upgrade can reach the migration
test suite; it warns that this scaffold's recipes must be re-verified. Passing
that minimum check alone is not an upgrade certification.

`npm run probe:three` compares the installed package with npm latest using a
20-second lookup timeout. If it reports npm latest as unavailable, record the
offline result and retain the verified lockfile; do not infer that no newer
stable release exists.

From the skill package (optional):

```bash
npm run probe:three -- .
npm run audit:project-apis -- .
```

## Authority order

1. Installed `three` runtime, package version, and `THREE.REVISION`
2. Version-matching official source, docs, examples, release, and migration notes
3. Installed community `@types/three` as compile-contract evidence
4. Skill recipes in `references/`

When npm latest moves ahead of recipes last verified against, re-check the
migration guide before changing the r185 dependency range or copying APIs. Keep
`three` and `@types/three` on matching revision lines, regenerate the lockfile,
then run `npm run verify`. Do not treat skill prose as frozen API law.
