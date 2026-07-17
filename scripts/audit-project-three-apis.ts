#!/usr/bin/env node
/**
 * Scan a game project for stale Three.js API patterns (r185+ denylist).
 * Does not require equality to any pinned skill baseline.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  ".git",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export const DENYLIST_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["deprecated THREE.Clock timing", /\bTHREE\.Clock\b|\bnew\s+Clock\s*\(/],
  ["removed renderer.outputEncoding", /\.outputEncoding\b/],
  ["removed color encoding constant", /\b(?:sRGBEncoding|LinearEncoding|GammaEncoding)\b/],
  ["deprecated RGBELoader compatibility alias", /\bRGBELoader\b/],
  ["PCFSoftShadowMap is deprecated", /\bPCFSoftShadowMap\b/],
  ["WebGPU path mixes EffectComposer", /\bEffectComposer\b/],
  ["WebGPU path mixes ShaderMaterial", /\bShaderMaterial\b/],
  ["WebGPU path mixes RawShaderMaterial", /\bRawShaderMaterial\b/],
  ["WebGPU path mixes onBeforeCompile", /\.onBeforeCompile\b/],
  ["deprecated renderer or pipeline renderAsync", /\.renderAsync\s*\(/],
  ["deprecated SVGLoader.createShapes", /\bSVGLoader\.createShapes\s*\(/],
  ["renamed mergeBufferGeometries", /\bmergeBufferGeometries\s*\(/],
];

export interface ApiFinding {
  path: string;
  line: number;
  reason: string;
  excerpt: string;
}

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function relativePath(root: string, path: string): string {
  return posixPath(relative(root, path)) || ".";
}

function lineFor(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function excerptFor(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextNewline = text.indexOf("\n", offset);
  const end = nextNewline < 0 ? text.length : nextNewline;
  return text.slice(start, end).trim().slice(0, 180);
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const matches: RegExpExecArray[] = [];
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    matches.push(match);
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return matches;
}

/** Strip comments and string literals so denylist scans ignore documentation. */
export function stripCommentsAndStrings(text: string): string {
  const output = text.split("");
  let index = 0;
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";
  let quote = "";
  while (index < text.length) {
    const character = text[index]!;
    const following = text[index + 1] ?? "";
    if (state === "code") {
      if (character === "/" && following === "/") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "line-comment";
      } else if (character === "/" && following === "*") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "block-comment";
      } else if (character === "'" || character === '"' || character === "`") {
        quote = character;
        output[index] = " ";
        index += 1;
        state = "string";
      } else index += 1;
    } else if (state === "line-comment") {
      if (character === "\n") state = "code";
      else output[index] = " ";
      index += 1;
    } else if (state === "block-comment") {
      if (character === "*" && following === "/") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "code";
      } else {
        if (character !== "\n") output[index] = " ";
        index += 1;
      }
    } else if (character === "\\" && following) {
      output[index] = " ";
      if (following !== "\n") output[index + 1] = " ";
      index += 2;
    } else if (character === quote) {
      output[index] = " ";
      index += 1;
      state = "code";
    } else {
      if (character !== "\n") output[index] = " ";
      index += 1;
    }
  }
  return output.join("");
}

function walkSourceFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(path);
      }
    }
  }
  if (existsSync(root) && statSync(root).isDirectory()) visit(root);
  return files;
}

function fileUsesWebGpu(code: string): boolean {
  return (
    /\bfrom\s+['"]three\/webgpu['"]/.test(code) ||
    /\bWebGPURenderer\b/.test(code) ||
    /\bRenderPipeline\b/.test(code)
  );
}

export function auditProjectThreeApis(projectRootInput: string): ApiFinding[] {
  const root = resolve(projectRootInput);
  const findings: ApiFinding[] = [];
  const sourceRoots = ["src", "tests", "scripts"]
    .map((name) => join(root, name))
    .filter((path) => existsSync(path));
  const roots = sourceRoots.length > 0 ? sourceRoots : [root];

  for (const sourceRoot of roots) {
    for (const path of walkSourceFiles(sourceRoot)) {
      const text = readFileSync(path, "utf8");
      const code = stripCommentsAndStrings(text);
      const webgpu = fileUsesWebGpu(code);
      for (const [reason, pattern] of DENYLIST_PATTERNS) {
        if (
          !webgpu &&
          (reason.startsWith("WebGPU path mixes") ||
            reason === "WebGPU path mixes EffectComposer")
        ) {
          // EffectComposer / ShaderMaterial are valid on WebGL-only files.
          if (
            reason.includes("EffectComposer") ||
            reason.includes("ShaderMaterial") ||
            reason.includes("RawShaderMaterial") ||
            reason.includes("onBeforeCompile")
          ) {
            continue;
          }
        }
        for (const match of allMatches(pattern, code)) {
          findings.push({
            path: relativePath(root, path),
            line: lineFor(text, match.index),
            reason,
            excerpt: excerptFor(text, match.index),
          });
        }
      }
    }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.reason.localeCompare(right.reason),
  );
}

const HELP = `usage: audit-project-three-apis.ts [-h] [project]

Scan project TypeScript/JavaScript for stale Three.js APIs (r185+ denylist).

positional arguments:
  project     Game project root (default: .)

options:
  -h, --help  show this help message and exit`;

function parseArgs(argv: string[]): string {
  const positionals: string[] = [];
  for (const argument of argv) {
    if (argument === "-h" || argument === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (argument.startsWith("-")) {
      console.error(`audit-project-three-apis.ts: error: unrecognized arguments: ${argument}`);
      process.exit(2);
    } else positionals.push(argument);
  }
  if (positionals.length > 1) {
    console.error(
      `audit-project-three-apis.ts: error: unrecognized arguments: ${positionals.slice(1).join(" ")}`,
    );
    process.exit(2);
  }
  return positionals[0] ?? ".";
}

export function main(argv = process.argv.slice(2)): number {
  const project = resolve(parseArgs(argv));
  if (!existsSync(project) || !statSync(project).isDirectory()) {
    console.error(`Project directory not found: ${project}`);
    return 2;
  }
  const findings = auditProjectThreeApis(project);
  if (findings.length > 0) {
    console.log("Project Three.js API audit failed:");
    for (const item of findings) {
      console.log(`- ${item.path}:${item.line}: ${item.reason}: ${item.excerpt}`);
    }
    return 1;
  }
  console.log(
    "Project Three.js API audit passed: no curated stale-API denylist hits in scanned sources.",
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
