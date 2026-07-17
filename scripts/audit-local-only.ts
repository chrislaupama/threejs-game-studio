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
  realpathSync,
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
import ts from 'typescript';

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
  '.vue',
  '.svelte',
  '.astro',
  '.vert',
  '.webmanifest',
  '.xml',
]);

const ALWAYS_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
]);

const ROOT_GENERATED_DIRS = new Set([
  '.e2e-dist',
  '.vite',
  'artifacts',
  'coverage',
  'playwright-report',
  'test-results',
]);

// These names are tooling-only at the audited project root. A game may
// legitimately ship paths such as `src/scripts/`, `src/tests/`, or
// `dist/assets/scripts/`; excluding the names at every depth creates an audit
// blind spot in deployable runtime code. In particular, an emitted directory
// containing its own package.json must not turn `dist/scripts/` into tooling.
const ROOT_TOOLING_DIRS = new Set(['scripts', 'tests']);

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
  '.vue',
  '.svelte',
  '.astro',
]);

const COMPONENT_SUFFIXES = new Set(['.vue', '.svelte', '.astro']);
const INLINE_SCRIPT_SUFFIXES = new Set(['.htm', '.html', '.svg', '.xml']);

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
  const directory = dirname(path);
  if (directory !== root && !existsSync(resolve(directory, 'package.json'))) {
    return false;
  }
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

function walkFiles(
  root: string,
  base: string,
  output: Set<string>,
  symbolicLinks: Set<string>,
): void {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const path = resolve(base, entry.name);
    if (entry.isSymbolicLink()) {
      symbolicLinks.add(path);
      continue;
    }
    const withinBuiltOutput = relative(root, base).split(sep).includes('dist');
    if (
      (!withinBuiltOutput && ALWAYS_SKIP_DIRS.has(entry.name))
      || (base === root && ROOT_GENERATED_DIRS.has(entry.name))
      || (base === root && ROOT_TOOLING_DIRS.has(entry.name))
      || SKIP_FILES.has(entry.name)
    ) continue;
    if (entry.isDirectory()) walkFiles(root, path, output, symbolicLinks);
    else if (entry.isFile()) output.add(path);
  }
}

interface RuntimeDiscovery {
  files: string[];
  symbolicLinks: string[];
}

function runtimeFiles(root: string): RuntimeDiscovery {
  const candidates = new Set<string>();
  const symbolicLinks = new Set<string>();
  walkFiles(root, root, candidates, symbolicLinks);

  const files = [...candidates]
    .filter((path) => {
      const name = basename(path);
      return RUNTIME_SUFFIXES.has(extname(path).toLowerCase()) &&
        !SKIP_FILES.has(name) &&
        !name.endsWith('.map') &&
        name !== 'package.json';
    })
    .sort();
  return {
    files,
    symbolicLinks: [...symbolicLinks].sort(),
  };
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

function maskOutsideRanges(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): string {
  const output: string[] = text.split('').map((character) =>
    character === '\n' || character === '\r' ? character : ' '
  );
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) output[index] = text[index] ?? ' ';
  }
  return output.join('');
}

/** Keep executable component scripts/frontmatter while preserving offsets. */
function executableSource(path: string, text: string): string {
  const extension = extname(path).toLowerCase();
  if (!COMPONENT_SUFFIXES.has(extension)) return text;
  const ranges: Array<readonly [number, number]> = [];
  if (extension === '.astro') {
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (frontmatter?.[1] !== undefined) {
      const start = frontmatter.index + frontmatter[0].indexOf(frontmatter[1]);
      ranges.push([start, start + frontmatter[1].length]);
    }
  }
  for (const match of text.matchAll(/<script\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const body = match[2] ?? '';
    const start = match.index + match[0].indexOf(body);
    ranges.push([start, start + body.length]);
  }
  return maskOutsideRanges(text, ranges);
}

interface MarkupAttribute {
  tagName: string;
  name: string;
  value: string;
  offset: number;
}

function decodeHtmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&', colon: ':', commat: '@', period: '.', quot: '"', apos: "'", sol: '/',
  };
  return value.replace(
    /&#(?:x([0-9a-f]+);?|(\d+);?)|&([a-z]+);/gi,
    (entity, hexadecimal: string | undefined, decimal: string | undefined, name: string | undefined) => {
      if (decimal !== undefined || hexadecimal !== undefined) {
        const codePoint = Number.parseInt(decimal ?? hexadecimal ?? '', decimal ? 10 : 16);
        return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return name === undefined ? entity : (named[name.toLowerCase()] ?? entity);
    },
  );
}

