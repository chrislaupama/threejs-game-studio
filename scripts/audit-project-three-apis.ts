#!/usr/bin/env node
/**
 * Scan a game project for stale Three.js API patterns (r185+ denylist).
 * Does not require equality to any pinned skill baseline.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SKIP_DIRS = new Set([
  ".git",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

// Generated games carry this auditor as release tooling. Scanning its own
// denylist would make every freshly generated project fail on the words used
// to describe deprecated APIs. Keep the exclusion exact so ordinary gameplay
// and build scripts elsewhere remain in scope.
const SKIP_SOURCE_FILES = new Set(["scripts/audit-project-three-apis.ts"]);

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".vue", ".svelte", ".astro",
]);

export const DENYLIST_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["deprecated THREE.Clock timing", /\bClock\b/],
  ["removed renderer.outputEncoding", /\.outputEncoding\b/],
  [
    "removed Texture.encoding; use colorSpace",
    /\b(?:texture|map|[A-Za-z_$][\w$]*(?:Texture|Map))\.encoding\b/i,
  ],
  ["removed PointerLockControls.getObject(); use object", /\.getObject\s*\(/],
  ["removed color encoding constant", /\b(?:sRGBEncoding|LinearEncoding|GammaEncoding)\b/],
  ["removed legacy lighting switch", /\.(?:physicallyCorrectLights|useLegacyLights)\b/],
  ["removed gamma output property", /\.(?:gammaOutput|gammaFactor)\b/],
  ["removed WebGL1Renderer", /\bWebGL1Renderer\b/],
  ["removed WebGLMultisampleRenderTarget", /\bWebGLMultisampleRenderTarget\b/],
  ["removed legacy Geometry/Face3", /\b(?:THREE\.)?(?:Geometry|Face3)\b/],
  ["deprecated RGBELoader compatibility alias", /\bRGBELoader\b/],
  ["PCFSoftShadowMap is deprecated", /\bPCFSoftShadowMap\b/],
  ["WebGPU path mixes EffectComposer", /\bEffectComposer\b/],
  ["WebGPU path mixes ShaderMaterial", /\bShaderMaterial\b/],
  ["WebGPU path mixes RawShaderMaterial", /\bRawShaderMaterial\b/],
  ["WebGPU path mixes onBeforeCompile", /\.onBeforeCompile\b/],
  [
    "deprecated renderer or pipeline async method",
    /\.(?:renderAsync|clearAsync|clearColorAsync|clearDepthAsync|clearStencilAsync|hasFeatureAsync|initTextureAsync)\s*\(/,
  ],
  ["removed WebGPURenderer.waitForGPU", /\.waitForGPU\s*\(/],
  ["deprecated SVGLoader.createShapes", /\bSVGLoader\.createShapes\s*\(/],
  ["renamed mergeBufferGeometries", /\bmergeBufferGeometries\s*\(/],
  ["renamed mergeBufferAttributes", /\bmergeBufferAttributes\s*\(/],
];

export interface ApiFinding {
  path: string;
  line: number;
  reason: string;
  excerpt: string;
}

function posixPath(path: string): string {
  return path.split(sep).join("/");
}

function relativePath(root: string, path: string): string {
  return posixPath(relative(root, path)) || ".";
}

function lineFor(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function excerptFor(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextNewline = text.indexOf("\n", offset);
  const end = nextNewline < 0 ? text.length : nextNewline;
  return text.slice(start, end).trim().slice(0, 180);
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const matches: RegExpExecArray[] = [];
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    matches.push(match);
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return matches;
}

/** Strip comments and string literals so denylist scans ignore documentation. */
export function stripCommentsAndStrings(text: string): string {
  const output = text.split("");
  let index = 0;
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";
  let quote = "";
  while (index < text.length) {
    const character = text[index]!;
    const following = text[index + 1] ?? "";
    if (state === "code") {
      if (character === "/" && following === "/") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "line-comment";
      } else if (character === "/" && following === "*") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "block-comment";
      } else if (character === "'" || character === '"' || character === "`") {
        quote = character;
        output[index] = " ";
        index += 1;
        state = "string";
      } else index += 1;
    } else if (state === "line-comment") {
      if (character === "\n") state = "code";
      else output[index] = " ";
      index += 1;
    } else if (state === "block-comment") {
      if (character === "*" && following === "/") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "code";
      } else {
        if (character !== "\n") output[index] = " ";
        index += 1;
      }
    } else if (character === "\\" && following) {
      output[index] = " ";
      if (following !== "\n") output[index + 1] = " ";
      index += 2;
    } else if (character === quote) {
      output[index] = " ";
      index += 1;
      state = "code";
    } else {
      if (character !== "\n") output[index] = " ";
      index += 1;
    }
  }
  const masked = output.join("").split("");

  // A template's literal chunks are documentation/data, but its `${ ... }`
  // substitutions execute. The lexical pass above intentionally masks the
  // whole template; restore each substitution after recursively masking any
  // strings, comments, or nested templates inside that expression.
  const source = ts.createSourceFile(
    "denylist-scan.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const restoreTemplateExpressions = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        const start = span.expression.getStart(source);
        const end = span.expression.end;
        const expression = stripCommentsAndStrings(text.slice(start, end));
        for (let offset = 0; offset < expression.length; offset += 1) {
          masked[start + offset] = expression[offset]!;
        }
      }
      return;
    }
    ts.forEachChild(node, restoreTemplateExpressions);
  };
  restoreTemplateExpressions(source);
  return masked.join("");
}

