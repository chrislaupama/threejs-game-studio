/** Focused tests for audit-skill-local-only.ts. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "audit-skill-local-only.ts",
);

interface AuditResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runAudit(files: Record<string, string>): AuditResult {
  const directory = mkdtempSync(join(tmpdir(), "audit-skill-local-only-"));
  const root = join(directory, "skill");
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    }
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", SCRIPT, root],
      {
        encoding: "utf8",
      },
    );
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function diagnostic(result: AuditResult): string {
  return result.stdout + result.stderr;
}

test("accepts a local Three.js skill", () => {
  const result = runAudit({
    "SKILL.md": "Use Three.js and local browser tools only.",
    "references/assets.md": "Load /assets/models/hero.glb.",
    "assets/game/main.ts": "import * as THREE from 'three'; void THREE;",
    "assets/game/playwright.config.ts":
      "const url = 'http://127.0.0.1:5188';",
    "assets/game/icon.svg":
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test("accepts exact protocol-relative loopback URLs", () => {
  const result = runAudit({
    "assets/game/main.ts": [
      "const host = '//localhost:5188/game';",
      "const ipv4 = '//127.0.0.1:5188/game';",
      "const ipv6 = '//[::1]:5188/game';",
      "void host; void ipv4; void ipv6;",
    ].join("\n"),
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects protocol-relative userinfo disguised as loopback", () => {
  const result = runAudit({
    "scripts/client.ts":
      "export const endpoint = '//localhost@evil.example/collect';\n",
    "assets/style.css":
      "body { background: url(//127.0.0.1@evil.example/image.png); }\n",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/protocol-relative URL/g)?.length, 2);
});

test("rejects a remote runtime URL", () => {
  const result = runAudit({
    "references/assets.md": "Load https://example.com/hero.glb",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /non-local URL/);
});

test("rejects protocol-relative URLs in TypeScript and CSS", () => {
  const result = runAudit({
    "scripts/client.ts": "export const endpoint = '//cdn.example.com/collect';\n",
    "assets/style.css": "body { background: url(//cdn.example.com); }\n",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/protocol-relative URL/g)?.length, 2);
});

test("rejects single-label protocol-relative hosts with paths", () => {
  const result = runAudit({
    "scripts/client.ts": "export const endpoint = '//collector/ingest';\n",
    "assets/style.css": "body { background: url(//cdn/image.png); }\n",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/protocol-relative URL/g)?.length, 2);
});

test("accepts official Three.js research URLs in Markdown", () => {
  const result = runAudit({
    "SKILL.md": "Local only.",
    "references/rendering.md":
      "Read https://threejs.org/docs/pages/WebGLRenderer.html and "
      + "https://github.com/mrdoob/three.js/blob/dev/src/renderers/WebGLRenderer.js.",
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test("accepts exactly the canonical repository URL in the root README", () => {
  const result = runAudit({
    "SKILL.md": "Local only.",
    "README.md":
      "Install [chrislaupama/threejs-game-studio]"
      + "(https://github.com/chrislaupama/threejs-game-studio).",
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects canonical-repository variants and use outside README", () => {
  const result = runAudit({
    "README.md": [
      "https://github.com/chrislaupama/threejs-game-studio/",
      "http://github.com/chrislaupama/threejs-game-studio",
      "https://github.com/chrislaupama/threejs-game-studio?tab=readme",
    ].join("\n"),
    "SKILL.md":
      "https://github.com/chrislaupama/threejs-game-studio",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/non-local URL/g)?.length, 4);
});

test("rejects arbitrary and nonofficial Markdown URLs", () => {
  const result = runAudit({
    "SKILL.md": "Local only.",
    "references/research.md":
      "Reject https://example.com/guide and "
      + "https://github.com/someone/three.js and "
      + "https://threejs.org.example.com/phishing.",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /non-local URL/);
  assert.equal(result.stdout.match(/non-local URL/g)?.length, 3);
});

test("rejects official research URLs outside Markdown", () => {
  const result = runAudit({
    "SKILL.md": "Local only.",
    "assets/game/main.ts":
      "const runtimeUrl = 'https://threejs.org/examples/models/hero.glb';",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /non-local URL/);
});

test("rejects credentials and MCP invocation syntax", () => {
  const result = runAudit({
    "SKILL.md": "Read GEMINI_API_KEY then call mcp__assets__generate.",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /provider credential/);
  assert.match(result.stdout, /MCP invocation syntax/);
});

test("rejects a provider helper file", () => {
  const result = runAudit({
    "scripts/generate_image.py": "print('generator')",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /provider helper file/);
});

test("rejects TypeScript and JavaScript provider-helper equivalents", async (t) => {
  const filenames = [
    "generate_image.ts",
    "generate-image.js",
    "probe_asset_credentials.mjs",
    "threejs-3d-asset.tsx",
    "threejs_audio_asset.cjs",
    "generate-image.mts",
  ];
  for (const filename of filenames) {
    await t.test(filename, () => {
      const result = runAudit({
        [`scripts/${filename}`]: "export {};\n",
      });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /provider helper file/);
    });
  }
});

test("rejects a network-client import", () => {
  const result = runAudit({
    "scripts/download.py": "import requests\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /network client command\/import/);
});

test("rejects network clients in TypeScript and JavaScript scripts", async (t) => {
  const fixtures = new Map([
    ["scripts/download.ts", "import { request } from 'node:https';\nvoid request;\n"],
    ["scripts/fetch.js", "export function load(target) { return fetch(target); }\n"],
    ["scripts/socket.mjs", "export const socket = new WebSocket(endpoint);\n"],
    ["scripts/client.cjs", "const client = require('undici');\nvoid client;\n"],
    ["scripts/client.mts", "import net from 'node:net';\nnet.connect(443);\n"],
    ["scripts/http2.ts", "import { connect } from 'node:http2';\nvoid connect;\n"],
    ["scripts/dns.ts", "import { resolve4 } from 'node:dns/promises';\nvoid resolve4;\n"],
  ]);
  for (const [path, source] of fixtures) {
    await t.test(path, () => {
      const result = runAudit({ [path]: source });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /network client command\/import/);
    });
  }
});

test("ignores legal attribution and lockfile registry URLs", () => {
  const result = runAudit({
    "NOTICE.md":
      "Source https://github.com/example/project and GEMINI_API_KEY excluded.",
    "assets/game/package-lock.json":
      '{"resolved":"https://registry.npmjs.org/three"}',
    "SKILL.md": "Local only.",
  });
  assert.equal(result.status, 0, diagnostic(result));
});
