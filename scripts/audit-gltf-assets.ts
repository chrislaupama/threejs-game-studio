#!/usr/bin/env node
/**
 * Local-first audit for glTF/GLB and common texture assets under a project.
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
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const TEXTURE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ktx2",
  ".basis",
  ".hdr",
  ".exr",
]);

const LARGE_TEXTURE_BYTES = 2_000_000;
const LARGE_MODEL_BYTES = 8_000_000;

export type AssetFinding = {
  path: string;
  kind: "model" | "texture" | "note";
  severity: "info" | "warn";
  message: string;
};

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function walkFiles(root: string, files: string[] = []): string[] {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function siblingKtx2(path: string): boolean {
  const base = path.replace(/\.[^.]+$/, "");
  return existsSync(`${base}.ktx2`) || existsSync(`${base}.KTX2`);
}

function inspectGltfJson(path: string): string[] {
  const notes: string[] = [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      meshes?: unknown[];
      materials?: unknown[];
      images?: unknown[];
      buffers?: Array<{ uri?: string }>;
    };
    notes.push(
      `meshes=${data.meshes?.length ?? 0} materials=${data.materials?.length ?? 0} images=${data.images?.length ?? 0}`,
    );
    const external = (data.buffers ?? []).filter((buffer) => buffer.uri && !buffer.uri.startsWith("data:"));
    if (external.length > 0) {
      notes.push(`external buffers: ${external.map((buffer) => buffer.uri).join(", ")}`);
    }
  } catch {
    notes.push("gltf JSON parse failed — check encoding");
  }
  return notes;
}

export function auditGltfAssets(
  projectRootInput: string,
  roots: string[] = ["public", "assets"],
): AssetFinding[] {
  const projectRoot = resolve(projectRootInput);
  const findings: AssetFinding[] = [];

  for (const rootName of roots) {
    const root = resolve(projectRoot, rootName);
    if (!existsSync(root)) continue;
    for (const file of walkFiles(root)) {
      const ext = extname(file).toLowerCase();
      const rel = posixPath(relative(projectRoot, file));
      const size = statSync(file).size;

      if (MODEL_EXTENSIONS.has(ext)) {
        findings.push({
          path: rel,
          kind: "model",
          severity: size > LARGE_MODEL_BYTES ? "warn" : "info",
          message:
            size > LARGE_MODEL_BYTES
              ? `GLB/glTF is ${(size / 1e6).toFixed(1)}MB — consider Draco/Meshopt and LOD`
              : `model ${(size / 1024).toFixed(1)}KB`,
        });
        if (ext === ".gltf") {
          for (const note of inspectGltfJson(file)) {
            findings.push({
              path: rel,
              kind: "note",
              severity: "info",
              message: note,
            });
          }
        }
      }

      if (TEXTURE_EXTENSIONS.has(ext)) {
        const isCompressed = ext === ".ktx2" || ext === ".basis";
        if (!isCompressed && size > LARGE_TEXTURE_BYTES && !siblingKtx2(file)) {
          findings.push({
            path: rel,
            kind: "texture",
            severity: "warn",
            message: `large texture ${(size / 1e6).toFixed(1)}MB without sibling .ktx2 — confirm colorSpace and compression plan`,
          });
        } else {
          findings.push({
            path: rel,
            kind: "texture",
            severity: "info",
            message: `texture ${(size / 1024).toFixed(1)}KB${isCompressed ? " (compressed)" : ""}`,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      path: ".",
      kind: "note",
      severity: "info",
      message:
        "no glTF/GLB/texture assets found under public/ or assets/ — procedural-only is fine if intentional",
    });
  }

  return findings;
}

export function formatAssetChecklist(findings: AssetFinding[]): string[] {
  return findings.map(
    (finding) =>
      `- [${finding.severity}] ${finding.path}: ${finding.message}`,
  );
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(
      "usage: audit-gltf-assets.ts [project] [--root <dir>]...\n" +
        "  Walk public/assets (or custom roots) for models/textures and emit checklist lines.",
    );
    return 0;
  }

  const roots: string[] = [];
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--root") {
      const value = argv[++index];
      if (!value) {
        console.error("audit-gltf-assets.ts: --root requires a value");
        return 2;
      }
      roots.push(value);
      continue;
    }
    if (argument.startsWith("-")) {
      console.error(`audit-gltf-assets.ts: unrecognized arguments: ${argument}`);
      return 2;
    }
    positionals.push(argument);
  }

  const project = positionals[0] ?? ".";
  const findings = auditGltfAssets(project, roots.length > 0 ? roots : undefined);
  for (const line of formatAssetChecklist(findings)) console.log(line);
  const warns = findings.filter((finding) => finding.severity === "warn").length;
  console.log(`asset audit: ${findings.length} findings (${warns} warnings)`);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
