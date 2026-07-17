#!/usr/bin/env node
/** Reject provider/API tooling and remote dependencies bundled in this skill. */

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEXT_SUFFIXES = new Set([
  ".css",
  ".frag",
  ".gltf",
  ".glsl",
  ".html",
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".cts",
  ".py",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".txt",
  ".vert",
  ".yaml",
  ".yml",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".e2e-dist",
  ".vite",
  "artifacts",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

// These files intentionally contain detection patterns, fixtures, or legal
// attribution.
const EXEMPT_PATHS = new Set([
  "LICENSE",
  "NOTICE.md",
  "scripts/audit-skill-local-only.ts",
  "scripts/audit-skill-local-only.test.ts",
  "scripts/audit-local-only.ts",
  "scripts/audit-local-only.test.ts",
  "scripts/audit-official-links.test.ts",
  "scripts/audit-skill-structure.ts",
  "scripts/audit-skill-structure.test.ts",
  "assets/threejs-vite-game/scripts/audit-local-only.ts",
]);

const SKIP_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const FORBIDDEN_FILENAME =
  /^(?:generate[_-]image|probe[_-]asset[_-]credentials|threejs[_-]3d[_-]asset|threejs[_-]audio[_-]asset)\.(?:py|sh|cjs|cts|js|jsx|mjs|mts|ts|tsx)$/i;

const CONTENT_PATTERNS = new Map<string, RegExp>([
  [
    "provider credential",
    /\b(?:TRIPO|GEMINI|GOOGLE|ELEVENLABS)_API_KEY\b/gi,
  ],
  [
    "provider API/SDK",
    /(?:api\.tripo3d\.ai|api\.elevenlabs\.io|google-genai|gemini-[a-z0-9.-]+|xi-api-key|Authorization\s*:\s*Bearer)/gi,
  ],
  [
    "provider helper reference",
    /\b(?:probe[_-]asset[_-]credentials|threejs[_-]3d[_-]asset|generate[_-]image(?:\.(?:py|cjs|cts|js|jsx|mjs|mts|ts|tsx))?|threejs[_-]audio[_-]asset)\b/gi,
  ],
  [
    "MCP invocation syntax",
    /\b(?:mcp__[a-z0-9_]+|(?:list|read)_mcp_(?:resources?|resource_templates))\b/gi,
  ],
]);

const REMOTE_URL = /(?:https?|wss?):\/\/[^\s'"`)<>]+/gi;
const PROTOCOL_RELATIVE_USERINFO_URL =
  /(?<!:)\/\/[^\/?#\s'"`()<>]+@(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d+)?(?=[\/?#'"\)\s;,]|$)/gi;
const PROTOCOL_RELATIVE_URL =
  /(?<!:)\/\/(?:(?:[a-z0-9-]+)(?::\d+)?(?=\/)|(?:localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(?::\d+)?(?=[\/?#'"\)\s;,]|$))/gi;
const ALLOWED_LOCAL_URL =
  /^(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:\/|$)/i;
const ALLOWED_NAMESPACE_URLS = new Set([
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/2000/xmlns/",
]);
const NETWORK_CLIENT =
  /^\s*(?:(?:from|import)\s+(?:requests|httpx|aiohttp|urllib\.request)\b|(?:curl|wget)\s+)/gim;
const JAVASCRIPT_NETWORK_CLIENT = new RegExp(
  [
    String.raw`^\s*(?:import\b[^\n]*?\bfrom\s*|import\s*\(\s*|import\s*|(?:const|let|var)\b[^\n=]*=\s*require\s*\(\s*)['"](?:node:)?(?:dgram|dns(?:/promises)?|http|http2|https|net|tls|undici|node-fetch|axios|got|superagent|ws)['"]`,
    String.raw`\b(?:import|require)\s*\(\s*['"](?:node:)?(?:dgram|dns(?:/promises)?|http|http2|https|net|tls|undici|node-fetch|axios|got|superagent|ws)['"]`,
    String.raw`\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource|WebTransport|RTCPeerConnection)\b`,
  ].join("|"),
  "gim",
);
// Built bundles legitimately contain local asset-loading helpers (notably
// Three.js FileLoader and Vite's module-preload shim), so a blanket `fetch(`
// match would make checked-in production builds impossible to audit. Still
// scan bundles for network-capable imports and persistent/realtime clients;
// literal remote fetch targets are caught by the URL scan below.
const BUNDLED_JAVASCRIPT_NETWORK_CLIENT = new RegExp(
  [
    String.raw`^\s*(?:import\b[^\n]*?\bfrom\s*|import\s*\(\s*|import\s*|(?:const|let|var)\b[^\n=]*=\s*require\s*\(\s*)['"](?:node:)?(?:dgram|dns(?:/promises)?|http|http2|https|net|tls|undici|node-fetch|axios|got|superagent|ws)['"]`,
    String.raw`\b(?:import|require)\s*\(\s*['"](?:node:)?(?:dgram|dns(?:/promises)?|http|http2|https|net|tls|undici|node-fetch|axios|got|superagent|ws)['"]`,
    String.raw`\bnew\s+(?:WebSocket|EventSource|WebTransport|RTCPeerConnection)\b`,
  ].join("|"),
  "gim",
);
const SOURCE_MAP_DIRECTIVE =
  /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=\s*([^\s*]+)/g;
const JAVASCRIPT_SUFFIXES = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cts",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
]);
const COMPONENT_SUFFIXES = new Set([".vue", ".svelte", ".astro"]);

const CANONICAL_REPOSITORY_URL =
  "https://github.com/chrislaupama/threejs-game-studio";

export interface Finding {
  path: string;
  line: number;
  reason: string;
  excerpt: string;
}

function toPortablePath(value: string): string {
  return value.split(sep).join("/");
}

function lineFor(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function excerptFor(text: string, offset: number): string {
  const previousNewline = text.lastIndexOf("\n", offset - 1);
  const start = previousNewline + 1;
  const followingNewline = text.indexOf("\n", offset);
  const end = followingNewline === -1 ? text.length : followingNewline;
  return text.slice(start, end).trim().slice(0, 180);
}

/** Mask JS/TS comments without changing offsets; runtime URL strings remain. */
export function stripJavaScriptComments(text: string): string {
  const output = text.split("");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.JSX,
    text,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    for (let index = scanner.getTokenPos(); index < scanner.getTextPos(); index += 1) {
      if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
    }
  }
  return output.join("");
}

interface DecodedString {
  value: string;
  offset: number;
  end: number;
}

/**
 * Parse JSON string tokens so URL checks see decoded values. This closes the
 * common `https:\/\/host` escape bypass while retaining source offsets for
 * useful diagnostics. TypeScript's JSON parser is tolerant enough to return
 * the valid string tokens surrounding an unrelated syntax error; structural
 * glTF validation belongs to audit-gltf-assets.ts.
 */
function decodedRuntimeStrings(path: string, text: string): DecodedString[] {
  const suffix = extname(path).toLowerCase();
  const source = suffix === ".json" || suffix === ".gltf"
    ? ts.parseJsonText(path, text)
    : ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  const strings: DecodedString[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      strings.push({
        value: node.text,
        offset: node.getStart(source),
        end: node.end,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return strings;
}

function maskOutsideRanges(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): string {
  const output: string[] = text.split("").map((character) =>
    character === "\n" || character === "\r" ? character : " ",
  );
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) output[index] = text[index] ?? " ";
  }
  return output.join("");
}

function executableSource(path: string, text: string): string {
  const suffix = extname(path).toLowerCase();
  if (!COMPONENT_SUFFIXES.has(suffix)) return text;
  const ranges: Array<readonly [number, number]> = [];
  if (suffix === ".astro") {
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (frontmatter?.[1] !== undefined) {
      const start = frontmatter.index + frontmatter[0].indexOf(frontmatter[1]);
      ranges.push([start, start + frontmatter[1].length]);
    }
  }
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const body = match[1] ?? "";
    const start = match.index + match[0].indexOf(body);
    ranges.push([start, start + body.length]);
  }
  return maskOutsideRanges(text, ranges);
}

function unwrapConstantExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

function constantString(
  expression: ts.Expression,
  constants: ReadonlyMap<string, string>,
): string | undefined {
  const value = unwrapConstantExpression(expression);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  if (
    ts.isBinaryExpression(value)
    && value.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantString(value.left, constants);
    const right = constantString(value.right, constants);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(value)) {
    let result = value.head.text;
    for (const span of value.templateSpans) {
      const expressionValue = constantString(span.expression, constants);
      if (expressionValue === undefined) return undefined;
      result += expressionValue + span.literal.text;
    }
    return result;
  }
  if (ts.isIdentifier(value)) return constants.get(value.text);
  return undefined;
}

function memberName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
  ) return expression.argumentExpression.text;
  return undefined;
}

function isLocalNetworkTarget(value: string): boolean {
  if (/^(?:data|blob):/i.test(value)) return true;
  if (/^(?:https?|wss?):\/\//i.test(value)) return ALLOWED_LOCAL_URL.test(value);
  if (/^\/\//.test(value)) return ALLOWED_LOCAL_URL.test(`http:${value}`);
  return !/^[a-z][a-z\d+.-]*:/i.test(value);
}

function hasValidatedLoopbackFetch(
  call: ts.CallExpression,
  target: ts.Expression,
  source: ts.SourceFile,
  text: string,
): boolean {
  if (!ts.isIdentifier(target)) return false;
  if (
    !text.includes("function localPreviewAddress")
    || !text.includes('url.protocol !== "http:"')
    || !text.includes('"127.0.0.1"')
    || !text.includes('"localhost"')
    || !text.includes('"::1"')
  ) return false;
  let current: ts.Node | undefined = call;
  while (current) {
    if (
      ts.isFunctionLike(current)
      && "body" in current
      && current.body?.getText(source).includes(
        `localPreviewAddress(${target.text})`,
      )
    ) return true;
    current = current.parent;
  }
  return false;
}

function auditJavaScriptNetworkTargets(
  sourceText: string,
  originalText: string,
  relativePath: string,
  built: boolean,
): Finding[] {
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = new Map<string, ts.Expression>();
  const constants = new Map<string, string>();
  const xhrVariables = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if ((node.parent.flags & ts.NodeFlags.Const) !== 0) {
        declarations.set(node.name.text, node.initializer);
      }
      const initializer = unwrapConstantExpression(node.initializer);
      if (
        ts.isNewExpression(initializer)
        && memberName(initializer.expression) === "XMLHttpRequest"
      ) xhrVariables.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, expression] of declarations) {
      if (constants.has(name)) continue;
      const value = constantString(expression, constants);
      if (value !== undefined) {
        constants.set(name, value);
        changed = true;
      }
    }
  }

  const findings: Finding[] = [];
  const record = (
    call: ts.CallExpression | ts.NewExpression,
    target: ts.Expression | undefined,
    sink: string,
  ): void => {
    if (!target) return;
    const value = constantString(target, constants);
    if (value !== undefined) {
      if (isLocalNetworkTarget(value)) return;
      findings.push({
        path: relativePath,
        line: lineFor(originalText, target.getStart(source)),
        reason: "non-local network target",
        excerpt: value.slice(0, 180),
      });
      return;
    }
    if (
      sink === "fetch"
      && built
      && ts.isPropertyAccessExpression(target)
      && target.name.text === "href"
      && sourceText.includes("modulepreload")
    ) return;
    if (
      sink === "fetch"
      && ts.isCallExpression(call)
      && hasValidatedLoopbackFetch(call, target, source, sourceText)
    ) return;
    if (!built || sink !== "xhr.open") {
      findings.push({
        path: relativePath,
        line: lineFor(originalText, target.getStart(source)),
        reason: "network client command/import",
        excerpt: excerptFor(originalText, target.getStart(source)),
      });
    }
  };
  const inspect = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = memberName(node.expression);
      if (name === "fetch" || name === "sendBeacon") {
        record(node, node.arguments[0], name);
      }
      if (
        name === "open"
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && xhrVariables.has(node.expression.expression.text)
      ) record(node, node.arguments[1], "xhr.open");
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return findings;
}

/**
 * Allow official Three.js research links in Markdown. README.md may also link
 * to this repository, but only with the exact canonical HTTPS URL.
 */
export function isAllowedDocumentationUrl(
  relativePath: string,
  value: string,
): boolean {
  if (relativePath === "README.md" && value === CANONICAL_REPOSITORY_URL) {
    return true;
  }

  if (extname(relativePath).toLowerCase() !== ".md") return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!new Set(["http:", "https:"]).has(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && !new Set(["80", "443"]).has(parsed.port)) return false;

  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "threejs.org" || host.endsWith(".threejs.org")) return true;
  if (host !== "github.com") return false;

  const pathParts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  return pathParts[0] === "mrdoob" && pathParts[1] === "three.js";
}

export function filesToScan(root: string): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      const relativePath = toPortablePath(relative(root, absolutePath));
      if (SKIP_DIRS.has(entry.name) || SKIP_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        if (!EXEMPT_PATHS.has(relativePath)) files.push(absolutePath);
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || EXEMPT_PATHS.has(relativePath)) continue;
      if (
        TEXT_SUFFIXES.has(extname(entry.name).toLowerCase())
        || entry.name === "package.json"
      ) {
        files.push(absolutePath);
      }
    }
  }

  visit(root);
  return files.sort((left, right) => {
    const leftRelative = toPortablePath(relative(root, left));
    const rightRelative = toPortablePath(relative(root, right));
    return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
  });
}

