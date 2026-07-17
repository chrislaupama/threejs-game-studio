#!/usr/bin/env node
/** Reject provider/API tooling and remote dependencies bundled in this skill. */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_SUFFIXES = new Set([
  ".css",
  ".frag",
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
  ".txt",
  ".vert",
  ".yaml",
  ".yml",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".vite",
  "dist",
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
    String.raw`\b(?:fetch|sendBeacon)\s*(?:\?\.)?\s*\(`,
    String.raw`\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource|WebTransport|RTCPeerConnection)\b`,
  ].join("|"),
  "gim",
);
const JAVASCRIPT_SUFFIXES = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cts",
  ".ts",
  ".tsx",
]);

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
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(absolutePath);
        continue;
      }

      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(absolutePath).isFile();
        } catch {
          isFile = false;
        }
      }
      if (!isFile) continue;

      const relativePath = toPortablePath(relative(root, absolutePath));
      if (EXEMPT_PATHS.has(relativePath) || SKIP_NAMES.has(entry.name)) continue;
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

  for (const match of text.matchAll(REMOTE_URL)) {
    const offset = match.index;
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
      line: lineFor(text, offset),
      reason: "non-local URL",
      excerpt: value.slice(0, 180),
    });
  }

  for (const match of text.matchAll(PROTOCOL_RELATIVE_URL)) {
    const offset = match.index;
    const value = match[0];
    if (ALLOWED_LOCAL_URL.test(`http:${value}`)) continue;
    findings.push({
      path: relativePath,
      line: lineFor(text, offset),
      reason: "protocol-relative URL",
      excerpt: value.slice(0, 180),
    });
  }

  for (const match of text.matchAll(PROTOCOL_RELATIVE_USERINFO_URL)) {
    const offset = match.index;
    const value = match[0];
    findings.push({
      path: relativePath,
      line: lineFor(text, offset),
      reason: "protocol-relative URL",
      excerpt: value.slice(0, 180),
    });
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

  if (JAVASCRIPT_SUFFIXES.has(extname(path).toLowerCase())) {
    for (const match of text.matchAll(JAVASCRIPT_NETWORK_CLIENT)) {
      const offset = match.index;
      findings.push({
        path: relativePath,
        line: lineFor(text, offset),
        reason: "network client command/import",
        excerpt: excerptFor(text, offset),
      });
    }
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

  const root = resolve(argv[0] ?? ".");
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
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
