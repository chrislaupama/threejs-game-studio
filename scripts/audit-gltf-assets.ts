#!/usr/bin/env node
/** Validate local glTF/GLB dependencies and flag oversized game assets. */

import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const TEXTURE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".basis", ".hdr", ".exr",
]);
const LARGE_TEXTURE_BYTES = 2_000_000;
const LARGE_MODEL_BYTES = 8_000_000;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const MAX_GLB_JSON_BYTES = 32 * 1024 * 1024;
const BUFFER_DATA_MEDIA_TYPES = new Set(["application/octet-stream", "application/gltf-buffer"]);
const IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/ktx2",
]);

export type AssetFinding = {
  path: string;
  kind: "model" | "texture" | "dependency" | "note";
  severity: "info" | "warn" | "error";
  message: string;
};

type GltfDocument = {
  asset?: { version?: unknown };
  meshes?: unknown[];
  materials?: unknown[];
  images?: Array<{ uri?: unknown; bufferView?: unknown; mimeType?: unknown }>;
  buffers?: Array<{ uri?: unknown; byteLength?: unknown }>;
  bufferViews?: Array<{
    buffer?: unknown;
    byteOffset?: unknown;
    byteLength?: unknown;
  }>;
};

type DataUriRules = {
  allowedMediaTypes?: ReadonlySet<string>;
  mediaTypeLabel?: string;
  minimumDecodedBytes?: number;
  minimumFileBytes?: number;
  expectedExternalMediaType?: string;
  validateExternalImageSignature?: boolean;
};

type ParsedDataUri = {
  mediaType: string;
  bytes: Buffer;
};

type GlbBinaryChunk = {
  byteLength: number;
  tail: Buffer;
};

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function readExactly(fd: number, length: number, position: number): Buffer | null {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(fd, buffer, offset, length - offset, position + offset);
    if (count === 0) return null;
    offset += count;
  }
  return buffer;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function decodePercentPayload(payload: string): Buffer {
  const bytes: number[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    if (code === 0x25) {
      const hex = payload.slice(index + 1, index + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) throw new Error("malformed percent escape");
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      if (code > 0x7e || code < 0x21) {
        throw new Error("non-ASCII and whitespace bytes must be percent-encoded");
      }
      bytes.push(code);
    }
  }
  return Buffer.from(bytes);
}

function parseDataUri(uri: string, rules: DataUriRules): ParsedDataUri {
  const comma = uri.indexOf(",");
  if (comma < 0 || !/^data:/i.test(uri)) throw new Error("expected data:[media-type][;base64],payload");
  const metadata = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (!metadata) throw new Error("data URI must declare a media type");
  const parts = metadata.split(";");
  const mediaType = parts.shift()!.toLowerCase();
  if (!mediaType) throw new Error("data URI must declare a media type");
  if (!/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i.test(mediaType)) {
    throw new Error(`invalid media type ${JSON.stringify(mediaType)}`);
  }
  let base64 = false;
  for (const [index, part] of parts.entries()) {
    if (/^base64$/i.test(part)) {
      if (base64) throw new Error("duplicate base64 marker");
      if (index !== parts.length - 1) throw new Error("base64 marker must be last");
      base64 = true;
    } else if (!/^[a-z\d!#$&^_.+-]+=[^;\s]+$/i.test(part)) {
      throw new Error(`invalid data URI parameter ${JSON.stringify(part)}`);
    }
  }
  if (rules.allowedMediaTypes && !rules.allowedMediaTypes.has(mediaType)) {
    throw new Error(
      `media type ${JSON.stringify(mediaType)} is not a supported ${rules.mediaTypeLabel ?? "glTF resource"} type`,
    );
  }

  let bytes: Buffer;
  if (base64) {
    if (
      !/^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i.test(payload)
    ) {
      throw new Error("malformed base64 payload");
    }
    bytes = Buffer.from(payload, "base64");
  } else {
    bytes = decodePercentPayload(payload);
  }
  if (rules.minimumDecodedBytes !== undefined && bytes.length < rules.minimumDecodedBytes) {
    throw new Error(
      `decoded payload is ${bytes.length} bytes, below required ${rules.minimumDecodedBytes}`,
    );
  }
  return { mediaType, bytes };
}

function walkFiles(
  root: string,
  projectRoot: string,
  projectRootReal: string,
  findings: AssetFinding[],
  files: string[] = [],
): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, projectRoot, projectRootReal, findings, files);
    else if (entry.isFile()) files.push(full);
    else if (entry.isSymbolicLink()) {
      const rel = posixPath(relative(projectRoot, full));
      let canonical: string;
      try {
        canonical = realpathSync(full);
      } catch {
        findings.push(modelFinding(rel, "error", "asset symlink is broken", "dependency"));
        continue;
      }
      if (!isWithin(projectRootReal, canonical)) {
        findings.push(
          modelFinding(rel, "error", "asset symlink resolves outside the project root", "dependency"),
        );
        continue;
      }
      const target = statSync(canonical);
      if (target.isFile()) {
        files.push(full);
      } else if (target.isDirectory()) {
        findings.push(
          modelFinding(
            rel,
            "error",
            "nested asset symlink directories are not traversed; configure the canonical directory as an asset root",
            "dependency",
          ),
        );
      } else {
        findings.push(modelFinding(rel, "error", "asset symlink target is not a regular file", "dependency"));
      }
    }
  }
  return files;
}

