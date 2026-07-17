/** Tests for probe-three-revision.ts — r185 floor, not a frozen patch pin. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  declaredMinimumRevision,
  main,
  MIN_SUPPORTED_REVISION,
  probeThreeRevision,
} from "./probe-three-revision.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("minimum supported revision is r185", () => {
  assert.equal(MIN_SUPPORTED_REVISION, 185);
});

test("runs the probe CLI through a symlinked entry path", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-three-link-"));
  try {
    const link = join(directory, "probe-three-revision.ts");
    symlinkSync(join(HERE, "probe-three-revision.ts"), link);
    const result = spawnSync(process.execPath, ["--import", "tsx", link, "--help"], {
      encoding: "utf8",
      cwd: HERE,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /usage: probe-three-revision/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("flags package ranges below the r185 floor without treating them as installed", () => {
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
    assert.equal(result.installedRevision, null);
    assert.equal(result.belowFloor, false);
    assert.equal(result.declaredMinimumRevision, 184);
    assert.equal(result.declarationBelowFloor, true);
    assert.ok(result.messages.some((message) => /FAIL/.test(message)));
    assert.equal(main(["--no-npm", directory]), 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reads installed metadata without executing the package entry point", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-three-"));
  const marker = join(directory, "executed.txt");
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "modern-game",
        dependencies: { three: "^0.186.0" },
      }),
      "utf8",
    );
    const packageDirectory = join(directory, "node_modules", "three");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "three", version: "0.186.0", main: "index.cjs" }),
      "utf8",
    );
    writeFileSync(
      join(packageDirectory, "index.cjs"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");`,
      "utf8",
    );
    const result = probeThreeRevision(directory, { checkNpmLatest: false });
    assert.equal(result.belowFloor, false);
    assert.equal(result.declarationBelowFloor, false);
    assert.equal(result.installedRevision, 186);
    assert.equal(result.newerThanLastVerify, true);
    assert.equal(existsSync(marker), false);
    assert.equal(main(["--no-npm", directory]), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("range inspection retains the oldest explicit compatible revision", () => {
  assert.equal(declaredMinimumRevision(">=0.185.0 <0.190.0"), 185);
  assert.equal(declaredMinimumRevision("^0.186.0 || ^0.184.0"), 184);
  assert.equal(declaredMinimumRevision("<0.185.0"), 0);
  assert.equal(declaredMinimumRevision("0.184.0 - 0.190.0"), 184);
  assert.equal(declaredMinimumRevision("0.185.x"), 185);
  assert.equal(declaredMinimumRevision("*"), null);
  assert.equal(declaredMinimumRevision("latest"), null);
  assert.equal(declaredMinimumRevision("workspace:*"), null);
  assert.equal(declaredMinimumRevision(">=0.185.0-beta.1"), null);
  assert.equal(declaredMinimumRevision("^0.185.0 trailing-garbage"), null);
  assert.equal(declaredMinimumRevision(">=0.185.0 <0.185.0"), null);
  assert.equal(declaredMinimumRevision("0.190.0 - 0.185.0"), null);
});

test("rejects a prerelease installed at the stable r185 boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-three-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "prerelease-game",
        dependencies: { three: "0.185.0-beta.1" },
      }),
      "utf8",
    );
    const packageDirectory = join(directory, "node_modules", "three");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "three", version: "0.185.0-beta.1", main: "index.js" }),
      "utf8",
    );
    writeFileSync(join(packageDirectory, "index.js"), "export {};\n", "utf8");

    const result = probeThreeRevision(directory, { checkNpmLatest: false });
    assert.equal(result.installedRevision, 185);
    assert.equal(result.installedPrerelease, true);
    assert.equal(result.belowFloor, true);
    assert.equal(result.declarationUnknown, true);
    assert.ok(result.messages.some((message) => /prerelease below the stable r185 floor/.test(message)));
    assert.equal(main(["--no-npm", directory]), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fails an ambiguous declaration even with a stable installed package", () => {
  const directory = mkdtempSync(join(tmpdir(), "probe-three-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: "tagged-game", dependencies: { three: "latest" } }),
      "utf8",
    );
    const packageDirectory = join(directory, "node_modules", "three");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "three", version: "0.185.1", main: "index.js" }),
      "utf8",
    );
    writeFileSync(join(packageDirectory, "index.js"), "export {};\n", "utf8");

    const result = probeThreeRevision(directory, { checkNpmLatest: false });
    assert.equal(result.installedRevision, 185);
    assert.equal(result.installedPrerelease, false);
    assert.equal(result.declarationUnknown, true);
    assert.equal(result.declarationBelowFloor, false);
    assert.equal(main(["--no-npm", directory]), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("probe module lives beside skill scripts", () => {
  assert.ok(HERE.endsWith("scripts"));
});
