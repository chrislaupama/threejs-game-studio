#!/usr/bin/env node
/**
 * Audit a browser game for unapproved runtime network and package dependencies.
 *
 * This is conservative static evidence, not proof. Pair it with the bundled
 * live browser request blocker and a production-preview run.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_SUFFIXES = new Set([
  '.css',
  '.frag',
  '.glsl',
  '.gltf',
  '.htm',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.mts',
  '.cts',
  '.cjs',
  '.svg',
  '.ts',
  '.tsx',
  '.vert',
  '.webmanifest',
  '.xml',
]);

const RUNTIME_DIRS = [
  'api',
  'app',
  'client',
  'dist',
  'functions',
  'public',
  'server',
  'src',
  'workers',
] as const;

const SKIP_DIRS = new Set([
  '.git',
  '.vite',
  'coverage',
  'node_modules',
  'playwright-report',
  'test-results',
  'tests',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);

type NamedPattern = readonly [reason: string, pattern: RegExp];

const NETWORK_PATTERNS: readonly NamedPattern[] = [
  ['remote URL', /(?:https?|wss?):\/\//gi],
  [
    'protocol-relative URL',
    /(?<!:)\/\/[^\/?#\s'"`()<>]+@(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d+)?(?=[\/?#'"\)\s;,]|$)/gi,
  ],
  [
    'protocol-relative URL',
    /(?<!:)\/\/(?:(?:[a-z0-9-]+)(?::\d+)?(?=\/)|(?:localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])(?::\d+)?(?=[\/?#'"\)\s;,]|$))/gi,
  ],
  [
    'fetch call',
    /(?:\bfetch|\[\s*['"]fetch['"]\s*\])\s*(?:\?\.)?\s*\(/gi,
  ],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\s*\(/g],
  ['EventSource', /\bEventSource\s*\(/g],
  [
    'sendBeacon',
    /(?:\bsendBeacon|\[\s*['"]sendBeacon['"]\s*\])\s*(?:\?\.)?\s*\(/gi,
  ],
  ['importScripts', /\bimportScripts\s*\(/g],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/g],
  ['WebTransport', /\bWebTransport\s*\(/g],
  ['axios', /(?:\baxios\b|from\s*['"]axios['"])/g],
  [
    'credential environment lookup',
    /(?:import\.meta\.env|process\.env)[^\n;]*(?:key|token|secret|credential)/gi,
  ],
  ['MCP runtime reference', /\bmcp(?:server|client|tool|resource)?\b/gi],
];

const IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/gm;

const DECLARATIVE_NAMESPACE_URIS = [
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/2000/xmlns/',
] as const;

// The lookahead validates the complete host/optional-port boundary before the
// match is redacted. This prevents `localhost.evil`, `localhost:5173.evil`, and
// similar suffix attacks from being treated as loopback URLs.
const LOCAL_URL_PATTERN =
  /(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?=(?::\d+)?(?:$|[\/?#\s'"`),;&|]))(?::\d+)?/gi;
const LOCAL_PROTOCOL_RELATIVE_URL_PATTERN =
  /(?<!:)\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=(?::\d+)?(?:$|[\/?#\s'"`),;&|]))(?::\d+)?/gi;

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'os',
  'path',
  'perf_hooks',
  'process',
  'stream',
  'url',
  'util',
  'worker_threads',
]);

const JAVASCRIPT_SUFFIXES = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.ts',
  '.tsx',
]);

const HELP = `usage: audit-local-only.ts [-h] [--baseline-package-json PATH] [project]

Reject remote runtime URLs, network APIs, credential lookups, and new
browser-runtime packages. Static evidence only; also run live request QA.

positional arguments:
  project                       Project root to audit. Defaults to the current directory.

options:
  -h, --help                    Show this help message and exit.
  --baseline-package-json PATH  Discovery-time package.json from outside the working tree.
                                Only dependency names recorded there are grandfathered.
`;

export interface Finding {
  path: string;
  line: number;
  reason: string;
  excerpt: string;
}

interface CliOptions {
  project: string;
  projectProvided: boolean;
  baselinePackageJson?: string;
  help: boolean;
}

interface PackageData {
  [key: string]: unknown;
}

type PackageReadResult =
  | { data: PackageData; error: null }
  | { data: null; error: string };

class UsageError extends Error {}

function parseArguments(argv: readonly string[]): CliOptions {
  let project: string | undefined;
  let baselinePackageJson: string | undefined;
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '-h' || value === '--help') {
      return {
        project: project ?? '.',
        projectProvided: project !== undefined,
        baselinePackageJson,
        help: true,
      };
    }
    if (!positionalOnly && value === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && value === '--baseline-package-json') {
      const path = argv[index + 1];
      if (path === undefined) {
        throw new UsageError('argument --baseline-package-json: expected one argument');
      }
      baselinePackageJson = path;
      index += 1;
      continue;
    }
    if (!positionalOnly && value.startsWith('--baseline-package-json=')) {
      const path = value.slice('--baseline-package-json='.length);
      if (!path) {
        throw new UsageError('argument --baseline-package-json: expected one argument');
      }
      baselinePackageJson = path;
      continue;
    }
    if (!positionalOnly && value.startsWith('-')) {
      throw new UsageError(`unrecognized argument: ${value}`);
    }
    if (project !== undefined) {
      throw new UsageError(`unrecognized argument: ${value}`);
    }
    project = value;
  }

  return {
    project: project ?? '.',
    projectProvided: project !== undefined,
    baselinePackageJson,
    help: false,
  };
}

function lineForOffset(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function lineExcerpt(text: string, offset: number): string {
  const previousNewline = text.lastIndexOf('\n', offset - 1);
  const start = previousNewline + 1;
  const followingNewline = text.indexOf('\n', offset);
  const end = followingNewline < 0 ? text.length : followingNewline;
  return text.slice(start, end).trim().slice(0, 180);
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/', 1)[0] ?? specifier;
}

function isConfigFile(path: string, root: string): boolean {
  if (dirname(path) !== root) return false;
  const name = basename(path).toLowerCase();
  return name.includes('.config.') ||
    name.startsWith('vite.') ||
    name.startsWith('webpack.') ||
    name.startsWith('rollup.');
}

function isAllowedImport(
  specifier: string,
  runtimeAllowed: ReadonlySet<string>,
  toolingAllowed: ReadonlySet<string>,
  configFile: boolean,
): boolean {
  if (['.', '/', '#', '@/', '~/'].some((prefix) => specifier.startsWith(prefix))) {
    return true;
  }
  if (
    configFile &&
    (
      specifier.startsWith('node:') ||
      NODE_BUILTINS.has(specifier) ||
      toolingAllowed.has(packageName(specifier))
    )
  ) {
    return true;
  }
  return runtimeAllowed.has(packageName(specifier));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(base: string, output: Set<string>): void {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path = resolve(base, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(path, output);
      continue;
    }
    if (entry.isFile()) {
      output.add(path);
      continue;
    }
    try {
      if (statSync(path).isFile()) output.add(path);
    } catch {
      // Match pathlib's best-effort file discovery for broken/inaccessible links.
    }
  }
}

function runtimeFiles(root: string): string[] {
  const candidates = new Set<string>();
  for (const directory of RUNTIME_DIRS) {
    const base = resolve(root, directory);
    if (isDirectory(base)) walkFiles(base, candidates);
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    let file = entry.isFile();
    if (!file && !entry.isDirectory()) {
      try {
        file = statSync(path).isFile();
      } catch {
        file = false;
      }
    }
    if (file && !SKIP_FILES.has(entry.name)) {
      candidates.add(path);
    }
  }

  return [...candidates]
    .filter((path) => {
      const relativeParts = relative(root, path).split(sep);
      const name = basename(path);
      return RUNTIME_SUFFIXES.has(extname(path).toLowerCase()) &&
        !SKIP_FILES.has(name) &&
        !relativeParts.some((part) => SKIP_DIRS.has(part)) &&
        !name.endsWith('.map') &&
        name !== 'package.json';
    })
    .sort();
}

function isRecord(value: unknown): value is PackageData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPackage(path: string): PackageReadResult {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(data)) return { data: null, error: 'root value must be an object' };
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function dependencyVersions(
  data: PackageData | null,
  field: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const values = data?.[field];
  if (!isRecord(values)) return result;
  for (const [name, version] of Object.entries(values)) {
    if (typeof version === 'string') result.set(name, version);
  }
  return result;
}

function firstMatch(pattern: RegExp, text: string): RegExpExecArray | null {
  const flags = pattern.flags.replaceAll('g', '');
  return new RegExp(pattern.source, flags).exec(text);
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function redactAllowedUris(text: string): string {
  let result = text;
  for (const uri of DECLARATIVE_NAMESPACE_URIS) {
    result = result.replaceAll(uri, ' '.repeat(uri.length));
  }
  result = result.replace(
    LOCAL_URL_PATTERN,
    (value) => ' '.repeat(value.length),
  );
  result = result.replace(
    LOCAL_PROTOCOL_RELATIVE_URL_PATTERN,
    (value) => ' '.repeat(value.length),
  );
  return result;
}

/** Replace JS/TS comments with spaces while preserving strings and offsets. */
function stripJavaScriptComments(text: string): string {
  const characters = text.split('');
  let index = 0;
  let state: 'code' | 'string' = 'code';
  let quote = '';

  while (index < characters.length) {
    const character = characters[index] ?? '';
    const nextCharacter = characters[index + 1] ?? '';
    if (state === 'code') {
      if (character === "'" || character === '"' || character === '`') {
        state = 'string';
        quote = character;
      } else if (character === '/' && nextCharacter === '/') {
        characters[index] = ' ';
        characters[index + 1] = ' ';
        index += 2;
        while (
          index < characters.length &&
          characters[index] !== '\n' &&
          characters[index] !== '\r'
        ) {
          characters[index] = ' ';
          index += 1;
        }
        continue;
      } else if (character === '/' && nextCharacter === '*') {
        characters[index] = ' ';
        characters[index + 1] = ' ';
        index += 2;
        while (index < characters.length - 1) {
          if (characters[index] === '*' && characters[index + 1] === '/') {
            characters[index] = ' ';
            characters[index + 1] = ' ';
            index += 2;
            break;
          }
          if (characters[index] !== '\n' && characters[index] !== '\r') {
            characters[index] = ' ';
          }
          index += 1;
        }
        continue;
      }
    } else {
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === quote) {
        state = 'code';
        quote = '';
      }
    }
    index += 1;
  }
  return characters.join('');
}