function externalImageMediaTypes(path: string, declared?: string): string[] {
  const byExtension: Record<string, string> = {
    ".avif": "image/avif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".ktx2": "image/ktx2",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  return [...new Set([declared?.toLowerCase(), byExtension[extname(path).toLowerCase()]].filter(Boolean))] as string[];
}

function hasImageSignature(header: Buffer, mediaType: string): boolean {
  if (mediaType === "image/png") {
    return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mediaType === "image/jpeg") return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (mediaType === "image/webp") {
    return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mediaType === "image/ktx2") {
    return header.subarray(0, 12).equals(Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mediaType === "image/avif") {
    const brand = header.subarray(4, 12).toString("ascii");
    return brand.startsWith("ftyp") && (brand.endsWith("avif") || brand.endsWith("avis"));
  }
  return true;
}

function inspectExternalImageSignature(path: string, declaredMediaType?: string): string | null {
  const expectedTypes = externalImageMediaTypes(path, declaredMediaType);
  if (expectedTypes.length === 0) return null;
  const fd = openSync(path, "r");
  try {
    const headerLength = Math.min(16, fstatSync(fd).size);
    const header = headerLength > 0 ? readExactly(fd, headerLength, 0) ?? Buffer.alloc(0) : Buffer.alloc(0);
    for (const mediaType of expectedTypes) {
      if (!hasImageSignature(header, mediaType)) return `file does not match the ${mediaType} signature`;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function inspectStandaloneTextureSignature(path: string, extension: string): string | null {
  const fd = openSync(path, "r");
  try {
    const headerLength = Math.min(16, fstatSync(fd).size);
    const header = headerLength > 0
      ? readExactly(fd, headerLength, 0) ?? Buffer.alloc(0)
      : Buffer.alloc(0);
    const matches = (() => {
      if (extension === ".png") return hasImageSignature(header, "image/png");
      if (extension === ".jpg" || extension === ".jpeg") {
        return hasImageSignature(header, "image/jpeg");
      }
      if (extension === ".webp") return hasImageSignature(header, "image/webp");
      if (extension === ".ktx2") return hasImageSignature(header, "image/ktx2");
      // The Basis Universal native container begins with the little-endian
      // 16-bit signature value whose on-disk bytes spell `sB`.
      if (extension === ".basis") return header.length >= 2 && header[0] === 0x73 && header[1] === 0x42;
      // Three.js HDRLoader requires the Radiance program token on the first line.
      if (extension === ".hdr") return header.subarray(0, 2).toString("ascii") === "#?";
      // OpenEXR's fixed 32-bit magic number is 20000630 (little endian on disk).
      if (extension === ".exr") {
        return header.subarray(0, 4).equals(Buffer.from([0x76, 0x2f, 0x31, 0x01]));
      }
      return true;
    })();
    return matches ? null : `file does not match the ${extension} signature`;
  } finally {
    closeSync(fd);
  }
}

function siblingKtx2(path: string): boolean {
  const base = path.replace(/\.[^.]+$/, "");
  return existsSync(`${base}.ktx2`) || existsSync(`${base}.KTX2`);
}

function modelFinding(
  path: string,
  severity: AssetFinding["severity"],
  message: string,
  kind: AssetFinding["kind"] = "model",
): AssetFinding {
  return { path, kind, severity, message };
}

function inspectDependencyUri(
  projectRoot: string,
  projectRootReal: string,
  modelPath: string,
  modelRel: string,
  uriValue: unknown,
  label: string,
  declaredBytes?: unknown,
  dataUriRules: DataUriRules = {},
): AssetFinding[] {
  if (typeof uriValue !== "string" || uriValue.trim() === "") {
    return [modelFinding(modelRel, "error", `${label} has an empty or non-string uri`, "dependency")];
  }
  const uri = uriValue.trim();
  if (/^data:/i.test(uri)) {
    try {
      const minimumDecodedBytes =
        typeof declaredBytes === "number" && Number.isInteger(declaredBytes)
          ? declaredBytes
          : dataUriRules.minimumDecodedBytes;
      const parsed = parseDataUri(uri, { ...dataUriRules, minimumDecodedBytes });
      return [
        modelFinding(
          modelRel,
          "info",
          `${label} has embedded ${parsed.mediaType} data (${parsed.bytes.length} bytes)`,
          "dependency",
        ),
      ];
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return [modelFinding(modelRel, "error", `${label} has invalid data URI: ${detail}`, "dependency")];
    }
  }
  if (uri.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(uri)) {
    return [
      modelFinding(
        modelRel,
        "error",
        `${label} uses non-local URI ${JSON.stringify(uri)}; ship the dependency with the game`,
        "dependency",
      ),
    ];
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0]!);
  } catch {
    return [modelFinding(modelRel, "error", `${label} has malformed URI encoding: ${uri}`, "dependency")];
  }
  if (!decoded) {
    return [modelFinding(modelRel, "error", `${label} URI does not name a local file: ${uri}`, "dependency")];
  }
  const dependency = resolve(dirname(modelPath), decoded);
  if (!isWithin(projectRoot, dependency)) {
    return [
      modelFinding(
        modelRel,
        "error",
        `${label} escapes the project root: ${uri}`,
        "dependency",
      ),
    ];
  }
  const dependencyRel = posixPath(relative(projectRoot, dependency));
  if (!existsSync(dependency) || !statSync(dependency).isFile()) {
    return [
      modelFinding(
        modelRel,
        "error",
        `${label} is missing local file ${dependencyRel}`,
        "dependency",
      ),
    ];
  }
  const dependencyReal = realpathSync(dependency);
  if (!isWithin(projectRootReal, dependencyReal)) {
    return [
      modelFinding(
        modelRel,
        "error",
        `${label} resolves through a symlink outside the project root: ${uri}`,
        "dependency",
      ),
    ];
  }
  const actualBytes = statSync(dependency).size;
  if (dataUriRules.minimumFileBytes !== undefined && actualBytes < dataUriRules.minimumFileBytes) {
    return [
      modelFinding(
        modelRel,
        "error",
        `${label} ${dependencyRel} is empty; external image files must contain data`,
        "dependency",
      ),
    ];
  }
  if (dataUriRules.validateExternalImageSignature) {
    const signatureError = inspectExternalImageSignature(dependency, dataUriRules.expectedExternalMediaType);
    if (signatureError) {
      return [modelFinding(modelRel, "error", `${label} ${dependencyRel} ${signatureError}`, "dependency")];
    }
  }
  if (typeof declaredBytes === "number" && Number.isFinite(declaredBytes)) {
    if (actualBytes < declaredBytes) {
      return [
        modelFinding(
          modelRel,
          "error",
          `${label} ${dependencyRel} is ${actualBytes} bytes, below declared byteLength ${declaredBytes}`,
          "dependency",
        ),
      ];
    }
  }
  return [modelFinding(modelRel, "info", `${label} resolved to ${dependencyRel}`, "dependency")];
}

function validateGltfDocument(
  data: GltfDocument,
  projectRoot: string,
  projectRootReal: string,
  modelPath: string,
  modelRel: string,
  container: "gltf" | "glb",
  binaryChunk: GlbBinaryChunk | null = null,
): AssetFinding[] {
  const findings: AssetFinding[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [modelFinding(modelRel, "error", "glTF root must be a JSON object")];
  }
  if (data.asset?.version !== "2.0") {
    findings.push(
      modelFinding(modelRel, "error", `asset.version must be \"2.0\" (found ${JSON.stringify(data.asset?.version)})`),
    );
  }
  findings.push(
    modelFinding(
      modelRel,
      "info",
      `meshes=${Array.isArray(data.meshes) ? data.meshes.length : 0} materials=${Array.isArray(data.materials) ? data.materials.length : 0} images=${Array.isArray(data.images) ? data.images.length : 0}`,
      "note",
    ),
  );

  const buffers = Array.isArray(data.buffers) ? data.buffers : [];
  if (data.buffers !== undefined && !Array.isArray(data.buffers)) {
    findings.push(modelFinding(modelRel, "error", "buffers must be an array"));
  } else {
    for (const [index, buffer] of buffers.entries()) {
      if (!buffer || typeof buffer !== "object") {
        findings.push(modelFinding(modelRel, "error", `buffer[${index}] must be an object`));
        continue;
      }
      if (!isPositiveInteger(buffer.byteLength)) {
        findings.push(modelFinding(modelRel, "error", `buffer[${index}].byteLength must be a positive integer`));
      }
      if (buffer.uri === undefined) {
        if (container === "gltf") {
          findings.push(modelFinding(modelRel, "error", `buffer[${index}] in .gltf is missing uri`, "dependency"));
        } else if (index > 0) {
          findings.push(modelFinding(modelRel, "error", `only GLB buffer[0] may omit uri`, "dependency"));
        } else if (!binaryChunk) {
          findings.push(modelFinding(modelRel, "error", "GLB buffer[0] omits uri but the GLB has no BIN chunk", "dependency"));
        } else if (isPositiveInteger(buffer.byteLength)) {
          if (binaryChunk.byteLength < buffer.byteLength) {
            findings.push(
              modelFinding(
                modelRel,
                "error",
                `GLB BIN chunk is ${binaryChunk.byteLength} bytes, below declared byteLength ${buffer.byteLength}`,
                "dependency",
              ),
            );
          } else if (binaryChunk.byteLength > buffer.byteLength + 3) {
            findings.push(
              modelFinding(
                modelRel,
                "error",
                `GLB BIN chunk exceeds declared byteLength ${buffer.byteLength} by more than 3 padding bytes`,
                "dependency",
              ),
            );
          } else {
            const paddingBytes = binaryChunk.byteLength - buffer.byteLength;
            if (paddingBytes > 0 && !binaryChunk.tail.subarray(-paddingBytes).every((byte) => byte === 0)) {
              findings.push(modelFinding(modelRel, "error", "GLB BIN padding bytes must be zero", "dependency"));
            }
          }
        }
      } else {
        findings.push(
          ...inspectDependencyUri(
            projectRoot,
            projectRootReal,
            modelPath,
            modelRel,
            buffer.uri,
            `buffer[${index}]`,
            buffer.byteLength,
            {
              allowedMediaTypes: BUFFER_DATA_MEDIA_TYPES,
              mediaTypeLabel: "buffer",
            },
          ),
        );
      }
    }
  }

  if (binaryChunk && !(buffers[0] && typeof buffers[0] === "object" && buffers[0].uri === undefined)) {
    findings.push(modelFinding(modelRel, "error", "GLB BIN chunk has no matching buffer[0] without a uri", "dependency"));
  }

  const bufferViews = Array.isArray(data.bufferViews) ? data.bufferViews : [];
  if (data.bufferViews !== undefined && !Array.isArray(data.bufferViews)) {
    findings.push(modelFinding(modelRel, "error", "bufferViews must be an array"));
  } else {
    for (const [index, view] of bufferViews.entries()) {
      if (!view || typeof view !== "object") {
        findings.push(modelFinding(modelRel, "error", `bufferView[${index}] must be an object`));
        continue;
      }
      if (!isNonNegativeInteger(view.buffer) || view.buffer >= buffers.length) {
        findings.push(modelFinding(modelRel, "error", `bufferView[${index}].buffer must reference an existing buffer`));
      }
      const byteOffset = view.byteOffset === undefined ? 0 : view.byteOffset;
      if (!isNonNegativeInteger(byteOffset)) {
        findings.push(modelFinding(modelRel, "error", `bufferView[${index}].byteOffset must be a non-negative integer`));
      }
      if (!isPositiveInteger(view.byteLength)) {
        findings.push(modelFinding(modelRel, "error", `bufferView[${index}].byteLength must be a positive integer`));
      }
      const buffer = isNonNegativeInteger(view.buffer) ? buffers[view.buffer] : undefined;
      if (
        buffer &&
        typeof buffer === "object" &&
        isPositiveInteger(buffer.byteLength) &&
        isNonNegativeInteger(byteOffset) &&
        isPositiveInteger(view.byteLength) &&
        byteOffset + view.byteLength > buffer.byteLength
      ) {
        findings.push(
          modelFinding(
            modelRel,
            "error",
            `bufferView[${index}] range ends at ${byteOffset + view.byteLength}, beyond buffer byteLength ${buffer.byteLength}`,
          ),
        );
      }
    }
  }

  if (data.images !== undefined && !Array.isArray(data.images)) {
    findings.push(modelFinding(modelRel, "error", "images must be an array"));
  } else {
    for (const [index, image] of (data.images ?? []).entries()) {
      if (!image || typeof image !== "object") {
        findings.push(modelFinding(modelRel, "error", `image[${index}] must be an object`));
        continue;
      }
      const hasUri = image.uri !== undefined;
      const hasBufferView = image.bufferView !== undefined;
      if (hasUri === hasBufferView) {
        findings.push(
          modelFinding(modelRel, "error", `image[${index}] must define exactly one of uri or bufferView`, "dependency"),
        );
      }
      if (hasUri) {
        const declaredMimeType = typeof image.mimeType === "string" ? image.mimeType.toLowerCase() : undefined;
        if (image.mimeType !== undefined && (!declaredMimeType || !IMAGE_MEDIA_TYPES.has(declaredMimeType))) {
          findings.push(modelFinding(modelRel, "error", `image[${index}].mimeType is not supported`, "dependency"));
        }
        findings.push(
          ...inspectDependencyUri(
            projectRoot,
            projectRootReal,
            modelPath,
            modelRel,
            image.uri,
            `image[${index}]`,
            undefined,
            {
              allowedMediaTypes: IMAGE_MEDIA_TYPES,
              mediaTypeLabel: "image",
              minimumDecodedBytes: 1,
              minimumFileBytes: 1,
              expectedExternalMediaType: declaredMimeType,
              validateExternalImageSignature: true,
            },
          ),
        );
      }
      if (hasBufferView && (!isNonNegativeInteger(image.bufferView) || image.bufferView >= bufferViews.length)) {
        findings.push(
          modelFinding(modelRel, "error", `image[${index}].bufferView must reference an existing bufferView`, "dependency"),
        );
      }
      if (hasBufferView) {
        if (typeof image.mimeType !== "string" || !IMAGE_MEDIA_TYPES.has(image.mimeType.toLowerCase())) {
          findings.push(
            modelFinding(
              modelRel,
              "error",
              `image[${index}] embedded by bufferView needs a supported image mimeType`,
              "dependency",
            ),
          );
        }
        if (isNonNegativeInteger(image.bufferView) && image.bufferView < bufferViews.length) {
          const view = bufferViews[image.bufferView];
          const buffer = view && typeof view === "object" && isNonNegativeInteger(view.buffer)
            ? buffers[view.buffer]
            : undefined;
          if (!buffer || typeof buffer !== "object") {
            findings.push(modelFinding(modelRel, "error", `image[${index}] bufferView has no valid backing buffer`, "dependency"));
          } else if (buffer.uri === undefined && (container !== "glb" || view?.buffer !== 0 || !binaryChunk)) {
            findings.push(modelFinding(modelRel, "error", `image[${index}] bufferView has no available binary storage`, "dependency"));
          }
        }
      }
    }
  }
  return findings;
}

function inspectGltfJson(projectRoot: string, projectRootReal: string, path: string, rel: string): AssetFinding[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [modelFinding(rel, "error", `glTF JSON parse failed: ${detail}`)];
  }
  return validateGltfDocument(data as GltfDocument, projectRoot, projectRootReal, path, rel, "gltf");
}

function inspectGlb(projectRoot: string, projectRootReal: string, path: string, rel: string): AssetFinding[] {
  const findings: AssetFinding[] = [];
  const fd = openSync(path, "r");
  try {
    const fileBytes = fstatSync(fd).size;
    if (fileBytes < 12) return [modelFinding(rel, "error", "GLB is shorter than its 12-byte header")];
    if (fileBytes % 4 !== 0) findings.push(modelFinding(rel, "error", "GLB file length must be 4-byte aligned"));
    const header = readExactly(fd, 12, 0)!;
    if (header.readUInt32LE(0) !== GLB_MAGIC) return [modelFinding(rel, "error", "GLB magic must be glTF")];
    const version = header.readUInt32LE(4);
    const declaredLength = header.readUInt32LE(8);
    if (version !== 2) findings.push(modelFinding(rel, "error", `GLB version must be 2 (found ${version})`));
    if (declaredLength !== fileBytes) {
      findings.push(
        modelFinding(rel, "error", `GLB header length ${declaredLength} does not match file size ${fileBytes}`),
      );
    }

    const chunks: Array<{ type: number; length: number; dataOffset: number }> = [];
    let offset = 12;
    while (offset < fileBytes) {
      const chunkHeader = readExactly(fd, 8, offset);
      if (!chunkHeader) {
        findings.push(modelFinding(rel, "error", "GLB has a truncated chunk header"));
        return findings;
      }
      const length = chunkHeader.readUInt32LE(0);
      const type = chunkHeader.readUInt32LE(4);
      const dataOffset = offset + 8;
      const end = dataOffset + length;
      if (length % 4 !== 0) findings.push(modelFinding(rel, "error", `GLB chunk[${chunks.length}] length must be 4-byte aligned`));
      if (end > fileBytes) {
        findings.push(modelFinding(rel, "error", `GLB chunk overruns file by ${end - fileBytes} bytes`));
        return findings;
      }
      chunks.push({ type, length, dataOffset });
      offset = end;
    }
    if (chunks.length === 0 || chunks[0]!.type !== GLB_JSON_CHUNK) {
      findings.push(modelFinding(rel, "error", "GLB first chunk must be JSON"));
      return findings;
    }
    const jsonChunks = chunks.filter((chunk) => chunk.type === GLB_JSON_CHUNK);
    if (jsonChunks.length !== 1) findings.push(modelFinding(rel, "error", "GLB must contain exactly one JSON chunk"));
    const binaryChunks = chunks.filter((chunk) => chunk.type === GLB_BIN_CHUNK);
    if (binaryChunks.length > 1) findings.push(modelFinding(rel, "error", "GLB may contain at most one BIN chunk"));
    if (binaryChunks[0] && chunks[1] !== binaryChunks[0]) {
      findings.push(modelFinding(rel, "error", "GLB BIN chunk must immediately follow the JSON chunk"));
    }

    const jsonChunk = chunks[0]!;
    if (jsonChunk.length > MAX_GLB_JSON_BYTES) {
      findings.push(modelFinding(rel, "error", `GLB JSON chunk exceeds ${MAX_GLB_JSON_BYTES} byte audit limit`));
      return findings;
    }
    const jsonBytes = readExactly(fd, jsonChunk.length, jsonChunk.dataOffset);
    if (!jsonBytes) {
      findings.push(modelFinding(rel, "error", "GLB JSON chunk is truncated"));
      return findings;
    }
    const closingBrace = jsonBytes.lastIndexOf(0x7d);
    if (closingBrace < 0) {
      findings.push(modelFinding(rel, "error", "GLB JSON chunk must contain an object"));
      return findings;
    }
    if (!jsonBytes.subarray(closingBrace + 1).every((byte) => byte === 0x20)) {
      findings.push(modelFinding(rel, "error", "GLB JSON padding must use space (0x20) bytes"));
    }

    let data: unknown;
    try {
      const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes.subarray(0, closingBrace + 1));
      data = JSON.parse(jsonText);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      findings.push(modelFinding(rel, "error", `GLB JSON chunk parse failed: ${detail}`));
      return findings;
    }

    const binaryChunkMeta = binaryChunks[0];
    let binaryChunk: GlbBinaryChunk | null = null;
    if (binaryChunkMeta) {
      const tailLength = Math.min(3, binaryChunkMeta.length);
      binaryChunk = {
        byteLength: binaryChunkMeta.length,
        tail: tailLength > 0
          ? readExactly(fd, tailLength, binaryChunkMeta.dataOffset + binaryChunkMeta.length - tailLength) ?? Buffer.alloc(0)
          : Buffer.alloc(0),
      };
    }
    findings.push(
      ...validateGltfDocument(
        data as GltfDocument,
        projectRoot,
        projectRootReal,
        path,
        rel,
        "glb",
        binaryChunk,
      ),
    );
    return findings;
  } finally {
    closeSync(fd);
  }
}

export function auditGltfAssets(
  projectRootInput: string,
  roots?: string[],
): AssetFinding[] {
  const projectRoot = resolve(projectRootInput);
  const findings: AssetFinding[] = [];
  if (!existsSync(projectRoot)) {
    return [modelFinding(".", "error", `project root does not exist: ${projectRoot}`, "note")];
  }
  if (!statSync(projectRoot).isDirectory()) {
    return [modelFinding(".", "error", `project root is not a directory: ${projectRoot}`, "note")];
  }
  const projectRootReal = realpathSync(projectRoot);
  const files = new Set<string>();
  // Cover the two common Vite asset layouts plus a project-root asset folder.
  const configuredRoots = roots ?? ["public", "assets", "src/assets"];
  const rootsAreExplicit = roots !== undefined;

  for (const rootName of configuredRoots) {
    const root = resolve(projectRoot, rootName);
    if (!isWithin(projectRoot, root)) {
      findings.push(modelFinding(rootName, "error", "asset root must stay inside the project", "note"));
      continue;
    }
    if (!existsSync(root)) {
      if (rootsAreExplicit) {
        findings.push(
          modelFinding(rootName, "error", "explicit asset root does not exist", "note"),
        );
      }
      continue;
    }
    if (!statSync(root).isDirectory()) {
      findings.push(modelFinding(posixPath(relative(projectRoot, root)), "error", "asset root is not a directory", "note"));
      continue;
    }
    const rootReal = realpathSync(root);
    if (!isWithin(projectRootReal, rootReal)) {
      findings.push(
        modelFinding(
          posixPath(relative(projectRoot, root)),
          "error",
          "asset root resolves through a symlink outside the project",
          "note",
        ),
      );
      continue;
    }
    for (const file of walkFiles(root, projectRoot, projectRootReal, findings)) files.add(file);
  }

  let assetCount = 0;
  for (const file of [...files].sort()) {
    const ext = extname(file).toLowerCase();
    const rel = posixPath(relative(projectRoot, file));
    const size = statSync(file).size;
    if (MODEL_EXTENSIONS.has(ext)) {
      assetCount += 1;
      findings.push(
        modelFinding(
          rel,
          size > LARGE_MODEL_BYTES ? "warn" : "info",
          size > LARGE_MODEL_BYTES
            ? `GLB/glTF is ${(size / 1e6).toFixed(1)}MB — consider Meshopt/Draco and LOD`
            : `model ${(size / 1024).toFixed(1)}KB`,
        ),
      );
      findings.push(
        ...(ext === ".gltf"
          ? inspectGltfJson(projectRoot, projectRootReal, file, rel)
          : inspectGlb(projectRoot, projectRootReal, file, rel)),
      );
    } else if (TEXTURE_EXTENSIONS.has(ext)) {
      assetCount += 1;
      const isCompressed = ext === ".ktx2" || ext === ".basis";
      const signatureError = inspectStandaloneTextureSignature(file, ext);
      if (signatureError) {
        findings.push({
          path: rel,
          kind: "texture",
          severity: "error",
          message: signatureError,
        });
        continue;
      }
      findings.push({
        path: rel,
        kind: "texture",
        severity: !isCompressed && size > LARGE_TEXTURE_BYTES && !siblingKtx2(file) ? "warn" : "info",
        message:
          !isCompressed && size > LARGE_TEXTURE_BYTES && !siblingKtx2(file)
            ? `large texture ${(size / 1e6).toFixed(1)}MB without sibling .ktx2 — confirm colorSpace and compression plan`
            : `texture ${(size / 1024).toFixed(1)}KB${isCompressed ? " (compressed)" : ""}`,
      });
    }
  }
  if (assetCount === 0 && !findings.some((finding) => finding.severity === "error")) {
    findings.push({
      path: ".",
      kind: "note",
      severity: "info",
      message: "no glTF/GLB/texture assets found under configured roots — procedural-only is fine if intentional",
    });
  }
  return findings;
}

export function formatAssetChecklist(findings: AssetFinding[]): string[] {
  return findings.map((finding) => `- [${finding.severity}] ${finding.path}: ${finding.message}`);
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(
      "usage: audit-gltf-assets.ts [project] [--root <dir>]... [--strict]\n" +
        "  Validate local glTF/GLB dependencies and inspect model/texture budgets.\n" +
        "  Errors always fail; --strict also fails on warnings.",
    );
    return 0;
  }
  const roots: string[] = [];
  const positionals: string[] = [];
  let strict = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--strict") strict = true;
    else if (argument === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) {
        console.error("audit-gltf-assets.ts: --root requires a value");
        return 2;
      }
      roots.push(value);
    } else if (argument.startsWith("--root=")) {
      const value = argument.slice("--root=".length);
      if (!value || value.startsWith("-")) {
        console.error("audit-gltf-assets.ts: --root requires a value");
        return 2;
      }
      roots.push(value);
    } else if (argument.startsWith("-")) {
      console.error(`audit-gltf-assets.ts: unrecognized arguments: ${argument}`);
      return 2;
    } else positionals.push(argument);
  }
  if (positionals.length > 1) {
    console.error(`audit-gltf-assets.ts: unrecognized arguments: ${positionals.slice(1).join(" ")}`);
    return 2;
  }
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const project = resolve(invocationDirectory, positionals[0] ?? ".");
  const findings = auditGltfAssets(project, roots.length > 0 ? roots : undefined);
  for (const line of formatAssetChecklist(findings)) console.log(line);
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warns = findings.filter((finding) => finding.severity === "warn").length;
  console.log(`asset audit: ${findings.length} findings (${errors} errors, ${warns} warnings)`);
  return errors > 0 || (strict && warns > 0) ? 1 : 0;
}

const invokedAsMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedAsMain) process.exitCode = main();