function markupAttributes(text: string): MarkupAttribute[] {
  const result: MarkupAttribute[] = [];
  for (const tag of text.matchAll(/<[a-z][a-z0-9:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tagName = /^<([a-z][a-z0-9:-]*)/i.exec(tag[0])?.[1]?.toLowerCase() ?? '';
    for (const attribute of tag[0].matchAll(
      /\b([a-z][\w:-]*)\s*=\s*(?:(["'])([\s\S]*?)\2|([^\s"'=<>`]+))/gi,
    )) {
      const value = attribute[3] ?? attribute[4] ?? '';
      result.push({
        tagName,
        name: (attribute[1] ?? '').toLowerCase(),
        value,
        offset: tag.index + attribute.index + attribute[0].indexOf(value),
      });
    }
  }
  return result;
}

/** Keep executable inline script bodies while preserving file offsets. */
function inlineScriptSource(text: string, decodeXmlScriptEntities = false): string {
  const ranges: Array<readonly [number, number]> = [];
  for (const match of text.matchAll(/<script\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = match[1] ?? '';
    const typeMatch = /(?:^|\s)type\s*=\s*(?:(["'])([\s\S]*?)\1|([^\s"'=<>`]+))/i
      .exec(attributes);
    const typeValue = typeMatch?.[2] ?? typeMatch?.[3];
    const type = typeValue === undefined
      ? undefined
      : decodeHtmlEntities(typeValue).toLowerCase();
    if (
      type !== undefined
      && type !== 'module'
      && !/(?:java|ecma)script/i.test(type)
    ) continue;
    const body = match[2] ?? '';
    const start = match.index + match[0].indexOf(body);
    ranges.push([start, start + body.length]);
  }
  const output = maskOutsideRanges(text, ranges).split('');
  if (decodeXmlScriptEntities) {
    for (const [start, end] of ranges) {
      const decoded = decodeHtmlEntities(text.slice(start, end));
      output.fill(' ', start, end);
      for (let index = 0; index < decoded.length && start + index < end; index += 1) {
        output[start + index] = decoded[index] ?? ' ';
      }
    }
  }
  // Script elements are separate parser goals. Preserve that boundary so a
  // trailing line comment in one element cannot swallow a later element.
  for (const [, end] of ranges) {
    if (end < output.length) output[end] = '\n';
  }
  for (const attribute of markupAttributes(text)) {
    const decoded = decodeHtmlEntities(attribute.value);
    const normalizedUrl = decoded.replace(/[\u0009\u000a\u000d]/g, '');
    let script: string | undefined;
    if (attribute.name.startsWith('on')) script = decoded;
    else {
      const match = /^\s*javascript\s*:/i.exec(normalizedUrl);
      if (match) script = normalizedUrl.slice(match[0].length);
    }
    if (script === undefined) continue;
    for (let index = 0; index < script.length && index < attribute.value.length; index += 1) {
      output[attribute.offset + index] = script[index] ?? ' ';
    }
    const end = attribute.offset + Math.min(script.length, attribute.value.length);
    if (end < output.length) output[end] = '\n';
  }
  return output.join('').replace(
    /<!\[CDATA\[|\]\]>/g,
    (value) => ' '.repeat(value.length),
  );
}

interface DecodedRuntimeString {
  value: string;
  offset: number;
  end: number;
}

interface RuntimeImport {
  specifier: string;
  offset: number;
}

function runtimeImports(path: string, text: string): RuntimeImport[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports: RuntimeImport[] = [];
  const record = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) {
      imports.push({ specifier: node.text, offset: node.getStart(source) });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node)) record(node.moduleSpecifier);
    else if (
      ts.isCallExpression(node)
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      )
    ) record(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function decodedRuntimeStrings(
  path: string,
  text: string,
): DecodedRuntimeString[] {
  const extension = extname(path).toLowerCase();
  const source = extension === '.json' || extension === '.gltf'
    ? ts.parseJsonText(path, text)
    : ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  const values: DecodedRuntimeString[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      values.push({
        value: node.text,
        offset: node.getStart(source),
        end: node.end,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
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
  const value = unwrapConstantExpression(expression);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) return value.name.text;
  if (
    ts.isElementAccessExpression(value)
    && value.argumentExpression
    && ts.isStringLiteralLike(value.argumentExpression)
  ) return value.argumentExpression.text;
  return undefined;
}

function isLocalNetworkTarget(value: string): boolean {
  // The URL parser strips ASCII tabs/newlines before scheme parsing, including
  // those embedded within a scheme (for example, `ht\ttps://host`).
  const target = value.replace(/[\t\n\r]/g, '').trim();
  if (/^(?:data|blob):/i.test(target)) return true;
  if (/^(?:https?|wss?):\/\//i.test(target)) {
    return /^(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:\/|$)/i.test(target);
  }
  if (/^\/\//.test(target)) {
    return /^\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(target);
  }
  return !/^[a-z][a-z\d+.-]*:/i.test(target);
}

type AuditedFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

function isAuditedFunction(node: ts.Node): node is AuditedFunction {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node);
}

function enclosingFunction(node: ts.Node): AuditedFunction | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !isAuditedFunction(current)) {
    current = current.parent;
  }
  return current;
}

function hasDescendant(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== root && predicate(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function memberPath(expression: ts.Expression): string[] | undefined {
  const value = unwrapConstantExpression(expression);
  if (value.kind === ts.SyntaxKind.ThisKeyword) return ['this'];
  if (ts.isIdentifier(value)) return [value.text];
  if (ts.isPropertyAccessExpression(value)) {
    const base = memberPath(value.expression);
    return base === undefined ? undefined : [...base, value.name.text];
  }
  if (
    ts.isElementAccessExpression(value)
    && value.argumentExpression
  ) {
    const key = constantString(value.argumentExpression, new Map());
    if (key === undefined) return undefined;
    const base = memberPath(value.expression);
    return base === undefined ? undefined : [...base, key];
  }
  return undefined;
}

function pathEquals(
  expression: ts.Expression,
  expected: readonly string[],
): boolean {
  const actual = memberPath(expression);
  return actual !== undefined
    && actual.length === expected.length
    && actual.every((part, index) => part === expected[index]);
}

function pathEndsWith(
  expression: ts.Expression,
  expected: readonly string[],
): boolean {
  const actual = memberPath(expression);
  return actual !== undefined
    && actual.length >= expected.length
    && expected.every(
      (part, index) => part === actual[actual.length - expected.length + index],
    );
}

function literalText(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const value = unwrapConstantExpression(expression);
  return ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined;
}

function functionBindingName(scope: AuditedFunction): string | undefined {
  if ((ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) && scope.name) {
    return scope.name.text;
  }
  if (
    (ts.isFunctionExpression(scope) || ts.isArrowFunction(scope))
    && ts.isVariableDeclaration(scope.parent)
    && ts.isIdentifier(scope.parent.name)
  ) return scope.parent.name.text;
  return undefined;
}

function isImmediateInvocation(scope: AuditedFunction): boolean {
  if (!ts.isFunctionExpression(scope) && !ts.isArrowFunction(scope)) return false;
  let expression: ts.Expression = scope;
  let parent = scope.parent;
  while (ts.isParenthesizedExpression(parent)) {
    expression = parent;
    parent = parent.parent;
  }
  return ts.isCallExpression(parent) && parent.expression === expression;
}

function isCallToBinding(
  node: ts.Node,
  binding: string,
  argument?: string,
): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrapConstantExpression(node.expression);
  if (!ts.isIdentifier(callee) || callee.text !== binding) return false;
  if (argument === undefined) return true;
  const first = node.arguments[0];
  return first !== undefined
    && ts.isIdentifier(unwrapConstantExpression(first))
    && unwrapConstantExpression(first).getText() === argument;
}

function isTruthyLiteral(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return false;
  const value = unwrapConstantExpression(expression);
  return value.kind === ts.SyntaxKind.TrueKeyword
    || (ts.isPrefixUnaryExpression(value)
      && value.operator === ts.SyntaxKind.ExclamationToken
      && ts.isNumericLiteral(value.operand)
      && value.operand.text === '0');
}

function findFunctionBinding(
  root: AuditedFunction,
  binding: string,
): AuditedFunction | undefined {
  let result: AuditedFunction | undefined;
  hasDescendant(root, (node) => {
    if (
      isAuditedFunction(node)
      && functionBindingName(node) === binding
      && enclosingFunction(node) === root
    ) {
      result = node;
      return true;
    }
    return false;
  });
  return result;
}

function expressionEndsWithIdentifier(
  expression: ts.Expression,
  identifier: string,
): boolean {
  const value = unwrapConstantExpression(expression);
  if (ts.isIdentifier(value)) return value.text === identifier;
  if (
    ts.isBinaryExpression(value)
    && value.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) return expressionEndsWithIdentifier(value.right, identifier);
  if (ts.isCommaListExpression(value)) {
    const final = value.elements.at(-1);
    return final !== undefined && expressionEndsWithIdentifier(final, identifier);
  }
  return false;
}

function validatesPreloadOptionsBuilder(
  builder: AuditedFunction,
): boolean {
  const parameter = builder.parameters[0]?.name;
  if (!parameter || !ts.isIdentifier(parameter)) return false;
  let objectName: string | undefined;
  hasDescendant(builder, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isObjectLiteralExpression(unwrapConstantExpression(node.initializer))
      && enclosingFunction(node) === builder
    ) {
      objectName = node.name.text;
      return true;
    }
    return false;
  });
  if (objectName === undefined) return false;
  const copied = (name: string): boolean => hasDirectAssignment(
    builder,
    [objectName as string, name],
    (right) => pathEquals(right, [parameter.text, name]),
  );
  const credential = (value: string): boolean => hasDirectAssignment(
    builder,
    [objectName as string, 'credentials'],
    (right) => literalText(right) === value,
  );
  const returned = hasDescendant(builder, (node) =>
    ts.isReturnStatement(node)
    && node.expression !== undefined
    && expressionEndsWithIdentifier(node.expression, objectName as string)
    && enclosingFunction(node) === builder);
  const crossOrigin = (value: string): boolean => hasDescendant(builder, (node) =>
    ts.isBinaryExpression(node)
    && enclosingFunction(node) === builder
    && comparesPathToLiteral(node, [parameter.text, 'crossOrigin'], value));
  return copied('integrity')
    && copied('referrerPolicy')
    && credential('include')
    && credential('omit')
    && credential('same-origin')
    && crossOrigin('use-credentials')
    && crossOrigin('anonymous')
    && returned;
}

function isViteModulePreloadFetchTarget(
  expression: ts.Expression,
  call: ts.CallExpression,
): boolean {
  const target = unwrapConstantExpression(expression);
  const handler = enclosingFunction(target);
  if (
    handler === undefined
    || !ts.isPropertyAccessExpression(target)
    || target.name.text !== 'href'
    || !ts.isIdentifier(target.expression)
  ) return false;
  const parameter = handler.parameters[0]?.name;
  if (!parameter || !ts.isIdentifier(parameter) || parameter.text !== target.expression.text) {
    return false;
  }
  const binding = functionBindingName(handler);
  if (binding === undefined) return false;

  const options = call.arguments[1];
  if (!options || !ts.isIdentifier(unwrapConstantExpression(options))) return false;
  const optionsName = unwrapConstantExpression(options).getText();
  const optionsInitializer = directVariable(handler, optionsName);
  const optionsCall = optionsInitializer === undefined
    ? undefined
    : unwrapConstantExpression(optionsInitializer);
  if (
    optionsCall === undefined
    || !ts.isCallExpression(optionsCall)
    || !ts.isIdentifier(unwrapConstantExpression(optionsCall.expression))
    || optionsCall.arguments[0] === undefined
    || !ts.isIdentifier(unwrapConstantExpression(optionsCall.arguments[0]))
    || unwrapConstantExpression(optionsCall.arguments[0]).getText() !== parameter.text
  ) return false;
  const optionsBinding = unwrapConstantExpression(optionsCall.expression).getText();

  const guarded = hasDescendant(handler, (node) => {
    if (!ts.isIfStatement(node) || enclosingFunction(node) !== handler) return false;
    const guard = unwrapConstantExpression(node.expression);
    if (!pathEquals(guard, [parameter.text, 'ep'])) return false;
    return ts.isReturnStatement(node.thenStatement)
      || (ts.isBlock(node.thenStatement)
        && node.thenStatement.statements.some(ts.isReturnStatement));
  });
  const marked = hasDescendant(handler, (node) => {
    if (!ts.isBinaryExpression(node) || enclosingFunction(node) !== handler) return false;
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    if (!pathEquals(node.left, [parameter.text, 'ep'])) return false;
    const value = unwrapConstantExpression(node.right);
    return isTruthyLiteral(value);
  });
  if (!guarded || !marked) return false;

  let outer: AuditedFunction | undefined;
  let ancestor: ts.Node | undefined = handler.parent;
  while (ancestor !== undefined) {
    if (isAuditedFunction(ancestor) && isImmediateInvocation(ancestor)) {
      outer = ancestor;
      break;
    }
    ancestor = ancestor.parent;
  }
  if (outer === undefined) return false;
  const optionsBuilder = findFunctionBinding(outer, optionsBinding);
  if (optionsBuilder === undefined || !validatesPreloadOptionsBuilder(optionsBuilder)) {
    return false;
  }

  const createsLinkRelList = hasDescendant(outer, (node) => {
    if (!ts.isCallExpression(node) || enclosingFunction(node) !== outer) return false;
    if (
      !pathEquals(node.expression, ['document', 'createElement'])
      || literalText(node.arguments[0]) !== 'link'
    ) return false;
    return ts.isPropertyAccessExpression(node.parent)
      && node.parent.name.text === 'relList';
  });

  const queryFlow = hasDescendant(outer, (node) => {
    if (!ts.isForOfStatement(node) || enclosingFunction(node) !== outer) return false;
    const query = unwrapConstantExpression(node.expression);
    if (
      !ts.isCallExpression(query)
      || !pathEquals(query.expression, ['document', 'querySelectorAll'])
      || literalText(query.arguments[0]) !== 'link[rel="modulepreload"]'
    ) return false;
    if (!ts.isVariableDeclarationList(node.initializer)) return false;
    const item = node.initializer.declarations[0]?.name;
    return item !== undefined
      && ts.isIdentifier(item)
      && hasDescendant(node.statement, (child) =>
        enclosingFunction(child) === outer
        && isCallToBinding(child, binding, item.text));
  });
  const mutationFlow = hasDescendant(outer, (node) => {
    if (
      !ts.isNewExpression(node)
      || enclosingFunction(node) !== outer
      || memberName(node.expression) !== 'MutationObserver'
    ) {
      return false;
    }
    const callback = node.arguments?.[0];
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
      return false;
    }
    const property = node.parent;
    const observation = ts.isPropertyAccessExpression(property)
      && property.name.text === 'observe'
      && ts.isCallExpression(property.parent)
      && property.parent.expression === property
      && pathEquals(property.parent.arguments[0], ['document'])
      && property.parent.arguments[1] !== undefined
      && ts.isObjectLiteralExpression(
        unwrapConstantExpression(property.parent.arguments[1]),
      );
    if (!observation) return false;
    const observerOptions = unwrapConstantExpression(
      (property.parent as ts.CallExpression).arguments[1],
    ) as ts.ObjectLiteralExpression;
    const childList = objectProperty(observerOptions, 'childList');
    const subtree = objectProperty(observerOptions, 'subtree');
    const tag = hasDescendant(callback, (child) =>
      ts.isBinaryExpression(child)
      && enclosingFunction(child) === callback
      && pathEndsWith(child.left, ['tagName'])
      && literalText(child.right) === 'LINK');
    const rel = hasDescendant(callback, (child) =>
      ts.isBinaryExpression(child)
      && enclosingFunction(child) === callback
      && pathEndsWith(child.left, ['rel'])
      && literalText(child.right) === 'modulepreload');
    return isTruthyLiteral(childList)
      && isTruthyLiteral(subtree)
      && tag
      && rel
      && hasDescendant(callback, (child) =>
        enclosingFunction(child) === callback
        && isCallToBinding(child, binding));
  });
  const featureCheck = hasDescendant(outer, (node) =>
    ts.isCallExpression(node)
    && enclosingFunction(node) === outer
    && memberName(node.expression) === 'supports'
    && literalText(node.arguments[0]) === 'modulepreload');
  let handlerCalls = 0;
  const countCalls = (node: ts.Node): void => {
    if (isCallToBinding(node, binding)) handlerCalls += 1;
    ts.forEachChild(node, countCalls);
  };
  countCalls(outer);
  return createsLinkRelList
    && queryFlow
    && mutationFlow
    && featureCheck
    && handlerCalls === 2;
}

function methodName(method: ts.MethodDeclaration): string | undefined {
  return ts.isIdentifier(method.name) || ts.isStringLiteralLike(method.name)
    ? method.name.text
    : undefined;
}

function directVariable(
  scope: AuditedFunction,
  name: string,
): ts.Expression | undefined {
  let result: ts.Expression | undefined;
  hasDescendant(scope, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
      && enclosingFunction(node) === scope
    ) {
      result = node.initializer;
      return true;
    }
    return false;
  });
  return result;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
      ? property.name.text
      : undefined;
    if (propertyName === name) return property.initializer;
  }
  return undefined;
}

function hasDirectAssignment(
  scope: AuditedFunction,
  left: readonly string[],
  validate: (right: ts.Expression) => boolean,
): boolean {
  return hasDescendant(scope, (node) =>
    ts.isBinaryExpression(node)
    && enclosingFunction(node) === scope
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && pathEquals(node.left, left)
    && validate(node.right));
}

function hasManagerCall(
  scope: AuditedFunction,
  method: string,
  urlName: string,
): boolean {
  return hasDescendant(scope, (node) => {
    if (!ts.isCallExpression(node) || !pathEndsWith(node.expression, ['manager', method])) {
      return false;
    }
    const argument = node.arguments[0];
    return argument !== undefined
      && ts.isIdentifier(unwrapConstantExpression(argument))
      && unwrapConstantExpression(argument).getText() === urlName;
  });
}

function hasResolvedUrl(scope: AuditedFunction, urlName: string): boolean {
  return hasDirectAssignment(scope, [urlName], (right) => {
    const call = unwrapConstantExpression(right);
    return ts.isCallExpression(call)
      && pathEquals(call.expression, ['this', 'manager', 'resolveURL'])
      && call.arguments[0] !== undefined
      && ts.isIdentifier(unwrapConstantExpression(call.arguments[0]))
      && unwrapConstantExpression(call.arguments[0]).getText() === urlName;
  });
}

function comparesPathToLiteral(
  expression: ts.Expression,
  path: readonly string[],
  literal: string,
): boolean {
  const value = unwrapConstantExpression(expression);
  if (!ts.isBinaryExpression(value)) return false;
  if (
    value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    && value.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken
  ) return false;
  return (pathEquals(value.left, path) && literalText(value.right) === literal)
    || (pathEquals(value.right, path) && literalText(value.left) === literal);
}

function hasAbortSignalAny(expression: ts.Expression): boolean {
  const matches = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node) || !pathEndsWith(node.expression, ['AbortSignal', 'any'])) {
      return false;
    }
    const values = node.arguments[0];
    if (!values || !ts.isArrayLiteralExpression(unwrapConstantExpression(values))) {
      return false;
    }
    const elements = (unwrapConstantExpression(values) as ts.ArrayLiteralExpression).elements;
    return elements.some((item) => pathEndsWith(item, ['_abortController', 'signal']))
      && elements.some((item) =>
        pathEndsWith(item, ['manager', 'abortController', 'signal']));
  };
  const value = unwrapConstantExpression(expression);
  return matches(value) || hasDescendant(value, matches);
}

