#!/usr/bin/env node
/** Validate the self-contained structure and r185 scaffold contract of the skill. */

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  ".git",
  ".vite",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const LEGAL_FILENAMES = new Set([
  "copying",
  "copying.md",
  "license",
  "license.md",
  "notice.md",
  "third-party-notices.md",
  "third_party_notices.md",
]);

const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(([^)\n]+)\)/;
const MARKDOWN_REFERENCE = /^[ \t]*\[[^\]\n]+\]:[ \t]*(\S[^\n]*)$/m;
const EXTERNAL_TARGET = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const FRONTMATTER_NAME = /^name:[ \t]*['"]?([A-Za-z0-9_-]+)/m;

const SKILL_URI = /\bskill:\/\/([A-Za-z0-9][A-Za-z0-9_-]*)/i;
const INSTALLED_SKILL_PATH =
  /(?:\.codex|\.agents)\/skills\/([A-Za-z0-9][A-Za-z0-9_-]*)/i;
const NAMED_SKILL_PATH =
  /([A-Za-z0-9][A-Za-z0-9_-]*)\/(?:SKILL\.md|references(?:\/|\b))/i;
const EXPLICIT_SKILL_INVOCATION =
  /\b(?:use|load|read|invoke|run|call|require|delegate(?:\s+to)?)\s+(?:the\s+)?(?:skill\s+)?\$([A-Za-z0-9][A-Za-z0-9_-]*)/i;
const NAMED_SKILL_INVOCATION =
  /\b(?:use|load|read|invoke|run|call|require|delegate(?:\s+to)?)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9_-]*)\s+skill\b/i;