/** Redact URL-only source comments that may live inside bundled shader strings. */
function redactProvenanceCommentUrls(text: string): string {
  return text.replace(
    /\/\/\s+https?:\/\/[^\r\n]*/gm,
    (value) => ' '.repeat(value.length),
  );
}

function auditPackageJson(
  root: string,
  runtimeAllowed: ReadonlySet<string>,
  baselineVersions: ReadonlyMap<string, string>,
): { findings: Finding[]; devDependencies: Set<string> } {
  const path = resolve(root, 'package.json');
  if (!existsSync(path)) return { findings: [], devDependencies: new Set() };

  const packageResult = readPackage(path);
  if (packageResult.error || packageResult.data === null) {
    return {
      findings: [{
        path,
        line: 1,
        reason: 'invalid package.json',
        excerpt: packageResult.error ?? 'unknown error',
      }],
      devDependencies: new Set(),
    };
  }

  const findings: Finding[] = [];
  const dependencies = dependencyVersions(packageResult.data, 'dependencies');
  const devDependencies = new Set(
    dependencyVersions(packageResult.data, 'devDependencies').keys(),
  );
  for (const [name, version] of dependencies) {
    if (!runtimeAllowed.has(name)) {
      findings.push({
        path,
        line: 1,
        reason: 'new/unapproved runtime package',
        excerpt: `${name}: ${version}`,
      });
    }
    const historicalExact = baselineVersions.get(name) === version;
    if (/(?:https?:\/\/|git(?:\+|:\/\/)|github:|file:|\.\.\/)/i.test(version) && !historicalExact) {
      findings.push({
        path,
        line: 1,
        reason: 'new URL/git/path runtime dependency',
        excerpt: `${name}: ${version}`,
      });
    }
  }

  const scripts = packageResult.data.scripts;
  if (isRecord(scripts)) {
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') continue;
      const scan = redactAllowedUris(command);
      for (const [reason, pattern] of NETWORK_PATTERNS) {
        if (firstMatch(pattern, scan)) {
          findings.push({
            path,
            line: 1,
            reason: `package script ${reason}`,
            excerpt: `${name}: ${command}`.slice(0, 180),
          });
        }
      }
    }
  }
  return { findings, devDependencies };
}

