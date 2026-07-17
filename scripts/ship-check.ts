#!/usr/bin/env node
/**
 * Unified release/verification pipeline for a Three.js game project.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TSX_IMPORT = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

export interface NpmInvocation {
  command: string;
  argsPrefix: string[];
}

export interface ProductionPreviewSession {
  waitUntilReady(): Promise<void>;
  stop(): Promise<void>;
}

export type StartProductionPreview = (
  project: string,
  url: string,
  outDir: string,
) => ProductionPreviewSession;

export type VerifyProductionBundle = (
  project: string,
  expectDiagnostics: boolean,
  outDir: string,
) => string[];

/**
 * npm's executable shim is `npm.cmd` on Windows. When npm launched this
 * process, prefer its exact JavaScript CLI via the current Node executable;
 * this also preserves the npm version selected by Corepack/version managers.
 */
export function resolveNpmInvocation(
  npmExecPath = process.env.npm_execpath,
  platform = process.platform,
  nodeExecutable = process.execPath,
): NpmInvocation {
  if (npmExecPath?.trim()) {
    return { command: nodeExecutable, argsPrefix: [npmExecPath] };
  }
  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    argsPrefix: [],
  };
}

export type ShipCheckOptions = {
  project: string;
  url: string;
  skipCanvas: boolean;
  polished: boolean;
  premium: boolean;
  showcase: boolean;
  state?: string;
  seed?: number;
  assetRoots?: string[];
  runStep?: (
    command: string,
    args: string[],
    cwd?: string,
    env?: NodeJS.ProcessEnv,
  ) => number;
};