interface ThenStage {
  call: ts.CallExpression;
  callback: ts.ArrowFunction | ts.FunctionExpression;
}

function nextThenStage(call: ts.CallExpression): ThenStage | undefined {
  const property = call.parent;
  if (
    !ts.isPropertyAccessExpression(property)
    || property.name.text !== 'then'
    || !ts.isCallExpression(property.parent)
    || property.parent.expression !== property
  ) return undefined;
  const callback = property.parent.arguments[0];
  return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ? { call: property.parent, callback }
    : undefined;
}

function callbackParameter(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): string | undefined {
  const name = callback.parameters[0]?.name;
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function hasFileResponseFlow(call: ts.CallExpression): boolean {
  const stage = nextThenStage(call);
  if (stage === undefined) return false;
  const response = callbackParameter(stage.callback);
  if (response === undefined) return false;
  const status = (number: string): boolean => hasDescendant(stage.callback, (node) => {
    if (!ts.isBinaryExpression(node) || enclosingFunction(node) !== stage.callback) {
      return false;
    }
    const left = unwrapConstantExpression(node.left);
    const right = unwrapConstantExpression(node.right);
    return (pathEquals(left, [response, 'status'])
      && ts.isNumericLiteral(right) && right.text === number)
      || (pathEquals(right, [response, 'status'])
        && ts.isNumericLiteral(left) && left.text === number);
  });
  const header = (name: string): boolean => hasDescendant(stage.callback, (node) =>
    ts.isCallExpression(node)
    && enclosingFunction(node) === stage.callback
    && pathEquals(node.expression, [response, 'headers', 'get'])
    && literalText(node.arguments[0]) === name);
  const constructs = (name: string): boolean => hasDescendant(stage.callback, (node) =>
    ts.isNewExpression(node)
    && enclosingFunction(node) === stage.callback
    && memberName(node.expression) === name);
  return status('200')
    && status('0')
    && header('X-File-Size')
    && header('Content-Length')
    && constructs('ReadableStream')
    && constructs('Response');
}

function hasImageBitmapResponseFlow(call: ts.CallExpression): boolean {
  const blobStage = nextThenStage(call);
  if (blobStage === undefined) return false;
  const response = callbackParameter(blobStage.callback);
  if (response === undefined) return false;
  const readsBlob = hasDescendant(blobStage.callback, (node) =>
    ts.isCallExpression(node)
    && enclosingFunction(node) === blobStage.callback
    && pathEquals(node.expression, [response, 'blob']));
  const bitmapStage = nextThenStage(blobStage.call);
  if (!readsBlob || bitmapStage === undefined) return false;
  const blob = callbackParameter(bitmapStage.callback);
  if (blob === undefined) return false;
  return hasDescendant(bitmapStage.callback, (node) => {
    if (
      !ts.isCallExpression(node)
      || enclosingFunction(node) !== bitmapStage.callback
      || memberName(node.expression) !== 'createImageBitmap'
      || node.arguments[0] === undefined
      || !ts.isIdentifier(unwrapConstantExpression(node.arguments[0]))
      || unwrapConstantExpression(node.arguments[0]).getText() !== blob
    ) return false;
    const options = node.arguments[1];
    if (!options || !ts.isCallExpression(unwrapConstantExpression(options))) return false;
    const assign = unwrapConstantExpression(options) as ts.CallExpression;
    const conversion = assign.arguments[1];
    return pathEquals(assign.expression, ['Object', 'assign'])
      && assign.arguments[0] !== undefined
      && pathEndsWith(assign.arguments[0], ['options'])
      && conversion !== undefined
      && ts.isObjectLiteralExpression(unwrapConstantExpression(conversion))
      && literalText(objectProperty(
        unwrapConstantExpression(conversion) as ts.ObjectLiteralExpression,
        'colorSpaceConversion',
      )) === 'none';
  });
}

function isFileLoaderFetch(
  target: ts.Identifier,
  call: ts.CallExpression,
  method: ts.MethodDeclaration,
): boolean {
  const url = method.parameters[0]?.name;
  if (!url || !ts.isIdentifier(url)) return false;
  const initializer = directVariable(method, target.text);
  const request = initializer === undefined
    ? undefined
    : unwrapConstantExpression(initializer);
  if (
    request === undefined
    || !ts.isNewExpression(request)
    || memberName(request.expression) !== 'Request'
    || request.arguments?.[0] === undefined
    || !ts.isIdentifier(unwrapConstantExpression(request.arguments[0]))
    || unwrapConstantExpression(request.arguments[0]).getText() !== url.text
  ) return false;
  const options = request.arguments?.[1];
  if (!options || !ts.isObjectLiteralExpression(unwrapConstantExpression(options))) {
    return false;
  }
  const object = unwrapConstantExpression(options) as ts.ObjectLiteralExpression;
  const headers = objectProperty(object, 'headers');
  const credentials = objectProperty(object, 'credentials');
  const signal = objectProperty(object, 'signal');
  if (!headers || !credentials || !signal || !hasAbortSignalAny(signal)) return false;
  const headerValue = unwrapConstantExpression(headers);
  const credentialValue = unwrapConstantExpression(credentials);
  return ts.isNewExpression(headerValue)
    && memberName(headerValue.expression) === 'Headers'
    && headerValue.arguments?.[0] !== undefined
    && pathEquals(headerValue.arguments[0], ['this', 'requestHeader'])
    && ts.isConditionalExpression(credentialValue)
    && pathEquals(credentialValue.condition, ['this', 'withCredentials'])
    && literalText(credentialValue.whenTrue) === 'include'
    && literalText(credentialValue.whenFalse) === 'same-origin'
    && hasFileResponseFlow(call)
    && hasResolvedUrl(method, url.text)
    && hasManagerCall(method, 'itemStart', url.text)
    && hasManagerCall(method, 'itemEnd', url.text);
}

function isImageBitmapLoaderFetch(
  target: ts.Identifier,
  call: ts.CallExpression,
  method: ts.MethodDeclaration,
): boolean {
  const url = method.parameters[0]?.name;
  if (!url || !ts.isIdentifier(url) || target.text !== url.text) return false;
  const optionsArgument = call.arguments[1];
  if (!optionsArgument || !ts.isIdentifier(unwrapConstantExpression(optionsArgument))) {
    return false;
  }
  const optionsName = unwrapConstantExpression(optionsArgument).getText();
  const initializer = directVariable(method, optionsName);
  if (!initializer || !ts.isObjectLiteralExpression(unwrapConstantExpression(initializer))) {
    return false;
  }
  const credentials = hasDirectAssignment(
    method,
    [optionsName, 'credentials'],
    (right) => {
      const value = unwrapConstantExpression(right);
      return ts.isConditionalExpression(value)
        && comparesPathToLiteral(
          value.condition,
          ['this', 'crossOrigin'],
          'anonymous',
        )
        && literalText(value.whenTrue) === 'same-origin'
        && literalText(value.whenFalse) === 'include';
    },
  );
  const headers = hasDirectAssignment(
    method,
    [optionsName, 'headers'],
    (right) => pathEquals(right, ['this', 'requestHeader']),
  );
  const signal = hasDirectAssignment(
    method,
    [optionsName, 'signal'],
    hasAbortSignalAny,
  );
  return credentials
    && headers
    && signal
    && hasImageBitmapResponseFlow(call)
    && hasResolvedUrl(method, url.text)
    && hasManagerCall(method, 'itemStart', url.text)
    && hasManagerCall(method, 'itemEnd', url.text);
}

function isThreeLoaderFetchTarget(
  expression: ts.Expression,
  call: ts.CallExpression,
): boolean {
  const target = unwrapConstantExpression(expression);
  const scope = enclosingFunction(target);
  if (
    !ts.isIdentifier(target)
    || scope === undefined
    || !ts.isMethodDeclaration(scope)
    || methodName(scope) !== 'load'
  ) return false;
  return isFileLoaderFetch(target, call, scope)
    || isImageBitmapLoaderFetch(target, call, scope);
}

const BUNDLED_SINK_NAMES = [
  'fetch', 'sendBeacon', 'importScripts', 'XMLHttpRequest', 'WebSocket',
  'EventSource', 'WebTransport', 'RTCPeerConnection',
] as const;
type BundledSink = (typeof BUNDLED_SINK_NAMES)[number];
const BUNDLED_SINKS: ReadonlySet<string> = new Set(BUNDLED_SINK_NAMES);

interface SinkResolution {
  name: BundledSink;
  directGlobal: boolean;
}

function addBindingNames(name: ts.BindingName, output: Set<string>): void {
  if (ts.isIdentifier(name)) {
    output.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) addBindingNames(element.name, output);
  }
}

function declaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      addBindingNames(node.name, names);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name
    ) names.add(node.name.text);
    else if (ts.isImportClause(node)) {
      if (node.name) names.add(node.name.text);
      if (node.namedBindings && ts.isNamespaceImport(node.namedBindings)) {
        names.add(node.namedBindings.name.text);
      }
    } else if (ts.isImportSpecifier(node)) names.add(node.name.text);
    else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingNames(node.variableDeclaration.name, names);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function directSink(
  expression: ts.Expression,
  declarations: ReadonlySet<string>,
): SinkResolution | undefined {
  const value = unwrapConstantExpression(expression);
  if (ts.isIdentifier(value) && BUNDLED_SINKS.has(value.text)) {
    return {
      name: value.text as BundledSink,
      directGlobal: !declarations.has(value.text),
    };
  }
  const path = memberPath(value);
  const name = path?.at(-1);
  if (name === undefined || !BUNDLED_SINKS.has(name)) return undefined;
  const root = path?.[0];
  const directGlobal = path?.length === 2
    && (
      root === 'globalThis' || root === 'window' || root === 'self'
      || (root === 'navigator' && name === 'sendBeacon')
    )
    && !declarations.has(root);
  return { name: name as BundledSink, directGlobal };
}

function collectNetworkAliases(
  source: ts.SourceFile,
  declarations: ReadonlySet<string>,
): Map<string, BundledSink> {
  const aliases = new Map<string, BundledSink>();
  const ambiguous = new Set<string>();
  const register = (name: string, sink: BundledSink): boolean => {
    if (ambiguous.has(name)) return false;
    const existing = aliases.get(name);
    if (existing === undefined) {
      aliases.set(name, sink);
      return true;
    }
    if (existing !== sink) {
      // Any ambiguous alias is treated as a transport sink so both call and
      // constructor uses fail closed regardless of sibling-scope name reuse.
      aliases.set(name, 'WebSocket');
      ambiguous.add(name);
      return true;
    }
    return false;
  };
  const pending: Array<readonly [string, ts.Expression]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) pending.push([node.name.text, node.initializer]);
      else if (ts.isObjectBindingPattern(node.name)) {
        const root = memberPath(node.initializer)?.[0];
        if (root === 'globalThis' || root === 'window' || root === 'self') {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const imported = element.propertyName ?? element.name;
            const name = ts.isIdentifier(imported) || ts.isStringLiteralLike(imported)
              ? imported.text
              : undefined;
            if (name && BUNDLED_SINKS.has(name)) {
              register(element.name.text, name as BundledSink);
            }
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(unwrapConstantExpression(node.left))
    ) pending.push([unwrapConstantExpression(node.left).getText(), node.right]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, expression] of pending) {
      if (ambiguous.has(name)) continue;
      const value = unwrapConstantExpression(expression);
      let alias = directSink(expression, declarations)?.name
        ?? (ts.isIdentifier(value) ? aliases.get(value.text) : undefined);
      if (
        alias === undefined
        && ts.isCallExpression(value)
        && memberName(value.expression) === 'bind'
      ) {
        const binder = unwrapConstantExpression(value.expression);
        if (ts.isPropertyAccessExpression(binder) || ts.isElementAccessExpression(binder)) {
          alias = directSink(binder.expression, declarations)?.name
            ?? (ts.isIdentifier(unwrapConstantExpression(binder.expression))
              ? aliases.get(unwrapConstantExpression(binder.expression).getText())
              : undefined);
        }
      }
      if (alias !== undefined && register(name, alias)) changed = true;
    }
  }
  return aliases;
}

