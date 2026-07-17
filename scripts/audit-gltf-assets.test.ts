import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";

import { auditGltfAssets, formatAssetChecklist } from "./audit-gltf-assets.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("reports missing asset roots as intentional procedural note", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const findings = auditGltfAssets(directory);
  assert.ok(findings.some((finding) => /procedural-only/.test(finding.message)));
});

test("warns on large textures without ktx2 sibling", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(resolve(publicDir, "huge.png"), Buffer.alloc(2_100_000, 1));
  writeFileSync(
    resolve(publicDir, "box.gltf"),
    JSON.stringify({
      meshes: [{}],
      materials: [{}, {}],
      images: [{}],
      buffers: [{ uri: "box.bin" }],
    }),
  );

  const findings = auditGltfAssets(directory);
  const checklist = formatAssetChecklist(findings).join("\n");
  assert.match(checklist, /huge\.png/);
  assert.match(checklist, /without sibling \.ktx2/);
  assert.match(checklist, /meshes=1 materials=2/);
  assert.match(checklist, /external buffers: box\.bin/);
});