export function parseShipCheckArgs(argv: string[]): ShipCheckOptions | "help" {
  const options: ShipCheckOptions = {
    project: ".",
    url: "http://127.0.0.1:5188",
    skipCanvas: false,
    polished: false,
    premium: false,
    showcase: false,
    state: "active-play",
    seed: 12345,
    assetRoots: [],
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") return "help";
    if (argument === "--skip-canvas") {
      options.skipCanvas = true;
      continue;
    }
    if (argument === "--polished") {
      options.polished = true;
      continue;
    }
    if (argument === "--premium") {
      options.premium = true;
      continue;
    }
    if (argument === "--showcase") {
      options.showcase = true;
      continue;
    }
    if (argument === "--url") {
      const value = argv[++index];
      if (!value) throw new Error("--url requires a value");
      options.url = value;
      continue;
    }
    if (argument.startsWith("--url=")) {
      options.url = argument.slice("--url=".length);
      continue;
    }
    if (argument === "--state") {
      const value = argv[++index];
      if (!value) throw new Error("--state requires a value");
      options.state = value;
      continue;
    }
    if (argument.startsWith("--state=")) {
      options.state = argument.slice("--state=".length);
      continue;
    }
    if (argument === "--seed") {
      const value = argv[++index];
      if (!value) throw new Error("--seed requires a value");
      options.seed = Number(value);
      continue;
    }
    if (argument.startsWith("--seed=")) {
      options.seed = Number(argument.slice("--seed=".length));
      continue;
    }
    if (argument === "--asset-root") {
      const value = argv[++index];
      if (!value) throw new Error("--asset-root requires a value");
      options.assetRoots!.push(value);
      continue;
    }
    if (argument.startsWith("--asset-root=")) {
      options.assetRoots!.push(argument.slice("--asset-root=".length));
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unrecognized arguments: ${argument}`);
    }
    positionals.push(argument);
  }

  if (positionals.length > 1) {
    throw new Error(`unrecognized arguments: ${positionals.slice(1).join(" ")}`);
  }
  const selectedTiers = [options.polished, options.premium, options.showcase].filter(Boolean).length;
  if (selectedTiers > 1) {
    throw new Error("--polished, --premium, and --showcase are mutually exclusive");
  }
  if (!options.state || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.state)) {
    throw new Error("--state must use 1-64 letters, digits, underscores, or hyphens");
  }
  if (!Number.isSafeInteger(options.seed) || options.seed! < 0) {
    throw new Error("--seed must be a non-negative safe integer");
  }
  for (const assetRoot of options.assetRoots ?? []) {
    if (
      !assetRoot.trim() ||
      assetRoot.includes("\0") ||
      isAbsolute(assetRoot) ||
      assetRoot.split(/[\\/]/).includes("..")
    ) {
      throw new Error(`--asset-root must be a project-relative path without '..': ${assetRoot}`);
    }
  }
  options.assetRoots = [...new Set(options.assetRoots)];
  if (positionals[0]) options.project = positionals[0];
  return options;
}

function defaultRunStep(
  command: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): number {
  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

function localPreviewAddress(value: string): { hostname: string; port: string } {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(hostname)
  ) {
    throw new Error(`preview URL must use local HTTP: ${value}`);
  }
  return { hostname, port: url.port || "80" };
}

export function mobileInspectionRequired(
  reportText: string,
  visualClaim: boolean,
): boolean {
  const values: string[] = [];
  let fence: string | undefined;
  let inHtmlComment = false;
  for (const line of reportText.split("\n")) {
    if (inHtmlComment) {
      if (line.includes("-->")) inHtmlComment = false;
      continue;
    }
    if (line.includes("<!--")) {
      if (!line.includes("-->", line.indexOf("<!--") + 4)) inHtmlComment = true;
      continue;
    }
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const kind = fenceMatch[1]![0]!;
      fence = fence === undefined ? kind : fence === kind ? undefined : fence;
      continue;
    }
    if (fence !== undefined || /^\s*>/.test(line)) continue;
    const match = /^\s*(?:[-*]\s*)?desktop\/mobile\s*[:=-]\s*(.*)$/i.exec(line);
    if (match) values.push(match[1]!.trim());
  }
  if (values.length > 1) {
    throw new Error(`Desktop/mobile must appear exactly once: found ${values.length}`);
  }
  if (values.length === 0 || !values[0]) return visualClaim;
  const waiver = /^not applicable\s*(?:—|–|-)\s*desktop-only\s+(.+)$/i.exec(values[0]);
  if (waiver && !/^(?:reason|explanation|tbd|todo)[.!]?$/i.test(waiver[1]!.trim())) {
    return false;
  }
  return true;
}

function resolveViteCli(project: string): string {
  const projectRequire = createRequire(resolve(project, "package.json"));
  const viteModule = projectRequire.resolve("vite");
  const viteCli = resolve(dirname(viteModule), "../../bin/vite.js");
  if (!existsSync(viteCli) || !statSync(viteCli).isFile()) {
    throw new Error(`could not resolve the Vite CLI from ${viteModule}`);
  }
  return viteCli;
}

/** Verify emitted runtime files, deliberately excluding source maps. */
export function verifyProductionBundle(
  project: string,
  expectDiagnostics: boolean,
  outDir: string,
): string[] {
  const root = resolve(project, outDir);
  const runtimeFiles: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:html|[cm]?js)$/i.test(entry.name)) {
        runtimeFiles.push(path);
      }
    }
  };
  try {
    visit(root);
  } catch {
    return [`runtime bundle directory is missing or unreadable: ${root}`];
  }
  if (runtimeFiles.length === 0) return [`no emitted runtime files found in ${root}`];
  const diagnosticPattern = /__THREE_GAME_(?:TEST_HOOKS|DIAGNOSTICS)__/;
  const filesWithDiagnostics = runtimeFiles.filter((path) =>
    diagnosticPattern.test(readFileSync(path, "utf8")),
  );
  if (expectDiagnostics && filesWithDiagnostics.length === 0) {
    return [`instrumented bundle does not contain deterministic diagnostics: ${root}`];
  }
  if (!expectDiagnostics && filesWithDiagnostics.length > 0) {
    return filesWithDiagnostics.map((path) =>
      `clean production bundle contains diagnostic hooks: ${path}`,
    );
  }
  return [];
}

/** Start the audited project's built Vite app without an npm/shell process tree. */
export function startProductionPreview(
  project: string,
  url: string,
  outDir: string,
): ProductionPreviewSession {
  const { hostname, port } = localPreviewAddress(url);
  const viteCli = resolveViteCli(project);

  const child: ChildProcess = spawn(
    process.execPath,
    [
      viteCli,
      "preview",
      "--host",
      hostname,
      "--port",
      port,
      "--strictPort",
      "--outDir",
      outDir,
    ],
    {
      cwd: project,
      env: {
        ...process.env,
        INIT_CWD: project,
        THREE_GAME_PROJECT_ROOT: project,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let spawnError: Error | undefined;
  let exitResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<void>((resolveExit) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("exit", (code, signal) => {
      exitResult = { code, signal };
      resolveExit();
    });
  });
  const capture = (chunk: Buffer): void => {
    const text = chunk.toString();
    output = `${output}${text}`.slice(-8_000);
    process.stdout.write(text);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  return {
    async waitUntilReady(): Promise<void> {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (exitResult) {
          throw new Error(
            `production preview exited before readiness (code=${exitResult.code}, signal=${exitResult.signal ?? "none"})\n${output}`,
          );
        }
        try {
          await fetch(url, {
            redirect: "manual",
            signal: AbortSignal.timeout(1_000),
          });
          return;
        } catch {
          await Promise.race([wait(200), exited]);
        }
      }
      throw new Error(`production preview did not become ready within 20s at ${url}\n${output}`);
    },

    async stop(): Promise<void> {
      if (exitResult) return;
      child.kill("SIGTERM");
      await Promise.race([exited, wait(3_000)]);
      if (!exitResult) {
        child.kill("SIGKILL");
        await Promise.race([exited, wait(3_000)]);
      }
      if (!exitResult) throw new Error("production preview did not terminate");
    },
  };
}

export function plannedShipCheckSteps(options: ShipCheckOptions): string[] {
  const steps = [
    "probe-three-revision",
    "audit-project-three-apis",
    "audit-gltf-assets",
    "npm run build (clean production)",
    "audit-local-only (after clean build)",
    "clean production diagnostics audit",
    "npm test",
    "npm run build (restore clean production)",
    "audit-local-only (after restore)",
  ];
  if (options.skipCanvas) steps.push("inspect-threejs-canvas (skipped)");
  else steps.push(
    "build instrumented inspection bundle (separate outDir)",
    "production-preview (owned)",
    "inspect-threejs-canvas",
    "remove instrumented inspection bundle",
    "npm run build (final clean production)",
    "final clean production preview (owned)",
    "clean production canvas smoke",
  );
  steps.push("audit-game-report");
  return steps;
}

export async function runShipCheck(
  options: ShipCheckOptions,
  runStep: NonNullable<ShipCheckOptions["runStep"]> = defaultRunStep,
  startPreview: StartProductionPreview = startProductionPreview,
  verifyBundle: VerifyProductionBundle = verifyProductionBundle,
): Promise<number> {
  const project = resolve(process.env.INIT_CWD ?? process.cwd(), options.project);
  if (!existsSync(project) || !statSync(project).isDirectory()) {
    console.error(`ship-check: project not found: ${project}`);
    return 2;
  }
  const packageJson = resolve(project, "package.json");
  if (!existsSync(packageJson) || !statSync(packageJson).isFile()) {
    console.error(`ship-check: package.json not found: ${packageJson}`);
    return 2;
  }
  const claimTier = options.showcase
    ? "showcase"
    : options.premium
      ? "premium"
      : options.polished
        ? "polished"
        : null;
  const reportPath = resolve(project, "docs/game-report.md");
  if (!existsSync(reportPath) || !statSync(reportPath).isFile()) {
    console.error(
      `ship-check: release verification requires ${reportPath}; copy and complete the bundled report template first`,
    );
    return 2;
  }
  const state = options.state ?? "active-play";
  const seed = options.seed ?? 12345;
  let inspectMobile: boolean;
  try {
    inspectMobile = mobileInspectionRequired(
      readFileSync(reportPath, "utf8"),
      claimTier !== null,
    );
  } catch (error) {
    console.error(`ship-check: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // Resolve from the script package, not the audited project's cwd. The
  // audited game is not required to install this skill's CLI loader.
  const tsx = ["--import", TSX_IMPORT];
  const npm = resolveNpmInvocation();
  const cleanBuild = (name: string): { name: string; run: () => number } => ({
    name,
    run: () => runStep(
      npm.command,
      [...npm.argsPrefix, "run", "build"],
      project,
      { VITE_ENABLE_GAME_DIAGNOSTICS: "false" },
    ),
  });
  const localAudit = (name: string): { name: string; run: () => number } => ({
    name,
    run: () =>
      runStep(process.execPath, [
        ...tsx,
        resolve(SKILL_DIR, "scripts/audit-local-only.ts"),
        project,
      ]),
  });
  const preBuildSteps: Array<{ name: string; run: () => number }> = [
    {
      name: "probe-three-revision",
      run: () =>
        runStep(process.execPath, [
          ...tsx,
          resolve(SKILL_DIR, "scripts/probe-three-revision.ts"),
          "--no-npm",
          project,
        ]),
    },
    {
      name: "audit-project-three-apis",
      run: () =>
        runStep(process.execPath, [
          ...tsx,
          resolve(SKILL_DIR, "scripts/audit-project-three-apis.ts"),
          project,
        ]),
    },
    {
      name: "audit-gltf-assets",
      run: () => {
        const baseArgs = [
          ...tsx,
          resolve(SKILL_DIR, "scripts/audit-gltf-assets.ts"),
          project,
        ];
        if (claimTier) baseArgs.push("--strict");
        const defaultCode = runStep(process.execPath, baseArgs);
        if (defaultCode !== 0) return defaultCode;
        // Extra roots are additive: the default public/assets/src/assets pass
        // above can never be displaced by a custom layout.
        for (const assetRoot of options.assetRoots ?? []) {
          const customCode = runStep(process.execPath, [
            ...baseArgs,
            "--root",
            assetRoot,
          ]);
          if (customCode !== 0) return customCode;
        }
        return 0;
      },
    },
    cleanBuild("npm run build (clean production)"),
    localAudit("audit-local-only (clean production)"),
  ];

  const reportArgs = [
    ...tsx,
    resolve(SKILL_DIR, "scripts/audit-game-report.ts"),
    reportPath,
  ];
  if (options.showcase) reportArgs.push("--showcase");
  else if (options.premium) reportArgs.push("--premium");
  else if (options.polished) reportArgs.push("--polished");
  const reportStep = {
    name: "audit-game-report",
    run: () => runStep(process.execPath, reportArgs),
  };

  console.log(`ship-check: project=${project}${claimTier ? ` claim=${claimTier}` : ""}`);
  const runNamedStep = (step: { name: string; run: () => number }): number => {
    console.log(`ship-check: ▶ ${step.name}`);
    const code = step.run();
    if (code !== 0) {
      console.error(`ship-check: ✖ ${step.name} failed with exit ${code}`);
      return code;
    }
    console.log(`ship-check: ✓ ${step.name}`);
    return 0;
  };

  const runBundleVerification = (
    name: string,
    expectDiagnostics: boolean,
    outDir: string,
  ): number => {
    console.log(`ship-check: ▶ ${name}`);
    const failures = verifyBundle(project, expectDiagnostics, outDir);
    if (failures.length > 0) {
      for (const failure of failures) console.error(`ship-check: ✖ ${failure}`);
      return 1;
    }
    console.log(`ship-check: ✓ ${name}`);
    return 0;
  };

  for (const step of preBuildSteps) {
    const code = runNamedStep(step);
    if (code !== 0) return code;
  }
  const initialCleanAudit = runBundleVerification(
    "clean production diagnostics audit",
    false,
    "dist",
  );
  if (initialCleanAudit !== 0) return initialCleanAudit;

  // Playwright deliberately builds an instrumented dist for browser tests.
  // Always restore and re-audit clean production before continuing or exiting.
  const testCode = runNamedStep({
    name: "npm test",
    run: () => runStep(npm.command, [...npm.argsPrefix, "test"], project),
  });
  const restoreCode = runNamedStep(cleanBuild("npm run build (restore clean production)"));
  let restoredAuditCode = restoreCode;
  if (restoreCode === 0) {
    restoredAuditCode = runNamedStep(localAudit("audit-local-only (restored production)"));
  }
  if (restoredAuditCode === 0) {
    restoredAuditCode = runBundleVerification(
      "restored clean production diagnostics audit",
      false,
      "dist",
    );
  }
  if (restoredAuditCode !== 0) return restoredAuditCode;
  if (testCode !== 0) return testCode;

  if (!options.skipCanvas) {
    const inspections = [
      { name: "desktop", mobile: false },
      ...(inspectMobile ? [{ name: "mobile", mobile: true }] : []),
    ];
    const instrumentedOutDir = mkdtempSync(join(tmpdir(), "three-ship-check-"));
    let preview: ProductionPreviewSession | undefined;
    let canvasFailure = 0;
    try {
      // This directory is release-tool-owned, outside the project, and removed
      // in finally so it cannot be mistaken for deployable `dist`.
      canvasFailure = runNamedStep({
        name: "build instrumented inspection bundle",
        run: () => runStep(
          npm.command,
          [
            ...npm.argsPrefix,
            "run",
            "build",
            "--",
            "--outDir",
            instrumentedOutDir,
            "--emptyOutDir",
          ],
          project,
          { VITE_ENABLE_GAME_DIAGNOSTICS: "true" },
        ),
      });
      if (canvasFailure === 0) {
        canvasFailure = runBundleVerification(
          "instrumented diagnostics audit",
          true,
          instrumentedOutDir,
        );
      }
      if (canvasFailure !== 0) return canvasFailure;
      console.log(`ship-check: ▶ production-preview (${options.url})`);
      preview = startPreview(project, options.url, instrumentedOutDir);
      await preview.waitUntilReady();
      console.log("ship-check: ✓ production-preview ready");
      for (const inspection of inspections) {
        canvasFailure = runNamedStep({
          name: `inspect-threejs-canvas (${inspection.name} active)`,
          run: () => {
            const inspectorArgs = [
              ...tsx,
              resolve(SKILL_DIR, "scripts/inspect-threejs-canvas.ts"),
              "--url",
              options.url,
              "--out",
              `artifacts/canvas-inspection/${inspection.name}-active`,
              "--state",
              state,
              "--seed",
              String(seed),
            ];
            if (inspection.mobile) inspectorArgs.push("--mobile");
            return runStep(process.execPath, inspectorArgs, project, {
              // npm preserves its caller's INIT_CWD across nested scripts.
              // Pin the inspector boundary to the audited game explicitly.
              INIT_CWD: project,
              THREE_GAME_PROJECT_ROOT: project,
            });
          },
        });
        if (canvasFailure !== 0) break;
      }
    } catch (error) {
      console.error(
        `ship-check: ✖ production-preview failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      canvasFailure = 1;
    } finally {
      if (preview) {
        try {
          await preview.stop();
          console.log("ship-check: ✓ production-preview stopped");
        } catch (error) {
          console.error(
            `ship-check: ✖ production-preview cleanup failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          if (canvasFailure === 0) canvasFailure = 1;
        }
      }
      rmSync(instrumentedOutDir, { recursive: true, force: true });
      console.log("ship-check: ✓ removed instrumented inspection bundle");
      let finalRestore = runNamedStep(
        cleanBuild("npm run build (final clean production)"),
      );
      if (finalRestore === 0) {
        finalRestore = runNamedStep(
          localAudit("audit-local-only (final clean production)"),
        );
      }
      if (finalRestore === 0) {
        finalRestore = runBundleVerification(
          "final clean production diagnostics audit",
          false,
          "dist",
        );
      }
      if (finalRestore !== 0 && canvasFailure === 0) canvasFailure = finalRestore;
    }
    if (canvasFailure !== 0) return canvasFailure;

    // The deterministic pass above uses a diagnostics-enabled temporary
    // bundle. Smoke the actual final `dist` separately so instrumentation can
    // never hide a blank or startup-broken deployable build.
    let cleanPreview: ProductionPreviewSession | undefined;
    let cleanSmokeFailure = 0;
    try {
      console.log(`ship-check: ▶ final-clean-production-preview (${options.url})`);
      cleanPreview = startPreview(project, options.url, "dist");
      await cleanPreview.waitUntilReady();
      console.log("ship-check: ✓ final-clean-production-preview ready");
      for (const inspection of inspections) {
        cleanSmokeFailure = runNamedStep({
          name: `inspect-threejs-canvas (${inspection.name} clean production)`,
          run: () => {
            const inspectorArgs = [
              ...tsx,
              resolve(SKILL_DIR, "scripts/inspect-threejs-canvas.ts"),
              "--url",
              options.url,
              "--out",
              `artifacts/canvas-inspection/${inspection.name}-clean-production`,
              "--clean-smoke",
            ];
            if (inspection.mobile) inspectorArgs.push("--mobile");
            return runStep(process.execPath, inspectorArgs, project, {
              INIT_CWD: project,
              THREE_GAME_PROJECT_ROOT: project,
            });
          },
        });
        if (cleanSmokeFailure !== 0) break;
      }
    } catch (error) {
      console.error(
        `ship-check: ✖ final-clean-production-preview failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      cleanSmokeFailure = 1;
    } finally {
      if (cleanPreview) {
        try {
          await cleanPreview.stop();
          console.log("ship-check: ✓ final-clean-production-preview stopped");
        } catch (error) {
          console.error(
            `ship-check: ✖ final-clean-production-preview cleanup failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          if (cleanSmokeFailure === 0) cleanSmokeFailure = 1;
        }
      }
    }
    if (cleanSmokeFailure !== 0) return cleanSmokeFailure;
  } else {
    console.log(
      "ship-check: skipping owned production preview and canvas inspect (--skip-canvas)",
    );
  }

  const reportCode = runNamedStep(reportStep);
  if (reportCode !== 0) return reportCode;
  if (options.skipCanvas) {
    console.error(
      "ship-check: incomplete — non-canvas checks passed, but canvas inspection was skipped",
    );
    return 3;
  }
  console.log("ship-check: all required steps passed");
  return 0;
}

const HELP = `usage: ship-check.ts <project> [--url URL] [--state NAME] [--seed N]
                     [--asset-root PATH]... [--skip-canvas]
                     [--polished|--premium|--showcase]

Run revision/API/asset audits → clean build/local bundle audit → tests → clean
build restore → separate instrumented build/owned preview → deterministic
canvas inspect → final clean build/owned preview/canvas smoke → report audit.
The instrumented outDir is removed after inspection and never replaces release
dist. --skip-canvas runs the remaining checks but exits 3
(incomplete), never a release-pass. Quality tier flags require docs/game-report.md
and must match its Claim tier. Deterministic active inspection defaults to
--state active-play --seed 12345. Asset roots are project-relative and repeatable.`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseShipCheckArgs(argv);
    if (parsed === "help") {
      console.log(HELP);
      return 0;
    }
    return runShipCheck(parsed);
  } catch (error) {
    console.error(
      `ship-check.ts: error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

const invokedAsMain = Boolean(
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)),
);
if (invokedAsMain) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
