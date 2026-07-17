import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseShipCheckArgs,
  plannedShipCheckSteps,
  mobileInspectionRequired,
  resolveNpmInvocation,
  runShipCheck,
  TSX_IMPORT,
  verifyProductionBundle,
} from "./ship-check.ts";

const temporaryDirectories: string[] = [];
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "ship-check.ts");

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
    "--state",
    "boss-wave",
    "--seed=42",
    "--asset-root",
    "extras/models",
    "--asset-root=generated",
  ]);
  assert.notEqual(parsed, "help");
  if (parsed === "help") return;
  assert.equal(parsed.project, "./game");
  assert.equal(parsed.url, "http://127.0.0.1:5199");
  assert.equal(parsed.skipCanvas, true);
  assert.equal(parsed.premium, true);
  assert.equal(parsed.state, "boss-wave");
  assert.equal(parsed.seed, 42);
  assert.deepEqual(parsed.assetRoots, ["extras/models", "generated"]);
});

test("runs ship-check through a symlinked entry path", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-link-"));
  temporaryDirectories.push(directory);
  const link = resolve(directory, "ship-check.ts");
  symlinkSync(SCRIPT, link);
  const result = spawnSync(process.execPath, ["--import", "tsx", link, "--help"], {
    cwd: dirname(SCRIPT),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /usage: ship-check/);
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
  assert.ok(steps.includes("audit-gltf-assets"));
  assert.ok(steps.some((step) => step.startsWith("npm run build")));
  assert.ok(steps.includes("npm test"));
  assert.ok(steps.includes("audit-game-report"));
});

test("rejects conflicting quality tiers", () => {
  assert.throws(
    () => parseShipCheckArgs(["./game", "--premium", "--showcase"]),
    /mutually exclusive/,
  );
  assert.throws(() => parseShipCheckArgs(["--state=bad state"]), /--state must use/);
  assert.throws(() => parseShipCheckArgs(["--seed=-1"]), /--seed must be/);
  assert.throws(
    () => parseShipCheckArgs(["--asset-root=../outside"]),
    /project-relative path/,
  );
});

test("derives mobile inspection scope only from an explicit reasoned waiver", () => {
  assert.equal(mobileInspectionRequired("", false), false);
  assert.equal(mobileInspectionRequired("", true), true);
  assert.equal(mobileInspectionRequired("Desktop/mobile: desktop and mobile passed", false), true);
  assert.equal(
    mobileInspectionRequired(
      "Desktop/mobile: not applicable — desktop-only fixed museum kiosk without touch input",
      true,
    ),
    false,
  );
  assert.equal(
    mobileInspectionRequired("Desktop/mobile: not applicable — desktop-only reason", true),
    true,
  );
  assert.throws(
    () => mobileInspectionRequired("Desktop/mobile: passed\nDesktop/mobile: passed", true),
    /exactly once/,
  );
});

test("uses a portable npm invocation and a file-URL tsx import", () => {
  assert.deepEqual(
    resolveNpmInvocation("C:\\npm\\bin\\npm-cli.js", "win32", "C:\\node\\node.exe"),
    {
      command: "C:\\node\\node.exe",
      argsPrefix: ["C:\\npm\\bin\\npm-cli.js"],
    },
  );
  assert.deepEqual(resolveNpmInvocation("", "win32", "ignored"), {
    command: "npm.cmd",
    argsPrefix: [],
  });
  assert.deepEqual(resolveNpmInvocation("", "linux", "ignored"), {
    command: "npm",
    argsPrefix: [],
  });
  assert.match(TSX_IMPORT, /^file:/);
});

test("distinguishes clean release bundles from instrumented inspection bundles", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "dist/assets"), { recursive: true });
  writeFileSync(resolve(directory, "dist/index.html"), "<main>game</main>\n", "utf8");
  writeFileSync(resolve(directory, "dist/assets/game.js"), "console.log('clean');\n", "utf8");
  writeFileSync(
    resolve(directory, "dist/assets/game.js.map"),
    '{"sourcesContent":["__THREE_GAME_TEST_HOOKS__"]}\n',
    "utf8",
  );
  assert.deepEqual(verifyProductionBundle(directory, false, "dist"), []);
  assert.match(
    verifyProductionBundle(directory, true, "dist")[0]!,
    /does not contain deterministic diagnostics/,
  );

  writeFileSync(
    resolve(directory, "dist/assets/game.js"),
    "window.__THREE_GAME_TEST_HOOKS__ = {};\n",
    "utf8",
  );
  assert.deepEqual(verifyProductionBundle(directory, true, "dist"), []);
  assert.match(
    verifyProductionBundle(directory, false, "dist")[0]!,
    /clean production bundle contains diagnostic hooks/,
  );
});

