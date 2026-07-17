#!/usr/bin/env node
/** Run every TypeScript test without relying on shell glob expansion. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(scriptsDirectory)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(scriptsDirectory, name));

if (tests.length === 0) {
  console.error('No TypeScript tests found in scripts/.');
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', ...tests],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
