#!/usr/bin/env node
/** Check official Three.js research links without making normal verification network-dependent. */

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_PATTERN = /https:\/\/[^\s<>()\]]+/g;
const TRAILING_MARKDOWN_PUNCTUATION = /[.,;:!?]+$/;

export interface LinkSource {
  path: string;
  line: number;
  originalUrl: string;
}

export interface OfficialLink {
  url: string;
  sources: LinkSource[];
}

export interface LinkCheck {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  error?: string;
  sources: LinkSource[];
}

export interface CheckOptions {
  concurrency: number;
  timeoutMs: number;
  retries: number;
  fetchImpl?: typeof fetch;
}

interface CliOptions extends CheckOptions {
  root: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function lineFor(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

function isOfficialThreeUrl(value: URL): boolean {
  if (value.hostname === 'threejs.org') return true;
  if (
    value.hostname === 'github.com'
    && value.pathname.toLowerCase().startsWith('/mrdoob/three.js')
  ) return true;
  return value.hostname === 'www.npmjs.com'
    && value.pathname.toLowerCase() === '/package/three';
}

function markdownFiles(root: string): string[] {
  const files = [join(root, 'SKILL.md'), join(root, 'README.md')]
    .filter(existsSync);
  const references = join(root, 'references');
  if (isDirectory(references)) {
    for (const entry of readdirSync(references, { withFileTypes: true })) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        files.push(join(references, entry.name));
      }
    }
  }
  return files.sort();
}

export function collectOfficialLinks(rootDirectory: string): OfficialLink[] {
  const root = resolve(rootDirectory);
  const links = new Map<string, OfficialLink>();
  for (const path of markdownFiles(root)) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(URL_PATTERN)) {
      const raw = (match[0] ?? '').replace(TRAILING_MARKDOWN_PUNCTUATION, '');
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        continue;
      }
      if (!isOfficialThreeUrl(parsed)) continue;
      parsed.hash = '';
      const url = parsed.href;
      const item = links.get(url) ?? { url, sources: [] };
      item.sources.push({
        path: relative(root, path).split('\\').join('/'),
        line: lineFor(text, match.index ?? 0),
        originalUrl: raw,
      });
      links.set(url, item);
    }
  }
  return [...links.values()].sort((left, right) => left.url.localeCompare(right.url));
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function checkOne(
  link: OfficialLink,
  options: CheckOptions,
): Promise<LinkCheck> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError = 'request failed';
  let lastStatus: number | undefined;
  let finalUrl: string | undefined;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetchImpl(link.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'user-agent': 'threejs-game-studio-link-audit/1.0',
        },
      });
      lastStatus = response.status;
      finalUrl = response.url || link.url;
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return {
          url: link.url,
          ok: true,
          status: response.status,
          finalUrl,
          sources: link.sources,
        };
      }
      lastError = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => undefined);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < options.retries) await delay(200 * (attempt + 1));
  }

  return {
    url: link.url,
    ok: false,
    status: lastStatus,
    finalUrl,
    error: lastError,
    sources: link.sources,
  };
}

export async function checkOfficialLinks(
  links: readonly OfficialLink[],
  options: CheckOptions,
): Promise<LinkCheck[]> {
  const results = new Array<LinkCheck>(links.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(options.concurrency, Math.max(1, links.length)) },
    async () => {
      while (cursor < links.length) {
        const index = cursor;
        cursor += 1;
        const link = links[index];
        if (link) results[index] = await checkOne(link, options);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function positiveInteger(name: string, value: string | undefined): number {
  if (value === undefined) throw new Error(`${name} requires a value`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv: readonly string[]): CliOptions | 'help' {
  let root = '.';
  let concurrency = 8;
  let timeoutMs = 15_000;
  let retries = 1;
  let positional = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '-h' || value === '--help') return 'help';
    if (value === '--concurrency') {
      concurrency = positiveInteger(value, argv[++index]);
    } else if (value === '--timeout') {
      timeoutMs = positiveInteger(value, argv[++index]);
    } else if (value === '--retries') {
      const raw = argv[++index];
      if (raw === undefined || !/^\d+$/.test(raw)) {
        throw new Error('--retries must be a non-negative integer');
      }
      retries = Number(raw);
    } else if (value?.startsWith('-')) {
      throw new Error(`unrecognized argument: ${value}`);
    } else if (!positional && value !== undefined) {
      root = value;
      positional = true;
    } else {
      throw new Error(`unexpected positional argument: ${value}`);
    }
  }
  return { root: resolve(root), concurrency, timeoutMs, retries };
}

function usage(): void {
  console.log(
    'usage: audit-official-links.ts [skill] [--concurrency N] [--timeout MS] [--retries N]\n\n' +
    'Checks official Three.js, repository, and npm research links with GET requests.\n' +
    'This networked maintenance audit is intentionally separate from npm run verify.',
  );
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: CliOptions | 'help';
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (options === 'help') {
    usage();
    return 0;
  }
  if (!isDirectory(options.root)) {
    console.error(`Skill directory not found: ${options.root}`);
    return 2;
  }

  const links = collectOfficialLinks(options.root);
  if (links.length === 0) {
    console.error('No official Three.js links found.');
    return 2;
  }
  const results = await checkOfficialLinks(links, options);
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) {
    console.log(`Official-link audit passed: ${results.length} unique base URLs resolved.`);
    return 0;
  }

  console.log(`Official-link audit failed: ${failures.length}/${results.length} URLs did not resolve.`);
  for (const failure of failures) {
    console.log(`- ${failure.url}: ${failure.error ?? `HTTP ${failure.status ?? 'unknown'}`}`);
    for (const source of failure.sources.slice(0, 5)) {
      console.log(`  - ${source.path}:${source.line}`);
    }
    if (failure.sources.length > 5) {
      console.log(`  - … ${failure.sources.length - 5} more source occurrence(s)`);
    }
  }
  const noHttpEvidence = failures.every((failure) => failure.status === undefined);
  return noHttpEvidence ? 2 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const invokedAsMain = invokedPath !== '' && existsSync(invokedPath)
  && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url));
if (invokedAsMain) {
  main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 2;
    },
  );
}
