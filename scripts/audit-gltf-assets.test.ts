import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import { auditGltfAssets, formatAssetChecklist, main } from "./audit-gltf-assets.ts";

const temporaryDirectories: string[] = [];

const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function glbJson(document: unknown, paddingByte = 0x20): Buffer {
  let source = JSON.stringify(document);
  if (Buffer.byteLength(source) % 4 === 0) source += " ";
  const length = Math.ceil(Buffer.byteLength(source) / 4) * 4;
  const bytes = Buffer.alloc(length, paddingByte);
  bytes.write(source);
  return bytes;
}

function makeGlb(chunks: Array<{ type: number; data: Buffer }>): Buffer {
  const byteLength = 12 + chunks.reduce((total, chunk) => total + 8 + chunk.data.length, 0);
  const glb = Buffer.alloc(byteLength);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(byteLength, 8);
  let offset = 12;
  for (const chunk of chunks) {
    glb.writeUInt32LE(chunk.data.length, offset);
    glb.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(glb, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return glb;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("reports missing asset roots as intentional procedural note", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const findings = auditGltfAssets(directory);
  assert.ok(findings.some((finding) => /procedural-only/.test(finding.message)));
});

test("discovers the common Vite src/assets layout by default", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const sourceAssets = resolve(directory, "src/assets");
  mkdirSync(sourceAssets, { recursive: true });
  writeFileSync(
    resolve(sourceAssets, "bad.gltf"),
    JSON.stringify({ asset: { version: "1.0" } }),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /src\/assets\/bad\.gltf/);
  assert.match(checklist, /asset\.version must be/);
});

test("warns on large textures without ktx2 sibling", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  const largePng = Buffer.alloc(2_100_000, 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(largePng);
  writeFileSync(resolve(publicDir, "huge.png"), largePng);
  writeFileSync(
    resolve(publicDir, "box.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      meshes: [{}],
      materials: [{}, {}],
      images: [],
      buffers: [{ uri: "box.bin", byteLength: 4 }],
    }),
  );
  writeFileSync(resolve(publicDir, "box.bin"), Buffer.alloc(4));

  const findings = auditGltfAssets(directory);
  const checklist = formatAssetChecklist(findings).join("\n");
  assert.match(checklist, /huge\.png/);
  assert.match(checklist, /without sibling \.ktx2/);
  assert.match(checklist, /meshes=1 materials=2/);
  assert.match(checklist, /buffer\[0\] resolved to public\/box\.bin/);
});

test("validates local buffer and image dependencies", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public", "models");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(resolve(publicDir, "mesh.bin"), Buffer.alloc(16));
  const webp = Buffer.alloc(16);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  writeFileSync(resolve(publicDir, "albedo.webp"), webp);
  writeFileSync(
    resolve(publicDir, "scene.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "mesh.bin", byteLength: 12 }],
      images: [{ uri: "albedo.webp" }],
    }),
  );

  const findings = auditGltfAssets(directory);
  assert.equal(findings.some((finding) => finding.severity === "error"), false);
  assert.ok(findings.some((finding) => /buffer\[0\] resolved/.test(finding.message)));
  assert.ok(findings.some((finding) => /image\[0\] resolved/.test(finding.message)));
});

test("fails malformed, missing, remote, and escaping glTF dependencies", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(resolve(publicDir, "broken.gltf"), "{ definitely not json");
  writeFileSync(
    resolve(publicDir, "unsafe.gltf"),
    JSON.stringify({
      asset: { version: "1.0" },
      buffers: [
        { uri: "missing.bin", byteLength: 4 },
        { uri: ["https:", "", "cdn.example", "game.bin"].join("/"), byteLength: 4 },
        { uri: "../../outside.bin", byteLength: 4 },
      ],
    }),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /JSON parse failed/);
  assert.match(checklist, /asset\.version must be/);
  assert.match(checklist, /missing local file/);
  assert.match(checklist, /non-local URI/);
  assert.match(checklist, /escapes the project root/);
  assert.equal(main([directory]), 1);
});

