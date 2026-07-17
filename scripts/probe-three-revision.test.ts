/** Tests for probe-three-revision.ts — r185 floor, not a frozen patch pin. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MIN_SUPPORTED_REVISION,
  probeThreeRevision,
} from "./probe-three-revision.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("minimum supported revision is r185", () => {
  assert.equal(MIN_SUPPORTED_REVISION, 185);
});

test("flags package ranges below the r185 floor via declared version", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-three-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "old-game",
        dependencies: { three: "^0.184.0" },
      }),
      "utf8",
    );
    const result = probeThreeRevision(directory, { checkNpmLatest: false });
    assert.equal(result.installedRevision, 184);
    assert.equal(result.belowFloor, true);
    assert.ok(result.messages.some((message) => /FAIL/.test(message)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts declared r185+ ranges without requiring 0.185.1 equality", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-three-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "modern-game",
        dependencies: { three: "^0.186.0" },
      }),
      "utf8",
    );
    const result = probeThreeRevision(directory, { checkNpmLatest: false });
    assert.equal(result.belowFloor, false);
    assert.equal(result.installedRevision, 186);
    assert.equal(result.newerThanLastVerify, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("probe module lives beside skill scripts", () => {
  assert.ok(HERE.endsWith("scripts"));
});