function resolveSink(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BundledSink>,
  declarations: ReadonlySet<string>,
): SinkResolution | undefined {
  const direct = directSink(expression, declarations);
  if (direct !== undefined) return direct;
  const value = unwrapConstantExpression(expression);
  if (ts.isCallExpression(value) && memberName(value.expression) === 'bind') {
    const binder = unwrapConstantExpression(value.expression);
    if (ts.isPropertyAccessExpression(binder) || ts.isElementAccessExpression(binder)) {
      const bound = resolveSink(binder.expression, aliases, declarations);
      return bound === undefined ? undefined : { ...bound, directGlobal: false };
    }
  }
  const alias = ts.isIdentifier(value) ? aliases.get(value.text) : undefined;
  return alias === undefined ? undefined : { name: alias, directGlobal: false };
}

function collectXhrVariables(
  source: ts.SourceFile,
  aliases: ReadonlyMap<string, BundledSink>,
  declarations: ReadonlySet<string>,
): Set<string> {
  const xhr = new Set<string>();
  const pending: Array<readonly [string, ts.Expression]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      pending.push([node.name.text, node.initializer]);
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(unwrapConstantExpression(node.left))
    ) pending.push([unwrapConstantExpression(node.left).getText(), node.right]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, expression] of pending) {
      if (xhr.has(name)) continue;
      const value = unwrapConstantExpression(expression);
      const constructed = ts.isNewExpression(value)
        && resolveSink(value.expression, aliases, declarations)?.name === 'XMLHttpRequest';
      if (constructed || (ts.isIdentifier(value) && xhr.has(value.text))) {
        xhr.add(name);
        changed = true;
      }
    }
  }
  return xhr;
}