test("validates GLB headers and JSON chunks", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  const jsonSource = JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4 }],
  });
  const jsonLength = Math.ceil(Buffer.byteLength(jsonSource) / 4) * 4;
  const json = Buffer.alloc(jsonLength, 0x20);
  json.write(jsonSource);
  const binary = Buffer.alloc(4);
  const glb = Buffer.alloc(12 + 8 + json.length + 8 + binary.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const binaryHeader = 20 + json.length;
  glb.writeUInt32LE(binary.length, binaryHeader);
  glb.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(glb, binaryHeader + 8);
  writeFileSync(resolve(publicDir, "valid.glb"), glb);
  writeFileSync(resolve(publicDir, "invalid.glb"), Buffer.from("not a glb"));

  const findings = auditGltfAssets(directory);
  assert.equal(
    findings.some((finding) => finding.path === "public/valid.glb" && finding.severity === "error"),
    false,
  );
  assert.ok(
    findings.some((finding) => finding.path === "public/invalid.glb" && finding.severity === "error"),
  );
});

test("requires a BIN chunk when GLB buffer[0] omits uri", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    resolve(publicDir, "missing-bin.glb"),
    makeGlb([
      {
        type: GLB_JSON_CHUNK,
        data: glbJson({ asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] }),
      },
    ]),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /omits uri but the GLB has no BIN chunk/);
});

test("enforces GLB alignment, chunk order, and JSON padding", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  const document = { asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] };
  writeFileSync(
    resolve(publicDir, "bad-padding.glb"),
    makeGlb([
      { type: GLB_JSON_CHUNK, data: glbJson({ asset: { version: "2.0" } }, 0) },
    ]),
  );
  writeFileSync(
    resolve(publicDir, "bad-order.glb"),
    makeGlb([
      { type: GLB_JSON_CHUNK, data: glbJson(document) },
      { type: 0x12345678, data: Buffer.alloc(4) },
      { type: GLB_BIN_CHUNK, data: Buffer.alloc(4) },
    ]),
  );
  writeFileSync(
    resolve(publicDir, "misaligned.glb"),
    makeGlb([{ type: GLB_JSON_CHUNK, data: Buffer.from("{} ") }]),
  );
  writeFileSync(
    resolve(publicDir, "duplicate-json.glb"),
    makeGlb([
      { type: GLB_JSON_CHUNK, data: glbJson({ asset: { version: "2.0" } }) },
      { type: GLB_JSON_CHUNK, data: glbJson({ asset: { version: "2.0" } }) },
    ]),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /JSON padding must use space/);
  assert.match(checklist, /BIN chunk must immediately follow/);
  assert.match(checklist, /length must be 4-byte aligned/);
  assert.match(checklist, /exactly one JSON chunk/);
});

test("checks GLB BIN length and zero padding", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    resolve(publicDir, "too-large.glb"),
    makeGlb([
      { type: GLB_JSON_CHUNK, data: glbJson({ asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] }) },
      { type: GLB_BIN_CHUNK, data: Buffer.alloc(8) },
    ]),
  );
  writeFileSync(
    resolve(publicDir, "bad-bin-padding.glb"),
    makeGlb([
      { type: GLB_JSON_CHUNK, data: glbJson({ asset: { version: "2.0" }, buffers: [{ byteLength: 3 }] }) },
      { type: GLB_BIN_CHUNK, data: Buffer.from([1, 2, 3, 9]) },
    ]),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /more than 3 padding bytes/);
  assert.match(checklist, /BIN padding bytes must be zero/);
});

test("strictly validates buffer and image data URIs case-insensitively", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    resolve(publicDir, "data-uris.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [
        { uri: "DATA:APPLICATION/OCTET-STREAM;BASE64,AQIDBA==", byteLength: 4 },
        { uri: "data:text/plain;base64,AQIDBA==", byteLength: 4 },
        { uri: "data:application/octet-stream;base64,***", byteLength: 4 },
        { uri: "data:application/octet-stream;base64,AQ==", byteLength: 4 },
        { uri: "data:application/octet-stream,%0G", byteLength: 1 },
        { uri: "data:;base64,AQ==", byteLength: 1 },
        { uri: "data:application/octet-stream;base64;charset=utf-8,AQ==", byteLength: 1 },
      ],
      images: [
        { uri: "data:image/png;base64,AQ==" },
        { uri: "data:application/octet-stream;base64,AQ==" },
      ],
    }),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /buffer\[0\] has embedded application\/octet-stream data \(4 bytes\)/);
  assert.match(checklist, /not a supported buffer type/);
  assert.match(checklist, /malformed base64 payload/);
  assert.match(checklist, /below required 4/);
  assert.match(checklist, /malformed percent escape/);
  assert.match(checklist, /must declare a media type/);
  assert.match(checklist, /base64 marker must be last/);
  assert.match(checklist, /not a supported image type/);
});