test("quality tiers require an evidence report before any step runs", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  let calls = 0;
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: true,
      polished: false,
      premium: true,
      showcase: false,
    },
    () => { calls += 1; return 0; },
  );
  assert.equal(code, 2);
  assert.equal(calls, 0);
});

test("every release check requires an evidence report", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  let calls = 0;
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: false,
      polished: false,
      premium: false,
      showcase: false,
    },
    () => { calls += 1; return 0; },
  );
  assert.equal(code, 2);
  assert.equal(calls, 0);
});

test("a skipped canvas leaves ship-check incomplete instead of green", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "docs/game-report.md"), "# report\n", "utf8");
  const seen: string[] = [];
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: true,
      polished: false,
      premium: false,
      showcase: false,
      assetRoots: ["custom/models"],
    },
    (_command, args) => { seen.push(args.join(" ")); return 0; },
    () => ({ async waitUntilReady() {}, async stop() {} }),
    () => [],
  );
  assert.equal(code, 3);
  assert.ok(seen.some((entry) => entry.includes("audit-gltf-assets")));
  const assetAudits = seen.filter((entry) => entry.includes("audit-gltf-assets"));
  assert.equal(assetAudits.length, 2);
  assert.equal(assetAudits[0]!.includes("--root"), false);
  assert.match(assetAudits[1]!, /--root custom\/models/);
  assert.ok(seen.some((entry) => /(?:^|\s)test$/.test(entry)));
  assert.ok(seen.some((entry) => entry.includes(TSX_IMPORT)));
});

test("pins canvas inspection output and URL security to the audited project", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  writeFileSync(resolve(directory, "docs/game-report.md"), "# report\n", "utf8");

  const canvasCalls: Array<{ args: string[]; cwd?: string; env?: NodeJS.ProcessEnv }> = [];
  const previewOutDirs: string[] = [];
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: false,
      polished: false,
      premium: false,
      showcase: false,
    },
    (_command, args, cwd, env) => {
      if (args.some((argument) => argument.includes("inspect-threejs-canvas"))) {
        canvasCalls.push({ args, cwd, env });
      }
      return 0;
    },
    (_project, _url, outDir) => {
      previewOutDirs.push(outDir);
      return {
        async waitUntilReady() {},
        async stop() {},
      };
    },
    () => [],
  );
  assert.equal(code, 0);
  assert.equal(canvasCalls.length, 2);
  for (const call of canvasCalls) {
    assert.equal(call.cwd, directory);
    assert.equal(call.env?.INIT_CWD, directory);
    assert.equal(call.env?.THREE_GAME_PROJECT_ROOT, directory);
    assert.equal(call.args.includes("--mobile"), false);
  }
  assert.match(canvasCalls[0]!.args.join(" "), /--state active-play --seed 12345/);
  assert.equal(canvasCalls[0]!.args.includes("--clean-smoke"), false);
  assert.equal(canvasCalls[1]!.args.includes("--clean-smoke"), true);
  assert.equal(canvasCalls[1]!.args.includes("--state"), false);
  assert.equal(canvasCalls[1]!.args.includes("--seed"), false);
  assert.match(canvasCalls[1]!.args.join(" "), /desktop-clean-production/);
  assert.equal(previewOutDirs.length, 2);
  assert.match(previewOutDirs[0]!, /three-ship-check-/);
  assert.equal(existsSync(previewOutDirs[0]!), false);
  assert.equal(previewOutDirs[1], "dist");
});