function lexicalInitializer(identifier: ts.Identifier): ts.Expression | undefined {
  const source = identifier.getSourceFile();
  const name = identifier.text;
  const referenceOffset = identifier.getStart(source);
  let scope = enclosingFunction(identifier);
  while (true) {
    if (
      scope?.parameters.some((parameter) =>
        ts.isIdentifier(parameter.name) && parameter.name.text === name)
    ) return undefined;

    let initializer: ts.Expression | undefined;
    let latestOffset = -1;
    let shadowed = false;
    const visit = (node: ts.Node): void => {
      if (node.getStart(source) >= referenceOffset) return;
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.name.text === name
        && enclosingFunction(node) === scope
      ) {
        shadowed = true;
        if (node.initializer && node.getStart(source) > latestOffset) {
          initializer = node.initializer;
          latestOffset = node.getStart(source);
        }
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(unwrapConstantExpression(node.left))
        && unwrapConstantExpression(node.left).getText() === name
        && enclosingFunction(node) === scope
        && node.getStart(source) > latestOffset
      ) {
        shadowed = true;
        initializer = node.right;
        latestOffset = node.getStart(source);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (initializer !== undefined || shadowed) return initializer;
    if (scope === undefined) return undefined;
    scope = enclosingFunction(scope);
  }
}

function directFunctionParameter(
  identifier: ts.Identifier,
): ts.ParameterDeclaration | undefined {
  const scope = enclosingFunction(identifier);
  return scope?.parameters.find(
    (parameter) => ts.isIdentifier(parameter.name)
      && parameter.name.text === identifier.text,
  );
}

function usesRuntimeTaintedInput(
  expression: ts.Expression,
  visited: Set<ts.Node> = new Set(),
  taintedParameters: ReadonlySet<ts.ParameterDeclaration> = new Set(),
): boolean {
  const roots = new Set([
    'globalThis', 'window', 'self', 'location', 'document',
    'localStorage', 'sessionStorage',
  ]);
  const value = unwrapConstantExpression(expression);
  if (visited.has(value)) return false;
  visited.add(value);
  if (ts.isIdentifier(value)) {
    if (roots.has(value.text)) return true;
    const initializer = lexicalInitializer(value);
    if (initializer !== undefined) {
      return usesRuntimeTaintedInput(initializer, visited, taintedParameters);
    }
    const parameter = directFunctionParameter(value);
    return parameter !== undefined && taintedParameters.has(parameter);
  }
  if (ts.isPropertyAccessExpression(value)) {
    return usesRuntimeTaintedInput(value.expression, visited, taintedParameters);
  }
  let found = false;
  ts.forEachChild(value, (node) => {
    if (!found && ts.isExpression(node)) {
      found = usesRuntimeTaintedInput(node, visited, taintedParameters);
    }
  });
  return found;
}

/**
 * Propagate runtime-derived arguments through direct named helper calls. This
 * deliberately stops at the emitted bundle's lexical helper boundary rather
 * than attempting open-ended interprocedural analysis.
 */
function collectRuntimeTaintedParameters(
  source: ts.SourceFile,
): Set<ts.ParameterDeclaration> {
  const functions = new Map<string, AuditedFunction[]>();
  const calls: ts.CallExpression[] = [];
  const collect = (node: ts.Node): void => {
    if (isAuditedFunction(node)) {
      const name = functionBindingName(node);
      if (name !== undefined) {
        const candidates = functions.get(name) ?? [];
        candidates.push(node);
        functions.set(name, candidates);
      }
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, collect);
  };
  collect(source);

  const tainted = new Set<ts.ParameterDeclaration>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const call of calls) {
      const callee = unwrapConstantExpression(call.expression);
      if (!ts.isIdentifier(callee)) continue;
      for (const scope of functions.get(callee.text) ?? []) {
        for (let index = 0; index < scope.parameters.length; index += 1) {
          const parameter = scope.parameters[index];
          const argument = call.arguments[index];
          if (
            parameter !== undefined
            && argument !== undefined
            && !tainted.has(parameter)
            && usesRuntimeTaintedInput(argument, new Set(), tainted)
          ) {
            tainted.add(parameter);
            changed = true;
          }
        }
      }
    }
  }
  return tainted;
}