test("validates embedded image bufferViews, mime types, and storage", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    resolve(publicDir, "valid-image.glb"),
    makeGlb([
      {
        type: GLB_JSON_CHUNK,
        data: glbJson({
          asset: { version: "2.0" },
          buffers: [{ byteLength: 4 }],
          bufferViews: [{ buffer: 0, byteLength: 4 }],
          images: [{ bufferView: 0, mimeType: "image/png" }],
        }),
      },
      { type: GLB_BIN_CHUNK, data: Buffer.alloc(4) },
    ]),
  );
  writeFileSync(
    resolve(publicDir, "bad-image.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "data:application/octet-stream;base64,AQIDBA==", byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 3, byteLength: 2 }],
      images: [{ bufferView: 0 }, { uri: "data:image/png;base64,AQ==", bufferView: 0 }],
    }),
  );
  writeFileSync(
    resolve(publicDir, "no-image-storage.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteLength: 4 }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
    }),
  );

  const findings = auditGltfAssets(directory);
  assert.equal(
    findings.some((finding) => finding.path === "public/valid-image.glb" && finding.severity === "error"),
    false,
  );
  const checklist = formatAssetChecklist(findings).join("\n");
  assert.match(checklist, /range ends at 5, beyond buffer byteLength 4/);
  assert.match(checklist, /needs a supported image mimeType/);
  assert.match(checklist, /must define exactly one of uri or bufferView/);
  assert.match(checklist, /bufferView has no available binary storage/);
});

test("rejects zero-length buffers", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    resolve(publicDir, "empty.gltf"),
    JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "data:application/octet-stream;base64,", byteLength: 0 }] }),
  );
  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /byteLength must be a positive integer/);
});

test("rejects asset roots and dependencies that escape through symlinks", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  const outside = await mkdtemp(resolve(tmpdir(), "asset-audit-outside-"));
  temporaryDirectories.push(directory, outside);
  mkdirSync(resolve(outside, "root"), { recursive: true });
  symlinkSync(resolve(outside, "root"), resolve(directory, "public"), "dir");

  const assetsDir = resolve(directory, "assets");
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(resolve(outside, "outside.bin"), Buffer.alloc(4));
  symlinkSync(resolve(outside, "outside.bin"), resolve(assetsDir, "linked.bin"), "file");
  writeFileSync(
    resolve(assetsDir, "linked.gltf"),
    JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "linked.bin", byteLength: 4 }] }),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /asset root resolves through a symlink outside/);
  assert.match(checklist, /resolves through a symlink outside the project root/);
});

test("audits in-project symlink files and rejects unsafe symlink traversal", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  const outside = await mkdtemp(resolve(tmpdir(), "asset-audit-outside-"));
  temporaryDirectories.push(directory, outside);
  const publicDir = resolve(directory, "public");
  const sharedDir = resolve(directory, "shared");
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(resolve(sharedDir, "bad-source.gltf"), "{ invalid gltf");
  symlinkSync(resolve(sharedDir, "bad-source.gltf"), resolve(publicDir, "bad.gltf"), "file");
  writeFileSync(resolve(outside, "escaped.gltf"), JSON.stringify({ asset: { version: "2.0" } }));
  symlinkSync(resolve(outside, "escaped.gltf"), resolve(publicDir, "escaped.gltf"), "file");
  const nestedDir = resolve(directory, "nested-assets");
  mkdirSync(nestedDir, { recursive: true });
  symlinkSync(nestedDir, resolve(publicDir, "nested"), "dir");

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /public\/bad\.gltf: glTF JSON parse failed/);
  assert.match(checklist, /public\/escaped\.gltf: asset symlink resolves outside/);
  assert.match(checklist, /nested asset symlink directories are not traversed/);
});