export function auditFile(path: string, root: string): Finding[] {
  const relativePath = toPortablePath(relative(root, path));
  const filename = relativePath.split("/").at(-1) ?? relativePath;
  const findings: Finding[] = [];

  try {
    if (lstatSync(path).isSymbolicLink()) {
      return [{
        path: relativePath,
        line: 1,
        reason: "symbolic link is not allowed",
        excerpt: "replace the link with an in-package file or directory",
      }];
    }
  } catch {
    // The normal read error below provides the actionable diagnostic.
  }

  if (FORBIDDEN_FILENAME.test(filename)) {
    findings.push({
      path: relativePath,
      line: 1,
      reason: "provider helper file",
      excerpt: filename,
    });
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return [{
      path: relativePath,
      line: 1,
      reason: "unreadable file",
      excerpt: error instanceof Error ? error.message : String(error),
    }];
  }

  const suffix = extname(path).toLowerCase();
  const javascript = JAVASCRIPT_SUFFIXES.has(suffix);
  const runtimeText = executableSource(path, text);
  const urlText = javascript ? stripJavaScriptComments(runtimeText) : runtimeText;

  for (const [reason, pattern] of CONTENT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const offset = match.index;
      findings.push({
        path: relativePath,
        line: lineFor(text, offset),
        reason,
        excerpt: excerptFor(text, offset),
      });
    }
  }

  const recordUrls = (valueText: string, sourceOffset = 0): void => {
    for (const match of valueText.matchAll(REMOTE_URL)) {
      const diagnosticOffset = sourceOffset === 0 ? match.index : sourceOffset;
      const value = match[0].replace(/[.,;]+$/, "");
      if (
        ALLOWED_NAMESPACE_URLS.has(value)
        || ALLOWED_LOCAL_URL.test(value)
        || isAllowedDocumentationUrl(relativePath, value)
      ) {
        continue;
      }
      findings.push({
        path: relativePath,
        line: lineFor(text, diagnosticOffset),
        reason: "non-local URL",
        excerpt: value.slice(0, 180),
      });
    }

    for (const match of valueText.matchAll(PROTOCOL_RELATIVE_URL)) {
      const diagnosticOffset = sourceOffset === 0 ? match.index : sourceOffset;
      const value = match[0];
      if (ALLOWED_LOCAL_URL.test(`http:${value}`)) continue;
      findings.push({
        path: relativePath,
        line: lineFor(text, diagnosticOffset),
        reason: "protocol-relative URL",
        excerpt: value.slice(0, 180),
      });
    }

    for (const match of valueText.matchAll(PROTOCOL_RELATIVE_USERINFO_URL)) {
      const diagnosticOffset = sourceOffset === 0 ? match.index : sourceOffset;
      const value = match[0];
      findings.push({
        path: relativePath,
        line: lineFor(text, diagnosticOffset),
        reason: "protocol-relative URL",
        excerpt: value.slice(0, 180),
      });
    }
  };

  recordUrls(urlText);
  if (javascript || suffix === ".json" || suffix === ".gltf") {
    for (const item of decodedRuntimeStrings(path, runtimeText)) {
      if (runtimeText.slice(item.offset, item.end).includes(item.value)) continue;
      recordUrls(item.value, item.offset);
    }
  }

  // A source-map directive is executable tooling metadata, not a research
  // citation. Inspect it before comments are masked and reject only remote
  // targets, leaving normal comments and local/data source maps alone.
  if (javascript) {
    const hasRemoteUrl = (value: string): boolean =>
      new RegExp(REMOTE_URL.source, "i").test(value);
    const hasProtocolRelativeUrl = (value: string): boolean =>
      new RegExp(
        `${PROTOCOL_RELATIVE_URL.source}|${PROTOCOL_RELATIVE_USERINFO_URL.source}`,
        "i",
      ).test(value);
    for (const match of runtimeText.matchAll(SOURCE_MAP_DIRECTIVE)) {
      const value = (match[1] ?? "").replace(/\*\/$/, "").trim();
      if (!value) continue;
      if (hasRemoteUrl(value) && !ALLOWED_LOCAL_URL.test(value)) {
        findings.push({
          path: relativePath,
          line: lineFor(text, match.index),
          reason: "non-local source map URL",
          excerpt: value.slice(0, 180),
        });
      } else if (
        hasProtocolRelativeUrl(value)
        && !ALLOWED_LOCAL_URL.test(`http:${value}`)
      ) {
        findings.push({
          path: relativePath,
          line: lineFor(text, match.index),
          reason: "non-local source map URL",
          excerpt: value.slice(0, 180),
        });
      }
    }
  }

  if (new Set([".py", ".sh"]).has(extname(path).toLowerCase())) {
    for (const match of text.matchAll(NETWORK_CLIENT)) {
      const offset = match.index;
      findings.push({
        path: relativePath,
        line: lineFor(text, offset),
        reason: "network client command/import",
        excerpt: excerptFor(text, offset),
      });
    }
  }

  const isBuiltArtifact = relativePath.split("/").includes("dist");
  if (javascript) {
    const networkPattern = isBuiltArtifact
      ? BUNDLED_JAVASCRIPT_NETWORK_CLIENT
      : JAVASCRIPT_NETWORK_CLIENT;
    for (const match of urlText.matchAll(networkPattern)) {
      const offset = match.index;
      findings.push({
        path: relativePath,
        line: lineFor(text, offset),
        reason: "network client command/import",
        excerpt: excerptFor(text, offset),
      });
    }
    findings.push(
      ...auditJavaScriptNetworkTargets(
        runtimeText,
        text,
        relativePath,
        isBuiltArtifact,
      ),
    );
  }

  return findings;
}

