import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  parseShipCheckArgs,
  plannedShipCheckSteps,
  runShipCheck,
} from "./ship-check.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("parses ship-check arguments", () => {
  const parsed = parseShipCheckArgs([
    "./game",
    "--url",
    "http://127.0.0.1:5199",
    "--skip-canvas",
    "--premium",
  ]);
  assert.notEqual(parsed, "help");
  if (parsed === "help") return;
  assert.equal(parsed.project, "./game");
  assert.equal(parsed.url, "http://127.0.0.1:5199");
  assert.equal(parsed.skipCanvas, true);
  assert.equal(parsed.premium, true);
});

test("plans steps with canvas skip marker", () => {
  const steps = plannedShipCheckSteps({
    project: ".",
    url: "http://127.0.0.1:5188",
    skipCanvas: true,
    polished: false,
    premium: false,
    showcase: false,
  });
  assert.ok(steps.includes("inspect-threejs-canvas (skipped)"));
  assert.ok(steps.includes("probe-three-revision"));
  assert.ok(steps.includes("npm run build"));
});

test("runs steps in order and stops on failure", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "docs/game-report.md"), "# report\n", "utf8");

  const seen: string[] = [];
  const code = runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: true,
      polished: false,
      premium: false,
      showcase: false,
    },
    (_command, args) => {
      const label = args.join(" ");
      seen.push(label);
      if (label.includes("audit-project-three-apis")) return 7;
      return 0;
    },
  );
  assert.equal(code, 7);
  assert.ok(seen.some((entry) => entry.includes("probe-three-revision")));
  assert.ok(seen.some((entry) => entry.includes("audit-project-three-apis")));
  assert.equal(
    seen.some((entry) => entry.includes("audit-local-only")),
    false,
  );
});