test("rejects empty and signature-mismatched external images", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(resolve(publicDir, "empty.png"), Buffer.alloc(0));
  writeFileSync(resolve(publicDir, "fake.jpg"), Buffer.from("not a jpeg"));
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(resolve(publicDir, "valid.png"), pngHeader);
  writeFileSync(
    resolve(publicDir, "images.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      images: [{ uri: "empty.png" }, { uri: "fake.jpg" }, { uri: "valid.png" }],
    }),
  );

  const checklist = formatAssetChecklist(auditGltfAssets(directory)).join("\n");
  assert.match(checklist, /image\[0\].*is empty/);
  assert.match(checklist, /image\[1\].*does not match the image\/jpeg signature/);
  assert.match(checklist, /image\[2\] resolved to public\/valid\.png/);
});

test("rejects empty and signature-mismatched standalone textures", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const publicDir = resolve(directory, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(resolve(publicDir, "empty.png"), Buffer.alloc(0));
  writeFileSync(resolve(publicDir, "fake.webp"), Buffer.from("not webp"));
  writeFileSync(resolve(publicDir, "fake.ktx2"), Buffer.from("not ktx2"));
  writeFileSync(resolve(publicDir, "fake.basis"), Buffer.from("not basis"));
  writeFileSync(resolve(publicDir, "fake.hdr"), Buffer.from("not hdr"));
  writeFileSync(resolve(publicDir, "fake.exr"), Buffer.from("not exr"));

  const findings = auditGltfAssets(directory);
  const checklist = formatAssetChecklist(findings).join("\n");
  for (const file of ["empty.png", "fake.webp", "fake.ktx2", "fake.basis", "fake.hdr", "fake.exr"]) {
    assert.match(checklist, new RegExp(`${file.replace(".", "\\.")}.*does not match`));
  }
  assert.equal(findings.filter((finding) => finding.severity === "error").length, 6);
  assert.equal(main([directory]), 1);
});

test("rejects malformed --root options", () => {
  assert.equal(main(["--root"]), 2);
  assert.equal(main(["--root", "--strict"]), 2);
  assert.equal(main(["--root="]), 2);
});

test("fails nonexistent and non-directory project roots", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const regularFile = resolve(directory, "project.txt");
  writeFileSync(regularFile, "not a project");

  assert.match(formatAssetChecklist(auditGltfAssets(resolve(directory, "missing"))).join("\n"), /does not exist/);
  assert.match(formatAssetChecklist(auditGltfAssets(regularFile)).join("\n"), /not a directory/);
  assert.equal(main([resolve(directory, "missing")]), 1);
  assert.equal(main([regularFile]), 1);
});

test("fails explicitly configured missing asset roots while default roots remain optional", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const defaults = auditGltfAssets(directory);
  assert.equal(defaults.some((finding) => finding.severity === "error"), false);

  const explicit = formatAssetChecklist(auditGltfAssets(directory, ["missing-assets"])).join("\n");
  assert.match(explicit, /explicit asset root does not exist/);
  assert.equal(main([directory, "--root", "missing-assets"]), 1);
});

test("rejects custom asset roots outside the project", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-"));
  temporaryDirectories.push(directory);
  const findings = auditGltfAssets(directory, ["../outside"]);
  assert.ok(findings.some((finding) => /must stay inside/.test(finding.message)));
  assert.equal(findings.some((finding) => finding.severity === "error"), true);
});

test("runs the CLI main guard when invoked through a symbolic link", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-audit-main-link-"));
  temporaryDirectories.push(directory);
  const project = resolve(directory, "project");
  mkdirSync(project, { recursive: true });
  const linkedScript = join(directory, "audit-gltf-linked.ts");
  symlinkSync(resolve("scripts/audit-gltf-assets.ts"), linkedScript);

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", linkedScript, project],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /asset audit:/);
  assert.match(result.stdout, /procedural-only/);
});