interface SourceWalk {
  files: string[];
  findings: ApiFinding[];
}

function walkSourceFiles(root: string): SourceWalk {
  const files: string[] = [];
  const findings: ApiFinding[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let sourceLike = SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase());
        try {
          sourceLike = sourceLike || statSync(path).isDirectory();
        } catch {
          sourceLike = true;
        }
        if (sourceLike) {
          findings.push({
            path: relativePath(root, path),
            line: 1,
            reason: "source symbolic link is not allowed",
            excerpt: "replace the link with an in-project source file or directory",
          });
        }
      } else if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        if (SKIP_SOURCE_FILES.has(relativePath(root, path))) continue;
        files.push(path);
      }
    }
  }
  if (existsSync(root) && statSync(root).isDirectory()) visit(root);
  return { files, findings };
}

const COMPONENT_EXTENSIONS = new Set([".vue", ".svelte", ".astro"]);
const RESOLUTION_EXTENSIONS = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".vue", ".svelte", ".astro",
];

function maskOutsideRanges(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): string {
  const output: string[] = text.split("").map((character) =>
    character === "\n" || character === "\r" ? character : " ",
  );
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index += 1) output[index] = text[index]!;
  }
  return output.join("");
}

/** Keep executable regions of component files while preserving source offsets. */
function executableSource(path: string, text: string): string {
  const extension = extname(path).toLowerCase();
  if (!COMPONENT_EXTENSIONS.has(extension)) return text;

  const ranges: Array<readonly [number, number]> = [];
  if (extension === ".astro") {
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

  const expressionSurface = text.replace(
    /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
    (value) => value.replace(/[^\r\n]/g, " "),
  );
  if (extension === ".vue") {
    for (const match of expressionSurface.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const body = match[1] ?? "";
      const start = match.index + match[0].indexOf(body);
      ranges.push([start, start + body.length]);
    }
    for (const match of expressionSurface.matchAll(
      /(?:^|\s)(?:v-[\w:-]+|[:@#][\w:.-]+)\s*=\s*(["'])([\s\S]*?)\1/gm,
    )) {
      const body = match[2] ?? "";
      const start = match.index + match[0].indexOf(body);
      ranges.push([start, start + body.length]);
    }
  } else {
    // Svelte and Astro execute expressions inside braces. This intentionally
    // keeps the expression body (not literal markup), including common block
    // directive operands such as `{#if condition}` and `{@html value}`.
    for (const match of expressionSurface.matchAll(/\{([^{}]*)\}/g)) {
      const originalBody = match[1] ?? "";
      const directive = /^\s*[#/:@][\w-]+\s*/.exec(originalBody)?.[0] ?? "";
      const body = originalBody.slice(directive.length);
      if (!body.trim()) continue;
      const start = match.index + 1 + directive.length;
      ranges.push([start, start + body.length]);
    }
  }
  return maskOutsideRanges(text, ranges);
}

interface SourceUnit {
  path: string;
  text: string;
  executable: string;
  code: string;
  source: ts.SourceFile;
  threeBindings: Set<string>;
  threeNamespaces: Set<string>;
  threeExports: Set<string>;
  exportAllThree: boolean;
  directWebGpu: boolean;
}

function isThreeModule(value: string): boolean {
  return /^three(?:\/|$)/.test(value);
}

function moduleText(expression: ts.Expression | undefined): string | undefined {
  return expression && ts.isStringLiteralLike(expression)
    ? expression.text
    : undefined;
}

function resolveLocalModule(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const absolute = resolve(dirname(fromPath), specifier);
  const candidates: string[] = [absolute];
  const currentExtension = extname(absolute).toLowerCase();
  const extensionless = currentExtension
    ? absolute.slice(0, -currentExtension.length)
    : absolute;

  // Bundler-style source imports commonly spell a future emitted `.js` path.
  if (!currentExtension || new Set([".js", ".jsx", ".mjs", ".cjs"]).has(currentExtension)) {
    for (const extension of RESOLUTION_EXTENSIONS) {
      candidates.push(`${extensionless}${extension}`);
    }
  }
  for (const extension of RESOLUTION_EXTENSIONS) {
    candidates.push(join(absolute, `index${extension}`));
    if (extensionless !== absolute) {
      candidates.push(join(extensionless, `index${extension}`));
    }
  }
  return candidates.find((candidate) => knownPaths.has(candidate));
}

function addValue(target: Set<string>, value: string): boolean {
  if (target.has(value)) return false;
  target.add(value);
  return true;
}

function addValues(target: Set<string>, values: Iterable<string>): boolean {
  let changed = false;
  for (const value of values) changed = addValue(target, value) || changed;
  return changed;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (true) {
    if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (
      ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function accessedPropertyName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
  ) return expression.argumentExpression.text;
  return undefined;
}

function declarationIsExported(node: ts.VariableDeclaration): boolean {
  const statement = node.parent.parent;
  return ts.isVariableStatement(statement)
    && statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) === true;
}

function stateSize(unit: SourceUnit): number {
  return unit.threeBindings.size
    + unit.threeNamespaces.size
    + unit.threeExports.size
    + Number(unit.exportAllThree)
    + Number(unit.directWebGpu);
}

function buildSourceUnits(paths: readonly string[]): SourceUnit[] {
  return paths.map((path) => {
    const text = readFileSync(path, "utf8");
    const executable = executableSource(path, text);
    return {
      path,
      text,
      executable,
      code: stripCommentsAndStrings(executable),
      source: ts.createSourceFile(
        path,
        executable,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
      threeBindings: new Set<string>(),
      threeNamespaces: new Set<string>(),
      threeExports: new Set<string>(),
      exportAllThree: false,
      directWebGpu: false,
    };
  });
}

/**
 * Resolve Three.js symbol provenance through relative import/re-export barrels.
 * State grows monotonically, so the fixed point is deterministic even when
 * barrels contain cycles.
 */
function populateThreeProvenance(units: SourceUnit[]): void {
  const byPath = new Map(units.map((unit) => [unit.path, unit]));
  const knownPaths = new Set(byPath.keys());
  let changed = true;

  while (changed) {
    changed = false;
    for (const unit of units) {
      const before = stateSize(unit);
      if (/\bTHREE\b/.test(unit.code)) unit.threeNamespaces.add("THREE");

      const targetFor = (specifier: string): SourceUnit | undefined => {
        const path = resolveLocalModule(unit.path, specifier, knownPaths);
        return path ? byPath.get(path) : undefined;
      };
      const importedNameIsThree = (
        target: SourceUnit,
        importedName: string,
      ): boolean => target.exportAllThree || target.threeExports.has(importedName);

      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
          const specifier = moduleText(node.moduleSpecifier);
          const clause = node.importClause;
          if (!specifier || !clause || clause.isTypeOnly) {
            ts.forEachChild(node, visit);
            return;
          }
          const direct = isThreeModule(specifier);
          const target = direct ? undefined : targetFor(specifier);
          if (specifier === "three/webgpu") unit.directWebGpu = true;
          if (clause.name && (direct || (target?.threeExports.has("default") ?? false))) {
            if (specifier === "three" || specifier === "three/webgpu") {
              unit.threeNamespaces.add(clause.name.text);
            } else {
              unit.threeBindings.add(clause.name.text);
            }
          }
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) {
            if (direct || (target && (target.exportAllThree || target.threeExports.size > 0))) {
              unit.threeNamespaces.add(bindings.name.text);
            }
          } else if (bindings && ts.isNamedImports(bindings)) {
            for (const item of bindings.elements) {
              if (item.isTypeOnly) continue;
              const importedName = item.propertyName?.text ?? item.name.text;
              if (direct || (target && importedNameIsThree(target, importedName))) {
                unit.threeBindings.add(item.name.text);
                // Retain the origin token as a marker so renamed imports are
                // rejected at the import site by the curated denylist.
                unit.threeBindings.add(importedName);
              }
            }
          }
        } else if (ts.isExportDeclaration(node)) {
          if (node.isTypeOnly) {
            ts.forEachChild(node, visit);
            return;
          }
          const specifier = moduleText(node.moduleSpecifier);
          const direct = specifier ? isThreeModule(specifier) : false;
          const target = specifier && !direct ? targetFor(specifier) : undefined;
          if (specifier === "three/webgpu") unit.directWebGpu = true;
          const clause = node.exportClause;
          if (!clause) {
            if (direct) unit.exportAllThree = true;
            else if (target) {
              unit.exportAllThree = unit.exportAllThree || target.exportAllThree;
              addValues(unit.threeExports, target.threeExports);
            }
          } else if (ts.isNamespaceExport(clause)) {
            if (direct || (target && (target.exportAllThree || target.threeExports.size > 0))) {
              unit.threeExports.add(clause.name.text);
            }
          } else {
            for (const item of clause.elements) {
              if (item.isTypeOnly) continue;
              const localName = item.propertyName?.text ?? item.name.text;
              const exportedName = item.name.text;
              const three = direct
                || (target ? importedNameIsThree(target, localName) : (
                  unit.threeBindings.has(localName)
                  || unit.threeNamespaces.has(localName)
                ));
              if (three) {
                unit.threeExports.add(exportedName);
                unit.threeBindings.add(localName);
              }
            }
          }
        } else if (
          ts.isImportEqualsDeclaration(node)
          && ts.isExternalModuleReference(node.moduleReference)
        ) {
          const specifier = moduleText(node.moduleReference.expression);
          const target = specifier && !isThreeModule(specifier)
            ? targetFor(specifier)
            : undefined;
          if (specifier === "three/webgpu") unit.directWebGpu = true;
          if (specifier && (isThreeModule(specifier)
            || (target && (target.exportAllThree || target.threeExports.size > 0)))) {
            unit.threeNamespaces.add(node.name.text);
          }
        } else if (ts.isVariableDeclaration(node) && node.initializer) {
          type ModuleSource = {
            direct: boolean;
            specifier: string;
            target: SourceUnit | undefined;
          };
          const moduleSource = (expression: ts.Expression): ModuleSource | undefined => {
            const candidate = unwrapExpression(expression);
            if (!ts.isCallExpression(candidate)) return undefined;
            const requireCall = ts.isIdentifier(candidate.expression)
              && candidate.expression.text === "require";
            const dynamicImport = candidate.expression.kind === ts.SyntaxKind.ImportKeyword;
            if (!requireCall && !dynamicImport) return undefined;
            const specifier = moduleText(candidate.arguments[0]);
            if (!specifier) return undefined;
            const direct = isThreeModule(specifier);
            const target = direct ? undefined : targetFor(specifier);
            if (specifier === "three/webgpu") unit.directWebGpu = true;
            return { direct, specifier, target };
          };
          const sourceProvidesNamespace = (source: ModuleSource): boolean =>
            source.direct
            || Boolean(source.target && (
              source.target.exportAllThree || source.target.threeExports.size > 0
            ));
          const sourceProvidesSymbol = (
            source: ModuleSource,
            symbol: string,
          ): boolean => source.direct
            || Boolean(source.target && importedNameIsThree(source.target, symbol));

          const initializer = unwrapExpression(node.initializer);
          let initializerKind: "none" | "namespace" | "symbol" = "none";
          let originSymbol: string | undefined;
          let namespaceSource: ModuleSource | undefined;
          const directModule = moduleSource(node.initializer);
          if (directModule && sourceProvidesNamespace(directModule)) {
            initializerKind = "namespace";
            namespaceSource = directModule;
          } else if (
            ts.isPropertyAccessExpression(initializer)
            || ts.isElementAccessExpression(initializer)
          ) {
            const property = accessedPropertyName(initializer);
            const memberRoot = unwrapExpression(initializer.expression);
            const memberModule = moduleSource(initializer.expression);
            if (
              property
              && memberModule
              && sourceProvidesSymbol(memberModule, property)
            ) {
              initializerKind = "symbol";
              originSymbol = property;
            } else if (property === "THREE") {
              initializerKind = "namespace";
            } else if (
              property
              && ts.isIdentifier(memberRoot)
              && (
                unit.threeNamespaces.has(memberRoot.text)
                || unit.threeBindings.has(memberRoot.text)
              )
            ) {
              initializerKind = "symbol";
              originSymbol = property;
            }
          } else if (ts.isIdentifier(initializer)) {
            if (unit.threeNamespaces.has(initializer.text)) {
              initializerKind = "namespace";
            } else if (unit.threeBindings.has(initializer.text)) {
              initializerKind = "symbol";
            }
          } else if (ts.isNewExpression(initializer)) {
            const constructor = unwrapExpression(initializer.expression);
            if (
              ts.isIdentifier(constructor)
              && unit.threeBindings.has(constructor.text)
            ) {
              initializerKind = "symbol";
              originSymbol = constructor.text;
            } else if (ts.isPropertyAccessExpression(constructor)) {
              const root = unwrapExpression(constructor.expression);
              if (
                ts.isIdentifier(root)
                && (
                  unit.threeNamespaces.has(root.text)
                  || unit.threeBindings.has(root.text)
                )
              ) {
                initializerKind = "symbol";
                originSymbol = constructor.name.text;
              }
            }
          }

          if (initializerKind !== "none") {
            if (ts.isIdentifier(node.name)) {
              if (initializerKind === "namespace") {
                unit.threeNamespaces.add(node.name.text);
              } else {
                unit.threeBindings.add(node.name.text);
                if (originSymbol) unit.threeBindings.add(originSymbol);
              }
            } else {
              for (const element of node.name.elements) {
                if (ts.isOmittedExpression(element)) continue;
                const origin = element.propertyName && ts.isIdentifier(element.propertyName)
                  ? element.propertyName.text
                  : bindingNames(element.name)[0];
                if (
                  origin
                  && namespaceSource
                  && !sourceProvidesSymbol(namespaceSource, origin)
                ) continue;
                addValues(unit.threeBindings, bindingNames(element.name));
                if (origin) unit.threeBindings.add(origin);
              }
            }
          }
          if (declarationIsExported(node)) {
            for (const name of bindingNames(node.name)) {
              if (unit.threeBindings.has(name) || unit.threeNamespaces.has(name)) {
                unit.threeExports.add(name);
              }
            }
          }
        } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
          if (
            ts.isIdentifier(node.expression)
            && (unit.threeBindings.has(node.expression.text)
              || unit.threeNamespaces.has(node.expression.text))
          ) {
            unit.threeExports.add("default");
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(unit.source);
      changed = stateSize(unit) !== before || changed;
    }
  }
}

const SYMBOL_SCOPED_REASONS = new Set([
  "deprecated THREE.Clock timing",
  "removed renderer.outputEncoding",
  "removed Texture.encoding; use colorSpace",
  "removed PointerLockControls.getObject(); use object",
  "removed color encoding constant",
  "removed legacy lighting switch",
  "removed gamma output property",
  "removed WebGL1Renderer",
  "removed WebGLMultisampleRenderTarget",
  "removed legacy Geometry/Face3",
  "deprecated RGBELoader compatibility alias",
  "PCFSoftShadowMap is deprecated",
  "WebGPU path mixes EffectComposer",
  "WebGPU path mixes ShaderMaterial",
  "WebGPU path mixes RawShaderMaterial",
  "WebGPU path mixes onBeforeCompile",
  "deprecated renderer or pipeline async method",
  "removed WebGPURenderer.waitForGPU",
  "deprecated SVGLoader.createShapes",
  "renamed mergeBufferGeometries",
  "renamed mergeBufferAttributes",
]);

function symbolForMatch(reason: string, value: string): string | undefined {
  if (reason === "deprecated THREE.Clock timing") return "Clock";
  if (reason === "deprecated SVGLoader.createShapes") return "SVGLoader";
  const identifiers = value.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return identifiers.at(-1);
}

function isThreeSymbolReference(
  unit: SourceUnit,
  reason: string,
  value: string,
  offset: number,
): boolean {
  if (!SYMBOL_SCOPED_REASONS.has(reason)) return true;
  // Three.js also has valid, unrelated `.encoding` members (for example
  // PackFloatNode). Receiver-name narrowing is deliberate here. Do not require
  // constructor provenance: common TextureLoader.load() results are not part
  // of the scanner's conservative binding propagation.
  if (reason === "removed Texture.encoding; use colorSpace") return true;
  const symbol = symbolForMatch(reason, value);
  if (!symbol) return false;

  const valueRoot = value.match(/^([A-Za-z_$][\w$]*)\s*\./)?.[1];
  if (valueRoot && (
    unit.threeNamespaces.has(valueRoot) || unit.threeBindings.has(valueRoot)
  )) return true;

  const prefixPattern = value.startsWith(".")
    ? /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/
    : /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*$/;
  const prefix = unit.code.slice(0, offset).match(prefixPattern)?.[1];
  if (prefix) {
    const names = prefix.split(/\s*\.\s*/);
    if (
      unit.threeNamespaces.has(names[0]!)
      || unit.threeBindings.has(names[0]!)
      || unit.threeNamespaces.has(names.at(-1)!)
      || unit.threeBindings.has(names.at(-1)!)
    ) return true;
  }
  return unit.threeBindings.has(symbol);
}

export function auditProjectThreeApis(projectRootInput: string): ApiFinding[] {
  const root = resolve(projectRootInput);
  const walk = walkSourceFiles(root);
  const findings: ApiFinding[] = [...walk.findings];
  const units = buildSourceUnits(walk.files);
  populateThreeProvenance(units);
  for (const unit of units) {
      if (
        unit.threeBindings.size === 0
        && unit.threeNamespaces.size === 0
        && unit.threeExports.size === 0
        && !unit.exportAllThree
      ) continue;
      const webgpu = unit.directWebGpu
        || /\bWebGPURenderer\b/.test(unit.code)
        || /\bRenderPipeline\b/.test(unit.code);
      for (const [reason, pattern] of DENYLIST_PATTERNS) {
        if (
          !webgpu &&
          (reason.startsWith("WebGPU path mixes") ||
            reason === "WebGPU path mixes EffectComposer")
        ) {
          // EffectComposer / ShaderMaterial are valid on WebGL-only files.
          if (
            reason.includes("EffectComposer") ||
            reason.includes("ShaderMaterial") ||
            reason.includes("RawShaderMaterial") ||
            reason.includes("onBeforeCompile")
          ) {
            continue;
          }
        }
        for (const match of allMatches(pattern, unit.code)) {
          if (!isThreeSymbolReference(unit, reason, match[0], match.index)) continue;
          findings.push({
            path: relativePath(root, unit.path),
            line: lineFor(unit.text, match.index),
            reason,
            excerpt: excerptFor(unit.text, match.index),
          });
        }
      }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.reason.localeCompare(right.reason),
  );
}

const HELP = `usage: audit-project-three-apis.ts [-h] [project]

Scan project source files that import/use Three.js for stale APIs (r185+ denylist).

positional arguments:
  project     Game project root (default: .)

options:
  -h, --help  show this help message and exit`;

function parseArgs(argv: string[]): string {
  const positionals: string[] = [];
  for (const argument of argv) {
    if (argument === "-h" || argument === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (argument.startsWith("-")) {
      console.error(`audit-project-three-apis.ts: error: unrecognized arguments: ${argument}`);
      process.exit(2);
    } else positionals.push(argument);
  }
  if (positionals.length > 1) {
    console.error(
      `audit-project-three-apis.ts: error: unrecognized arguments: ${positionals.slice(1).join(" ")}`,
    );
    process.exit(2);
  }
  return positionals[0] ?? ".";
}

export function main(argv = process.argv.slice(2)): number {
  const project = resolve(process.env.INIT_CWD ?? process.cwd(), parseArgs(argv));
  if (!existsSync(project) || !statSync(project).isDirectory()) {
    console.error(`Project directory not found: ${project}`);
    return 2;
  }
  const findings = auditProjectThreeApis(project);
  if (findings.length > 0) {
    console.log("Project Three.js API audit failed:");
    for (const item of findings) {
      console.log(`- ${item.path}:${item.line}: ${item.reason}: ${item.excerpt}`);
    }
    return 1;
  }
  console.log(
    "Project Three.js API audit passed: no curated stale-API denylist hits in scanned sources.",
  );
  return 0;
}

let invokedAsMain = Boolean(
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]),
);
try {
  invokedAsMain = Boolean(process.argv[1])
    && realpathSync(resolve(process.argv[1]!)) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  // Keep the lexical fallback for missing/broken invocation paths.
}
if (invokedAsMain) {
  process.exitCode = main();
}