export function auditSkill(rootInput: string): Finding[] {
  const root = resolve(rootInput);
  return filesToScan(root).flatMap((path) => auditFile(path, root));
}

function compareFindings(left: Finding, right: Finding): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.line !== right.line) return left.line - right.line;
  return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log("Usage: audit-skill-local-only.ts [skill-package-root]");
    return 0;
  }
  if (argv.length > 1 || argv.some((argument) => argument.startsWith("-"))) {
    console.error("Usage: audit-skill-local-only.ts [skill-package-root]");
    return 2;
  }

  const root = resolve(process.env.INIT_CWD ?? process.cwd(), argv[0] ?? ".");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Skill directory not found: ${root}`);
    return 2;
  }

  const findings = auditSkill(root);
  if (findings.length > 0) {
    console.log("Skill local-only audit failed:");
    for (const item of findings.sort(compareFindings)) {
      console.log(
        `- ${item.path}:${item.line}: ${item.reason}: ${item.excerpt}`,
      );
    }
    return 1;
  }

  console.log(
    "Skill local-only audit passed: no bundled provider helpers, credentials, "
      + "MCP invocations, network clients, or unapproved remote URLs found outside "
      + "legal/fixture files, official Three.js research links in Markdown, and "
      + "the canonical repository link in README.md.",
  );
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
let invokedAsMain = invokedPath === fileURLToPath(import.meta.url);
try {
  invokedAsMain = Boolean(invokedPath)
    && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  // Keep the lexical fallback for missing/broken invocation paths.
}
if (invokedAsMain) {
  process.exitCode = main();
}