function auditFile(
  path: string,
  root: string,
  runtimeAllowed: ReadonlySet<string>,
  toolingAllowed: ReadonlySet<string>,
): Finding[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return [{
      path,
      line: 1,
      reason: 'unreadable file',
      excerpt: error instanceof Error ? error.message : String(error),
    }];
  }

  const findings: Finding[] = [];
  let scanText = redactAllowedUris(text);
  const isJavaScript = JAVASCRIPT_SUFFIXES.has(extname(path).toLowerCase());
  if (isJavaScript) {
    scanText = stripJavaScriptComments(scanText);
    scanText = redactProvenanceCommentUrls(scanText);
  }

  const relativePath = relative(root, path);
  const builtOutput = relativePath.split(sep).includes('dist');
  const patterns = builtOutput
    ? NETWORK_PATTERNS.filter(([reason]) =>
      reason === 'remote URL' || reason === 'protocol-relative URL')
    : NETWORK_PATTERNS;

  for (const [reason, pattern] of patterns) {
    for (const match of allMatches(pattern, scanText)) {
      const offset = match.index ?? 0;
      findings.push({
        path: relativePath,
        line: lineForOffset(text, offset),
        reason,
        excerpt: lineExcerpt(text, offset),
      });
    }
  }

  if (isJavaScript) {
    const configFile = isConfigFile(path, root);
    for (const match of allMatches(IMPORT_PATTERN, text)) {
      const specifier = match[1];
      if (specifier !== undefined &&
        !isAllowedImport(specifier, runtimeAllowed, toolingAllowed, configFile)) {
        const offset = match.index ?? 0;
        findings.push({
          path: relativePath,
          line: lineForOffset(text, offset),
          reason: 'unapproved bare runtime import',
          excerpt: specifier,
        });
      }
    }
  }
  return findings;
}