const STALE_TYPESCRIPT_APIS: ReadonlyArray<readonly [string, RegExp]> = [
  ["deprecated THREE.Clock timing", /\bTHREE\.Clock\b|\bnew\s+Clock\s*\(/],
  ["manual requestAnimationFrame loop", /\b(?:window\.)?requestAnimationFrame\s*\(/],
  ["manual cancelAnimationFrame loop", /\b(?:window\.)?cancelAnimationFrame\s*\(/],
  ["removed renderer.outputEncoding", /\.outputEncoding\b/],
  ["removed color encoding constant", /\b(?:sRGBEncoding|LinearEncoding|GammaEncoding)\b/],
  ["removed renderer gamma setting", /\.(?:gammaOutput|gammaFactor)\b/],
  ["stale physical-light compatibility setting", /\.(?:physicallyCorrectLights|useLegacyLights)\b/],
  ["removed WebGL1Renderer", /\bWebGL1Renderer\b/],
  ["removed Geometry or Face3 API", /\b(?:THREE\.)?(?:Geometry|Face3)\b/],
  ["removed legacy loader or material API", /\b(?:JSONLoader|MeshFaceMaterial)\b/],
  ["removed WebGLMultipleRenderTargets", /\bWebGLMultipleRenderTargets\b/],
  ["removed ImageUtils.loadTexture", /\bImageUtils\.loadTexture\s*\(/],
  ["removed BufferGeometry.addAttribute", /\.addAttribute\s*\(/],
  ["removed Object3D.applyMatrix", /\.applyMatrix\s*\(/],
  ["removed Matrix4.getInverse", /\.getInverse\s*\(/],
  ["renamed BufferGeometryUtils.mergeBufferGeometries", /\bmergeBufferGeometries\s*\(/],
  ["deprecated RGBELoader compatibility alias", /\bRGBELoader\b/],
  ["PCFSoftShadowMap is deprecated on WebGL and forward-incompatible", /\bPCFSoftShadowMap\b/],
  ["deprecated renderer or pipeline renderAsync", /\.renderAsync\s*\(/],
  ["deprecated async renderer clear method", /\.(?:clear|clearColor|clearDepth|clearStencil)Async\s*\(/],
  ["deprecated async renderer capability or texture method", /\.(?:hasFeature|initTexture)Async\s*\(/],
  ["deprecated WebGPURenderer.waitForGPU", /\.waitForGPU\s*\(/],
  ["deprecated KTX2Loader.detectSupportAsync", /\.detectSupportAsync\s*\(/],
  ["deprecated DRACOLoader.setDecoderConfig", /\.setDecoderConfig\s*\(/],
  ["removed PointerLockControls.getObject", /\.getObject\s*\(/],
  ["deprecated WebGPU PostProcessing wrapper", /\bnew\s+(?:THREE\.)?PostProcessing\s*\(/],
  [
    "removed TSL or lighting symbol",
    /\b(?:AnamorphicNode|TiledLighting|directionToColor|colorToDirection|directionToFaceDirection|addNodeElement)\b/,
  ],
  ["deprecated PMREM async conversion method", /\.(?:fromScene|fromEquirectangular|fromCubemap)Async\s*\(/],
  ["deprecated SVGLoader.createShapes", /\bSVGLoader\.createShapes\s*\(/],
  ["removed or legacy web loader", /\b(?:USDZLoader|VTKLoader|LWOLoader|LottieLoader)\b/],
  ["removed FirstPersonControls.handleResize", /\.handleResize\s*\(/],
  ["removed SceneUtils attach or detach helper", /\bSceneUtils\.(?:attach|detach)\s*\(/],
  ["removed legacy math predicate alias", /\.(?:empty|isIntersectionBox|isIntersectionPlane|isIntersectionSphere|isIntersectionLine)\s*\(/],
  ["deprecated VOX compatibility wrapper", /\b(?:VOXMesh|VOXData3DTexture)\b/],
  ["renamed renderer color-buffer getter", /\.getColorBufferType\s*\(/],
  ["removed TSL helper alias", /\b(?:rangeFog|densityFog|storageObject|premultipliedGaussianBlur)\s*\(/],
  ["deprecated TSL constant alias", /\b(?:viewportResolution|PI2|transformedNormalView|transformedNormalWorld|transformedClearcoatNormalView)\b/],
  ["renamed Line2NodeMaterial.lineColorNode", /\.lineColorNode\b/],
  ["renamed ColorManagement conversion method", /\.(?:fromWorkingColorSpace|toWorkingColorSpace)\s*\(/],
  ["deprecated SkyMesh.isSky flag", /\bskyMesh\.isSky\b/],
];

const EXECUTABLE_FENCE_LANGUAGES = new Set([
  "cjs",
  "js",
  "javascript",
  "jsx",
  "mjs",
  "ts",
  "tsx",
  "typescript",
]);

const WEBGPU_UNSUPPORTED_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["WebGPU example mixes in ShaderMaterial", /\bShaderMaterial\b/],
  ["WebGPU example mixes in RawShaderMaterial", /\bRawShaderMaterial\b/],
  ["WebGPU example mixes in onBeforeCompile", /\.onBeforeCompile\b/],
  ["WebGPU example mixes in EffectComposer", /\bEffectComposer\b/],
];

const ROOT_ABSOLUTE_ASSET_URL =
  /(?:'|"|`)\/(?:assets|audio|decoders|env|fonts|models|textures)\//;

const RAW_STALE_EXECUTABLE_CONTENT: ReadonlyArray<readonly [string, RegExp]> = [
  ["deprecated GLSL inverseTransformDirection helper", /\binverseTransformDirection\b/],
];

export interface Finding {
  path: string;
  line: number;
  reason: string;
  excerpt: string;
}

interface SkillFileAudit {
  findings: Finding[];
  skillName: string;
}

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function relativePath(root: string, path: string): string {
  return posixPath(relative(root, path)) || ".";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function captureStart(match: RegExpExecArray, group = 1): number {
  const value = match[group] ?? "";
  return match.index + match[0].indexOf(value);
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

function isSkippedRelative(relativeName: string): boolean {
  return relativeName.split("/").some((part) => SKIP_DIRS.has(part));
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareText(left.name, right.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativeName = relativePath(root, path);
      if (isSkippedRelative(relativeName)) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else if (entry.isSymbolicLink()) {
        try {
          // Match pathlib's default: include symlinked files but do not recurse
          // into symlinked directories.
          if (statSync(path).isFile()) files.push(path);
        } catch {
          // Broken symlinks are not files and pathlib skips them too.
        }
      }
    }
  }

  visit(root);
  return files.sort((left, right) => compareText(relativePath(root, left), relativePath(root, right)));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeRead(path: string, root: string): { text?: string; findings: Finding[] } {
  try {
    return { text: readFileSync(path, "utf8"), findings: [] };
  } catch (error) {
    return {
      findings: [
        {
          path: relativePath(root, path),
          line: 1,
          reason: "unreadable file",
          excerpt: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function linesWithEndings(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function blankPreservingNewlines(value: string): string {
  const output = value.split("");
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== "\n") output[index] = " ";
  }
  return output.join("");
}

export function stripFencedMarkdown(text: string): string {
  const output: string[] = [];
  let fence: string | undefined;
  for (const line of linesWithEndings(text)) {
    const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      const markerKind = match[1]![0]!;
      if (fence === undefined) fence = markerKind;
      else if (fence === markerKind) fence = undefined;
      output.push(blankPreservingNewlines(line));
    } else {
      output.push(fence === undefined ? line : blankPreservingNewlines(line));
    }
  }
  return output.join("");
}

function executableMarkdownFences(text: string): Array<{ body: string; bodyStart: number }> {
  const fences: Array<{ body: string; bodyStart: number }> = [];
  let activeMarker: string | undefined;
  let activeLength = 0;
  let activeLanguage = "";
  let bodyStart = 0;
  let offset = 0;

  for (const line of linesWithEndings(text)) {
    if (activeMarker === undefined) {
      const match = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]+)?[^\r\n]*/.exec(line);
      if (match) {
        const marker = match[1]!;
        activeMarker = marker[0]!;
        activeLength = marker.length;
        activeLanguage = (match[2] ?? "").toLowerCase();
        bodyStart = offset + line.length;
      }
    } else {
      const escaped = activeMarker === "`" ? "`" : "~";
      const closing = new RegExp(
        `^[ \\t]{0,3}${escaped}{${activeLength},}[ \\t]*(?:\\r?\\n)?$`,
      ).test(line);
      if (closing) {
        if (EXECUTABLE_FENCE_LANGUAGES.has(activeLanguage)) {
          fences.push({ body: text.slice(bodyStart, offset), bodyStart });
        }
        activeMarker = undefined;
        activeLength = 0;
        activeLanguage = "";
      }
    }
    offset += line.length;
  }

  if (activeMarker !== undefined && EXECUTABLE_FENCE_LANGUAGES.has(activeLanguage)) {
    fences.push({ body: text.slice(bodyStart), bodyStart });
  }
  return fences;
}

function markdownTarget(rawTarget: string): string {
  const value = rawTarget.trim();
  if (value.startsWith("<")) {
    const end = value.indexOf(">", 1);
    return end >= 0 ? value.slice(1, end) : value.slice(1);
  }
  return value ? value.split(/\s+/, 1)[0]! : "";
}

function isExternalMarkdownTarget(target: string): boolean {
  return (
    target.length === 0 ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    EXTERNAL_TARGET.test(target)
  );
}

/** Resolve through existing symlinked ancestors, including for a missing final target. */
function resolvedFilesystemPath(path: string): string {
  const tail: string[] = [];
  let cursor = resolve(path);
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    tail.unshift(basename(cursor));
    cursor = parent;
  }
  const existing = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return resolve(existing, ...tail);
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function auditMarkdownLinks(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const path of walkFiles(root).filter((file) => extname(file) === ".md")) {
    const result = safeRead(path, root);
    findings.push(...result.findings);
    if (result.text === undefined) continue;
    const text = result.text;
    const searchable = stripFencedMarkdown(text);
    const matches = [
      ...allMatches(MARKDOWN_LINK, searchable),
      ...allMatches(MARKDOWN_REFERENCE, searchable),
    ].sort((left, right) => captureStart(left) - captureStart(right));

    for (const match of matches) {
      const target = markdownTarget(match[1]!);
      if (isExternalMarkdownTarget(target)) continue;
      let cleanTarget: string;
      try {
        cleanTarget = decodeURIComponent(target.split("#", 1)[0]!.split("?", 1)[0]!);
      } catch {
        cleanTarget = target.split("#", 1)[0]!.split("?", 1)[0]!;
      }
      if (!cleanTarget) continue;
      const candidate = resolvedFilesystemPath(resolve(dirname(path), cleanTarget));
      const offset = captureStart(match);
      if (!isInside(root, candidate)) {
        findings.push({
          path: relativePath(root, path),
          line: lineFor(text, offset),
          reason: "relative Markdown link escapes the skill package",
          excerpt: target.slice(0, 180),
        });
      } else if (!existsSync(candidate)) {
        findings.push({
          path: relativePath(root, path),
          line: lineFor(text, offset),
          reason: "unresolved relative Markdown link",
          excerpt: target.slice(0, 180),
        });
      }
    }
  }
  return findings;
}

function isLegalFile(path: string): boolean {
  return LEGAL_FILENAMES.has(basename(path).toLowerCase());
}

function addPatternFindings(
  findings: Finding[],
  root: string,
  path: string,
  sourceText: string,
  searchableText: string,
  baseOffset: number,
  patterns: ReadonlyArray<readonly [string, RegExp]>,
): void {
  for (const [reason, pattern] of patterns) {
    for (const match of allMatches(pattern, searchableText)) {
      const absolute = baseOffset + match.index;
      findings.push({
        path: relativePath(root, path),
        line: lineFor(sourceText, absolute),
        reason,
        excerpt: excerptFor(sourceText, absolute),
      });
    }
  }
}

function auditMarkdownTypescriptExamples(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const path of walkFiles(root).filter((file) => extname(file) === ".md")) {
    if (isLegalFile(path)) continue;
    const result = safeRead(path, root);
    findings.push(...result.findings);
    if (result.text === undefined) continue;
    const text = result.text;
    const fences = executableMarkdownFences(text).map(({ body, bodyStart }) => ({
      body,
      code: stripTypescriptCommentsAndStrings(body),
      bodyStart,
    }));
    const sectionOffsets = allMatches(/^##[ \t]+/m, text).map((match) => match.index);
    const sections = new Map<number, typeof fences>();

    for (const fence of fences) {
      let section = 0;
      for (const candidate of sectionOffsets) {
        if (candidate > fence.bodyStart) break;
        section = candidate;
      }
      const sectionFences = sections.get(section) ?? [];
      sectionFences.push(fence);
      sections.set(section, sectionFences);

      addPatternFindings(
        findings,
        root,
        path,
        text,
        fence.body,
        fence.bodyStart,
        [["root-absolute asset URL bypasses the Vite base", ROOT_ABSOLUTE_ASSET_URL]],
      );
      addPatternFindings(
        findings,
        root,
        path,
        text,
        fence.body,
        fence.bodyStart,
        RAW_STALE_EXECUTABLE_CONTENT,
      );
      addPatternFindings(
        findings,
        root,
        path,
        text,
        fence.code,
        fence.bodyStart,
        STALE_TYPESCRIPT_APIS,
      );
    }

    for (const sectionFences of sections.values()) {
      const hasWebGpu = sectionFences.some(({ code }) => /\bWebGPURenderer\b/.test(code));
      const hasWebGl = sectionFences.some(({ code }) => /\bWebGLRenderer\b/.test(code));
      const dracoExporters = new Set(["dracoExporter"]);
      for (const { code } of sectionFences) {
        for (const match of allMatches(
          /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:THREE\.)?DRACOExporter\s*\(/,
          code,
        )) {
          dracoExporters.add(match[1]!);
        }
      }

      for (const { code, bodyStart } of sectionFences) {
        for (const identifier of dracoExporters) {
          const pattern = new RegExp(`\\b${escapeRegExp(identifier)}\\.parse\\s*\\(`);
          addPatternFindings(
            findings,
            root,
            path,
            text,
            code,
            bodyStart,
            [["deprecated DRACOExporter.parse", pattern]],
          );
        }
      }

      if (hasWebGpu) {
        for (const fence of sectionFences) {
          addPatternFindings(
            findings,
            root,
            path,
            text,
            fence.code,
            fence.bodyStart,
            WEBGPU_UNSUPPORTED_PATTERNS,
          );
        }
      }
      if (hasWebGl) {
        for (const fence of sectionFences) {
          addPatternFindings(
            findings,
            root,
            path,
            text,
            fence.code,
            fence.bodyStart,
            [["WebGLRenderer example mixes in RenderPipeline", /\bRenderPipeline\b/]],
          );
        }
      }
    }
  }
  return findings;
}

function auditSkillFiles(root: string): SkillFileAudit {
  const findings: Finding[] = [];
  const skillFiles = walkFiles(root).filter((path) => basename(path) === "SKILL.md");
  if (skillFiles.length !== 1) {
    const display = skillFiles.map((path) => relativePath(root, path)).join(", ") || "none";
    findings.push({
      path: ".",
      line: 1,
      reason: "expected exactly one SKILL.md",
      excerpt: `found ${skillFiles.length}: ${display}`,
    });
  }

  const rootSkill = join(root, "SKILL.md");
  if (!isFile(rootSkill)) {
    findings.push({
      path: "SKILL.md",
      line: 1,
      reason: "root coordinator SKILL.md is missing",
      excerpt: "SKILL.md",
    });
    return { findings, skillName: basename(root) };
  }

  const result = safeRead(rootSkill, root);
  findings.push(...result.findings);
  if (result.text === undefined) return { findings, skillName: basename(root) };

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(result.text);
  if (!frontmatter) {
    findings.push({
      path: "SKILL.md",
      line: 1,
      reason: "missing or malformed skill frontmatter",
      excerpt: "expected a leading YAML block with name and description",
    });
  } else {
    const fields = new Map<string, string>();
    for (const line of (frontmatter[1] ?? "").split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
      if (!field) {
        findings.push({
          path: "SKILL.md",
          line: lineFor(result.text, frontmatter.index + frontmatter[0].indexOf(line)),
          reason: "malformed skill frontmatter field",
          excerpt: line.trim().slice(0, 180),
        });
        continue;
      }
      fields.set(field[1] ?? "", (field[2] ?? "").trim());
    }

    for (const key of [...fields.keys()].filter((key) => !["name", "description"].includes(key))) {
      findings.push({
        path: "SKILL.md",
        line: 1,
        reason: "unsupported skill frontmatter field",
        excerpt: key,
      });
    }

    const rawName = fields.get("name") ?? "";
    const name = rawName.replace(/^(['"])(.*)\1$/, "$2");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 63) {
      findings.push({
        path: "SKILL.md",
        line: 2,
        reason: "invalid skill frontmatter name",
        excerpt: rawName || "missing",
      });
    }

    const rawDescription = fields.get("description") ?? "";
    const description = rawDescription.replace(/^(['"])(.*)\1$/, "$2").trim();
    if (!description) {
      findings.push({
        path: "SKILL.md",
        line: 3,
        reason: "missing skill frontmatter description",
        excerpt: "description",
      });
    }
  }

  const nameMatch = FRONTMATTER_NAME.exec(result.text);
  const skillName = nameMatch?.[1] ?? basename(root);
  const referencesDirectory = join(root, "references");
  if (isDirectory(referencesDirectory)) {
    const references = readdirSync(referencesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(referencesDirectory, entry.name))
      .sort((left, right) => compareText(relativePath(root, left), relativePath(root, right)));
    for (const reference of references) {
      const relativeName = relativePath(root, reference);
      if (!result.text.includes(relativeName)) {
        findings.push({
          path: relativeName,
          line: 1,
          reason: "reference is not directly named in root SKILL.md",
          excerpt: relativeName,
        });
      }
    }
  }
  return { findings, skillName };
}

function auditCrossSkillReferences(root: string, skillName: string): Finding[] {
  const findings: Finding[] = [];
  const normalizedName = skillName.toLowerCase();
  const patterns: ReadonlyArray<readonly [RegExp, string]> = [
    [SKILL_URI, "cross-skill URI"],
    [INSTALLED_SKILL_PATH, "cross-skill installed path"],
    [NAMED_SKILL_PATH, "cross-skill package path"],
    [EXPLICIT_SKILL_INVOCATION, "cross-skill invocation"],
    [NAMED_SKILL_INVOCATION, "cross-skill invocation"],
  ];
  const targetExtensions = new Set([".md", ".yaml", ".yml"]);

  for (const path of walkFiles(root).filter((file) => targetExtensions.has(extname(file)))) {
    if (isLegalFile(path)) continue;
    const result = safeRead(path, root);
    findings.push(...result.findings);
    if (result.text === undefined) continue;
    const occupied = new Set<string>();
    for (const [pattern, reason] of patterns) {
      for (const match of allMatches(pattern, result.text)) {
        const targetName = match[1]!.toLowerCase();
        if (targetName === normalizedName) continue;
        const key = `${match.index}\0${reason}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        findings.push({
          path: relativePath(root, path),
          line: lineFor(result.text, match.index),
          reason,
          excerpt: excerptFor(result.text, match.index),
        });
      }
    }
  }
  return findings;
}

export function stripTypescriptCommentsAndStrings(text: string): string {
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
      } else {
        index += 1;
      }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function packageLine(text: string, packageName: string): number {
  const match = new RegExp(`"${escapeRegExp(packageName)}"\\s*:`).exec(text);
  return match ? lineFor(text, match.index) : 1;
}

function jsonErrorLine(text: string, error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  const position = /(?:position|at position)\s+(\d+)/i.exec(message)?.[1];
  if (position !== undefined) return lineFor(text, Number.parseInt(position, 10));
  const line = /line\s+(\d+)/i.exec(message)?.[1];
  return line === undefined ? 1 : Number.parseInt(line, 10);
}

function auditScaffoldPackage(root: string): Finding[] {
  const relativeName = "assets/threejs-vite-game/package.json";
  const path = join(root, ...relativeName.split("/"));
  if (!isFile(path)) {
    return [{ path: relativeName, line: 1, reason: "scaffold package.json is missing", excerpt: relativeName }];
  }
  const result = safeRead(path, root);
  if (result.text === undefined) return result.findings;
  const text = result.text;
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(text);
  } catch (error) {
    return [
      ...result.findings,
      {
        path: relativeName,
        line: jsonErrorLine(text, error),
        reason: "invalid scaffold package.json",
        excerpt: "invalid JSON",
      },
    ];
  }
  if (typeof packageJson !== "object" || packageJson === null || Array.isArray(packageJson)) {
    return [
      ...result.findings,
      {
        path: relativeName,
        line: 1,
        reason: "invalid scaffold package.json",
        excerpt: "top level must be an object",
      },
    ];
  }

  const packageRecord = packageJson as Record<string, unknown>;
  const findings = [...result.findings];
  const expectations: ReadonlyArray<readonly [string, string, string]> = [
    ["dependencies", "three", "0.185.1"],
    ["devDependencies", "@types/three", "0.185.1"],
  ];
  for (const [section, packageName, expected] of expectations) {
    const values = packageRecord[section];
    const actual =
      typeof values === "object" && values !== null && !Array.isArray(values)
        ? (values as Record<string, unknown>)[packageName]
        : undefined;
    if (actual !== expected) {
      findings.push({
        path: relativeName,
        line: packageLine(text, packageName),
        reason: "incorrect Three.js scaffold baseline",
        excerpt: `${section}.${packageName}: expected '${expected}', found ${
          actual === undefined ? "None" : `'${String(actual)}'`
        }`,
      });
    }
  }

  const scripts = packageRecord.scripts;
  const scriptRecord =
    typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>)
      : {};
  const auditLocal =
    scriptRecord["audit:local"];
  if (
    typeof auditLocal !== "string" ||
    !/\b(?:tsx|node\s+--import\s+tsx)\b/.test(auditLocal) ||
    !/scripts\/audit-local-only\.ts\b/.test(auditLocal) ||
    /\bpython(?:3)?\b/i.test(auditLocal)
  ) {
    findings.push({
      path: relativeName,
      line: packageLine(text, "audit:local"),
      reason: "incorrect TypeScript scaffold audit command",
      excerpt: `scripts.audit:local must run scripts/audit-local-only.ts with tsx; found ${
        auditLocal === undefined ? "None" : `'${String(auditLocal)}'`
      }`,
    });
  }

  const localAuditScript = join(root, "assets", "threejs-vite-game", "scripts", "audit-local-only.ts");
  if (!isFile(localAuditScript)) {
    findings.push({
      path: "assets/threejs-vite-game/scripts/audit-local-only.ts",
      line: 1,
      reason: "scaffold TypeScript local-only audit is missing",
      excerpt: "assets/threejs-vite-game/scripts/audit-local-only.ts",
    });
  }

  const setupBrowsers = scriptRecord["setup:browsers"];
  if (
    typeof setupBrowsers !== "string" ||
    !/^playwright\s+install\s+chromium$/.test(setupBrowsers.trim())
  ) {
    findings.push({
      path: relativeName,
      line: packageLine(text, "setup:browsers"),
      reason: "missing scaffold browser bootstrap command",
      excerpt: `scripts.setup:browsers must install Chromium; found ${
        setupBrowsers === undefined ? "None" : `'${String(setupBrowsers)}'`
      }`,
    });
  }
  return findings;
}

function auditScaffoldTypescript(root: string): Finding[] {
  const sourceRoot = join(root, "assets", "threejs-vite-game", "src");
  const relativeRoot = "assets/threejs-vite-game/src";
  if (!isDirectory(sourceRoot)) {
    return [{ path: relativeRoot, line: 1, reason: "scaffold TypeScript source is missing", excerpt: relativeRoot }];
  }
  const sourceFiles = walkFiles(sourceRoot).filter((path) => extname(path) === ".ts");
  if (sourceFiles.length === 0) {
    return [{ path: relativeRoot, line: 1, reason: "scaffold TypeScript source is missing", excerpt: "no .ts files" }];
  }

  const findings: Finding[] = [];
  let usesTimer = false;
  let usesAnimationLoop = false;
  for (const path of sourceFiles) {
    const result = safeRead(path, root);
    findings.push(...result.findings);
    if (result.text === undefined) continue;
    const text = result.text;
    const code = stripTypescriptCommentsAndStrings(text);
    if (/\bnew\s+THREE\.Timer\s*\(/.test(code)) usesTimer = true;
    if (/\b(?:this\.)?renderer\.setAnimationLoop\s*\(/.test(code)) usesAnimationLoop = true;

    const pipelineRender = /\b(?:this\.)?pipeline\.render\s*\(/.exec(code);
    if (
      pipelineRender &&
      /\bnew\s+THREE\.RenderPipeline\s*\(/.test(code) &&
      !(
        /\b(?:this\.)?renderer\.xr\.isPresenting\b/.test(code) &&
        /\b(?:this\.)?renderer\.render\s*\(/.test(code)
      )
    ) {
      findings.push({
        path: relativePath(root, path),
        line: lineFor(text, pipelineRender.index),
        reason: "scaffold RenderPipeline must bypass post while XR is presenting",
        excerpt: excerptFor(text, pipelineRender.index),
      });
    }
    addPatternFindings(findings, root, path, text, code, 0, STALE_TYPESCRIPT_APIS);
  }

  if (!usesTimer) {
    findings.push({
      path: relativeRoot,
      line: 1,
      reason: "scaffold must use THREE.Timer",
      excerpt: "expected new THREE.Timer() in scaffold source",
    });
  }
  if (!usesAnimationLoop) {
    findings.push({
      path: relativeRoot,
      line: 1,
      reason: "scaffold must use renderer.setAnimationLoop",
      excerpt: "expected renderer.setAnimationLoop(...) in scaffold source",
    });
  }
  return findings;
}

export function audit(skillRoot: string): Finding[] {
  const root = resolvedFilesystemPath(skillRoot);
  const skillFiles = auditSkillFiles(root);
  return [
    ...skillFiles.findings,
    ...auditMarkdownLinks(root),
    ...auditMarkdownTypescriptExamples(root),
    ...auditCrossSkillReferences(root, skillFiles.skillName),
    ...auditScaffoldPackage(root),
    ...auditScaffoldTypescript(root),
  ].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      left.line - right.line ||
      compareText(left.reason, right.reason) ||
      compareText(left.excerpt, right.excerpt),
  );
}

const HELP = `usage: audit-skill-structure.ts [-h] [skill]

Validate one coordinator, local links, self-containment, and the r185 scaffold.

positional arguments:
  skill       Skill package root. (default: .)

options:
  -h, --help  show this help message and exit`;

function parseArgs(argv: string[]): string {
  const positionals: string[] = [];
  let parseOptions = true;
  for (const argument of argv) {
    if (parseOptions && argument === "--") parseOptions = false;
    else if (parseOptions && (argument === "-h" || argument === "--help")) {
      console.log(HELP);
      process.exit(0);
    } else if (parseOptions && argument.startsWith("-")) {
      console.error(`audit-skill-structure.ts: error: unrecognized arguments: ${argument}`);
      process.exit(2);
    } else positionals.push(argument);
  }
  if (positionals.length > 1) {
    console.error(
      `audit-skill-structure.ts: error: unrecognized arguments: ${positionals.slice(1).join(" ")}`,
    );
    process.exit(2);
  }
  return positionals[0] ?? ".";
}

export function main(argv = process.argv.slice(2)): number {
  const root = resolvedFilesystemPath(parseArgs(argv));
  if (!isDirectory(root)) {
    console.error(`Skill directory not found: ${root}`);
    return 2;
  }
  const findings = audit(root);
  if (findings.length > 0) {
    console.log("Skill structure audit failed:");
    for (const item of findings) {
      console.log(`- ${item.path}:${item.line}: ${item.reason}: ${item.excerpt}`);
    }
    return 1;
  }
  console.log(
    "Skill structure audit passed: one coordinator owns every bundled reference; " +
      "relative Markdown links resolve; executable examples avoid curated deprecated APIs " +
      "and incompatible renderer stacks; no operational cross-skill references remain; " +
      "and the scaffold uses TypeScript/npm tooling with the declared r185 baseline, Timer, " +
      "and animation-loop contracts.",
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