function isXmlHttpRequestReceiver(
  expression: ts.Expression,
  variables: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BundledSink>,
  declarations: ReadonlySet<string>,
): boolean {
  const receiver = unwrapConstantExpression(expression);
  if (ts.isIdentifier(receiver)) return variables.has(receiver.text);
  return ts.isNewExpression(receiver)
    && resolveSink(receiver.expression, aliases, declarations)?.name === 'XMLHttpRequest';
}

/**
 * Audit emitted JavaScript network sinks. Statically local fetch/XHR/worker
 * targets are allowed for packaged assets; targets that cannot be proved local
 * are rejected. APIs whose purpose is transport/telemetry remain findings even
 * when their literal target is same-origin.
 */
function auditBundledNetworkTargets(
  sourceText: string,
  originalText: string,
  relativePath: string,
): Finding[] {
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = declaredNames(source);
  const aliases = collectNetworkAliases(source, declarations);
  const xhrVariables = collectXhrVariables(source, aliases, declarations);
  const taintedParameters = collectRuntimeTaintedParameters(source);

  const findings: Finding[] = [];
  const record = (
    target: ts.Expression | undefined,
    node: ts.Node,
    sink: string,
    allowStaticLocal: boolean,
  ): void => {
    const value = target === undefined
      ? undefined
      : constantString(target, new Map());
    if (value === undefined) {
      if (
        sink === 'fetch'
        && target !== undefined
        && ts.isCallExpression(node)
        && resolveSink(node.expression, aliases, declarations)?.directGlobal === true
        && (
          isViteModulePreloadFetchTarget(target, node)
          || isThreeLoaderFetchTarget(target, node)
        )
      ) return;
      const evidence = target?.getText(source) ?? '<missing target>';
      findings.push({
        path: relativePath,
        line: lineForOffset(originalText, (target ?? node).getStart(source)),
        reason: 'bundled dynamic network target',
        excerpt: `${sink}: ${evidence}`.slice(0, 180),
      });
      return;
    }
    const local = isLocalNetworkTarget(value);
    if (local && allowStaticLocal) return;
    findings.push({
      path: relativePath,
      line: lineForOffset(originalText, (target ?? node).getStart(source)),
      reason: local
        ? 'bundled network API'
        : 'bundled non-local network target',
      excerpt: `${sink}: ${value}`.slice(0, 180),
    });
  };
  const rejectApi = (node: ts.Node, sink: string): void => {
    findings.push({
      path: relativePath,
      line: lineForOffset(originalText, node.getStart(source)),
      reason: 'bundled network API',
      excerpt: sink,
    });
  };
  const runtimeTainted = (target: ts.Expression | undefined): boolean =>
    target !== undefined && usesRuntimeTaintedInput(
      target,
      new Set(),
      taintedParameters,
    );
  const arrayArgument = (
    expression: ts.Expression | undefined,
    index: number,
  ): ts.Expression | undefined => {
    if (expression === undefined) return undefined;
    const value = unwrapConstantExpression(expression);
    if (!ts.isArrayLiteralExpression(value)) return undefined;
    const element = value.elements[index];
    return element !== undefined && !ts.isOmittedExpression(element)
      ? element
      : undefined;
  };
  const recordRuntimeResource = (
    target: ts.Expression | undefined,
    node: ts.Node,
    sink: string,
  ): void => {
    if (target === undefined) return;
    const value = constantString(target, new Map());
    if (
      (value !== undefined && !isLocalNetworkTarget(value))
      || (value === undefined && runtimeTainted(target))
    ) record(target, node, sink, true);
  };
  const inspect = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = resolveSink(node.expression, aliases, declarations)?.name;
      const callee = unwrapConstantExpression(node.expression);
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && (memberName(callee) === 'call' || memberName(callee) === 'apply')
      ) {
        const wrapped = resolveSink(callee.expression, aliases, declarations)?.name;
        if (wrapped !== undefined) {
          const argument = memberName(callee) === 'call'
            ? node.arguments[1]
            : arrayArgument(node.arguments[1], 0);
          record(argument, node, wrapped, wrapped === 'fetch' || wrapped === 'importScripts');
        }
        const wrappedMethod = unwrapConstantExpression(callee.expression);
        if (
          (ts.isPropertyAccessExpression(wrappedMethod)
            || ts.isElementAccessExpression(wrappedMethod))
          && memberName(wrappedMethod) === 'open'
        ) {
          const argument = memberName(callee) === 'call'
            ? node.arguments[2]
            : arrayArgument(node.arguments[1], 1);
          if (
            isXmlHttpRequestReceiver(
              wrappedMethod.expression,
              xhrVariables,
              aliases,
              declarations,
            )
            || runtimeTainted(argument)
          ) record(argument, node, 'XMLHttpRequest.open', true);
        }
      }
      if (pathEquals(node.expression, ['Reflect', 'apply'])) {
        const wrapped = node.arguments[0] === undefined
          ? undefined
          : resolveSink(node.arguments[0], aliases, declarations)?.name;
        if (wrapped !== undefined) {
          record(
            arrayArgument(node.arguments[2], 0),
            node,
            wrapped,
            wrapped === 'fetch' || wrapped === 'importScripts',
          );
        }
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node.arguments[0], node, 'dynamic import', true);
      }
      if (
        memberName(node.expression) === 'setAttribute'
        && ['src', 'href', 'action', 'formaction', 'poster'].includes(
          literalText(node.arguments[0])?.toLowerCase() ?? '',
        )
      ) recordRuntimeResource(node.arguments[1], node, 'DOM resource attribute');
      if (
        pathEquals(node.expression, ['window', 'open'])
        || pathEquals(node.expression, ['location', 'assign'])
        || pathEquals(node.expression, ['location', 'replace'])
      ) recordRuntimeResource(node.arguments[0], node, 'browser navigation');
      if (
        memberName(node.expression) === 'load'
        && node.arguments[0] !== undefined
        && runtimeTainted(node.arguments[0])
      ) record(node.arguments[0], node, 'loader.load', true);
      if (name === 'fetch') record(node.arguments[0], node, name, true);
      if (name === 'sendBeacon') record(node.arguments[0], node, name, false);
      if (name === 'importScripts') {
        if (node.arguments.length === 0) record(undefined, node, name, true);
        for (const argument of node.arguments) record(argument, node, name, true);
      }
      if (name === 'WebSocket' || name === 'EventSource' || name === 'WebTransport') {
        record(node.arguments[0], node, name, false);
      }
      if (name === 'RTCPeerConnection') rejectApi(node, name);
      if (
        memberName(node.expression) === 'open'
        && (
          ts.isPropertyAccessExpression(unwrapConstantExpression(node.expression))
          || ts.isElementAccessExpression(unwrapConstantExpression(node.expression))
        )
        && isXmlHttpRequestReceiver(
          (unwrapConstantExpression(node.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression,
          xhrVariables,
          aliases,
          declarations,
        )
        || (
          memberName(node.expression) === 'open'
          && runtimeTainted(node.arguments[1])
        )
      ) record(node.arguments[1], node, 'XMLHttpRequest.open', true);
    } else if (ts.isNewExpression(node)) {
      const name = resolveSink(node.expression, aliases, declarations)?.name;
      if (name === 'WebSocket' || name === 'EventSource' || name === 'WebTransport') {
        record(node.arguments?.[0], node, name, false);
      }
      if (name === 'RTCPeerConnection') rejectApi(node, name);
      if (memberName(node.expression) === 'Worker' || memberName(node.expression) === 'SharedWorker') {
        recordRuntimeResource(node.arguments?.[0], node, 'worker script');
      }
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ['src', 'href', 'action', 'formAction', 'poster'].includes(
        memberName(node.left as ts.Expression) ?? '',
      )
    ) {
      recordRuntimeResource(node.right, node, 'DOM resource assignment');
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return findings;
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
  const extension = extname(path).toLowerCase();
  const runtimeText = executableSource(path, text);
  let scanText = redactAllowedUris(runtimeText);
  const isJavaScript = JAVASCRIPT_SUFFIXES.has(extension);
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

  if (INLINE_SCRIPT_SUFFIXES.has(extension)) {
    for (const attribute of markupAttributes(text)) {
      const decoded = decodeHtmlEntities(attribute.value);
      const normalizedUrl = decoded.replace(/[\u0009\u000a\u000d]/g, '');
      if (
        attribute.tagName === 'script'
        && attribute.name === 'src'
        && /^\s*data:/i.test(normalizedUrl)
      ) {
        findings.push({
          path: relativePath,
          line: lineForOffset(text, attribute.offset),
          reason: 'executable data script is not allowed',
          excerpt: decoded.slice(0, 180),
        });
      }
      if (decoded === attribute.value) continue;
      const scan = redactAllowedUris(decoded);
      for (const [reason, pattern] of NETWORK_PATTERNS.slice(0, 3)) {
        if (!firstMatch(pattern, scan)) continue;
        findings.push({
          path: relativePath,
          line: lineForOffset(text, attribute.offset),
          reason,
          excerpt: decoded.slice(0, 180),
        });
      }
    }
  }

  if (isJavaScript || extension === '.json' || extension === '.gltf') {
    for (const item of decodedRuntimeStrings(path, runtimeText)) {
      // The raw scan already reports ordinary literals; decoded scanning is
      // specifically for escaped-solidus/unicode spellings and cooked
      // template chunks that do not contain their runtime value verbatim.
      if (runtimeText.slice(item.offset, item.end).includes(item.value)) continue;
      const decoded = redactProvenanceCommentUrls(redactAllowedUris(item.value));
      for (const [reason, pattern] of NETWORK_PATTERNS.slice(0, 3)) {
        if (!firstMatch(pattern, decoded)) continue;
        findings.push({
          path: relativePath,
          line: lineForOffset(text, item.offset),
          reason,
          excerpt: item.value.slice(0, 180),
        });
      }
    }
  }

  const bundledScript = builtOutput && INLINE_SCRIPT_SUFFIXES.has(extension)
    ? inlineScriptSource(text, extension === '.svg' || extension === '.xml')
    : isJavaScript ? runtimeText : undefined;
  if (builtOutput && bundledScript !== undefined) {
    findings.push(...auditBundledNetworkTargets(bundledScript, text, relativePath));
    const diagnostic = /__THREE_GAME_(?:TEST_HOOKS|DIAGNOSTICS)__/g;
    for (const match of bundledScript.matchAll(diagnostic)) {
      findings.push({
        path: relativePath,
        line: lineForOffset(text, match.index),
        reason: 'production diagnostics hook',
        excerpt: match[0],
      });
    }
  }

  if (isJavaScript) {
    const configFile = isConfigFile(path, root);
    for (const item of runtimeImports(path, runtimeText)) {
      if (!isAllowedImport(item.specifier, runtimeAllowed, toolingAllowed, configFile)) {
        findings.push({
          path: relativePath,
          line: lineForOffset(text, item.offset),
          reason: 'unapproved bare runtime import',
          excerpt: item.specifier,
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
  const discovery = runtimeFiles(root);
  for (const path of discovery.symbolicLinks) {
    findings.push({
      path: relative(root, path),
      line: 1,
      reason: 'runtime symbolic link is not allowed',
      excerpt: 'replace the link with an in-project file or directory',
    });
  }
  for (const path of discovery.files) {
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