function compareFindings(left: Finding, right: Finding): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.line !== right.line) return left.line - right.line;
  if (left.reason !== right.reason) return left.reason < right.reason ? -1 : 1;
  return 0;
}

export function auditProject(
  project: string,
  baselinePackageJson?: string,
): { findings: Finding[]; error?: string } {
  const root = resolve(project);
  if (!isDirectory(root)) {
    return { findings: [], error: `Project directory not found: ${root}` };
  }

  let baselineVersions = new Map<string, string>();
  if (baselinePackageJson !== undefined) {
    const baselinePath = resolve(baselinePackageJson);
    const baseline = readPackage(baselinePath);
    if (baseline.error || baseline.data === null) {
      return {
        findings: [],
        error: `Invalid baseline package.json: ${baselinePath}: ${baseline.error}`,
      };
    }
    baselineVersions = dependencyVersions(baseline.data, 'dependencies');
  }

  const runtimeAllowed = new Set(['three', ...baselineVersions.keys()]);
  const packageAudit = auditPackageJson(root, runtimeAllowed, baselineVersions);
  const toolingAllowed = new Set([
    ...runtimeAllowed,
    ...packageAudit.devDependencies,
  ]);
  const findings = [...packageAudit.findings];
  for (const path of runtimeFiles(root)) {
    findings.push(...auditFile(path, root, runtimeAllowed, toolingAllowed));
  }
  return { findings: findings.sort(compareFindings) };
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let options: CliOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`audit-local-only.ts: error: ${
      error instanceof Error ? error.message : String(error)
    }`);
    console.error('Use --help for usage.');
    return 2;
  }

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const projectBase = options.projectProvided ? invocationDirectory : process.cwd();
  const project = resolve(projectBase, options.project);
  const baseline = options.baselinePackageJson === undefined
    ? undefined
    : resolve(invocationDirectory, options.baselinePackageJson);
  const result = auditProject(project, baseline);
  if (result.error !== undefined) {
    console.error(result.error);
    return 2;
  }

  if (result.findings.length > 0) {
    console.log('Local-only audit failed:');
    for (const finding of result.findings) {
      console.log(
        `- ${finding.path}:${finding.line}: ${finding.reason}: ${finding.excerpt}`,
      );
    }
    return 1;
  }

  console.log(
    'Local-only audit passed: no static remote runtime URLs, network APIs, ' +
      'credential probes, MCP references, or new runtime packages found. ' +
      'Run live outbound-request QA as separate evidence.',
  );
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