test("runs deterministic desktop then mobile active evidence when mobile is in scope", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  writeFileSync(
    resolve(directory, "docs/game-report.md"),
    "Desktop/mobile: desktop and mobile browsers verified\n",
    "utf8",
  );

  const inspections: string[][] = [];
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: false,
      polished: false,
      premium: true,
      showcase: false,
      state: "combat-wave",
      seed: 9876,
    },
    (_command, args) => {
      if (args.some((argument) => argument.includes("inspect-threejs-canvas"))) {
        inspections.push(args);
      }
      return 0;
    },
    () => ({ async waitUntilReady() {}, async stop() {} }),
    () => [],
  );
  assert.equal(code, 0);
  assert.equal(inspections.length, 4);
  assert.match(inspections[0]!.join(" "), /--state combat-wave --seed 9876/);
  assert.match(inspections[1]!.join(" "), /--state combat-wave --seed 9876/);
  assert.equal(inspections[0]!.includes("--mobile"), false);
  assert.equal(inspections[1]!.includes("--mobile"), true);
  assert.equal(inspections[2]!.includes("--mobile"), false);
  assert.equal(inspections[3]!.includes("--mobile"), true);
  assert.match(inspections[0]!.join(" "), /desktop-active/);
  assert.match(inspections[1]!.join(" "), /mobile-active/);
  assert.equal(inspections[0]!.includes("--clean-smoke"), false);
  assert.equal(inspections[1]!.includes("--clean-smoke"), false);
  assert.equal(inspections[2]!.includes("--clean-smoke"), true);
  assert.equal(inspections[3]!.includes("--clean-smoke"), true);
  assert.equal(inspections[2]!.includes("--state"), false);
  assert.equal(inspections[3]!.includes("--seed"), false);
  assert.match(inspections[2]!.join(" "), /desktop-clean-production/);
  assert.match(inspections[3]!.join(" "), /mobile-clean-production/);
});

test("owns the production preview after tests and always stops it", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  writeFileSync(resolve(directory, "docs/game-report.md"), "# report\n", "utf8");

  const events: string[] = [];
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: false,
      polished: false,
      premium: false,
      showcase: false,
    },
    (_command, args) => {
      if (args.at(-1) === "test") events.push("tests");
      else if (args.some((argument) => argument.includes("inspect-threejs-canvas"))) {
        events.push("inspect");
      } else if (args.some((argument) => argument.includes("audit-game-report"))) {
        events.push("report");
      }
      return 0;
    },
    () => {
      events.push("start-preview");
      return {
        async waitUntilReady() {
          events.push("preview-ready");
        },
        async stop() {
          events.push("stop-preview");
        },
      };
    },
    () => [],
  );
  assert.equal(code, 0);
  assert.deepEqual(events, [
    "tests",
    "start-preview",
    "preview-ready",
    "inspect",
    "stop-preview",
    "start-preview",
    "preview-ready",
    "inspect",
    "stop-preview",
    "report",
  ]);

  events.length = 0;
  const failed = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: false,
      polished: false,
      premium: false,
      showcase: false,
    },
    (_command, args) =>
      args.some((argument) => argument.includes("inspect-threejs-canvas")) ? 9 : 0,
    () => ({
      async waitUntilReady() {},
      async stop() {
        events.push("stopped-after-failure");
      },
    }),
    () => [],
  );
  assert.equal(failed, 9);
  assert.deepEqual(events, ["stopped-after-failure"]);
});

test("fails release when the exact clean production canvas smoke fails", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  writeFileSync(resolve(directory, "docs/game-report.md"), "# report\n", "utf8");

  const events: string[] = [];
  const code = await runShipCheck(
    {
      project: directory,
      url: "http://127.0.0.1:5188",
      skipCanvas: false,
      polished: false,
      premium: false,
      showcase: false,
    },
    (_command, args) => {
      if (args.includes("--clean-smoke")) {
        events.push("clean-smoke-failed");
        return 9;
      }
      if (args.some((argument) => argument.includes("audit-game-report"))) {
        events.push("report");
      }
      return 0;
    },
    (_project, _url, outDir) => {
      events.push(`start:${outDir}`);
      return {
        async waitUntilReady() {},
        async stop() {
          events.push(`stop:${outDir}`);
        },
      };
    },
    () => [],
  );

  assert.equal(code, 9);
  assert.equal(events.some((event) => event.startsWith("start:dist")), true);
  assert.equal(events.includes("clean-smoke-failed"), true);
  assert.equal(events.some((event) => event.startsWith("stop:dist")), true);
  assert.equal(events.includes("report"), false);
});

test("runs steps in order and stops on failure", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ship-check-"));
  temporaryDirectories.push(directory);
  mkdirSync(resolve(directory, "docs"), { recursive: true });
  writeFileSync(resolve(directory, "package.json"), "{}\n", "utf8");
  writeFileSync(resolve(directory, "docs/game-report.md"), "# report\n", "utf8");

  const seen: string[] = [];
  const code = await runShipCheck(
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
