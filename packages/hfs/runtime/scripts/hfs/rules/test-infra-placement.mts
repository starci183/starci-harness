// test-infra-placement.mts - what no eslint run can promise, because an app may lint nothing on its dev branch: the test law of BE-TEST-1 and
// BE-TEST-12 read straight from the tracked tree, as TypeScript syntax trees (never by matching names in text).
//   1. BE_TEST_TOPOLOGY (R47): test infrastructure lives only in `src/tests/world/` (@starci/test-world). A file under `src/tests/` outside
//      the world that imports `@nestjs/testing`, an app's `AppModule` / `app.module`, `NestFactory`, a container or docker client
//      (`testcontainers`, `@testcontainers/*`, `dockerode`, `docker-modem`), or calls `createTestingModule` or `.listen(` is a homemade world.
//   2. BE_TEST_TOPOLOGY (R47, `tests-no-override`): `overrideProvider`, `overrideGuard`, `overrideModule`, `overrideInterceptor`,
//      `overrideFilter` or `overridePipe` is called nowhere under `src/tests/` and in no integration, e2e or contract spec; a unit spec's
//      doubles are judged by R48 (`unit-spec-providers`).
//   3. BE_SPEC_WORLD_MISSING (R47): every `*.integration-spec.ts` and `*.e2e-spec.ts` imports `useTestWorld` from the repository's own
//      `src/tests/world/use-test-world` (the specifier resolved through the side's tsconfig, never a name match) and calls it.
// An app carries integration specs (`{ modules }`) and e2e specs (`{ apps }`) through the same world entry.
import path from 'node:path';
import { found, readText } from './read.mjs';
import { judgeOf, typescriptFor } from './integration-specs.mjs';
import { byCodeUnit } from '../../lib/list.mjs';
import type { Finding, Parsed, Ts } from './rule-types.mjs';

const TOPOLOGY = 'BE_TEST_TOPOLOGY';
const WORLD_MISSING = 'BE_SPEC_WORLD_MISSING';

const TESTS_FILE = /^((?:[^/]+\/)*?)src\/tests\/(.+\.m?tsx?)$/;
const WORLD_SPEC = /\.(?:integration|e2e)-spec\.ts$/;
const NON_UNIT_SPEC = /\.(?:integration|e2e|contract)-spec\.ts$/;
const SPEC_FILE = /^((?:[^/]+\/)*?)src\/.+\.(?:integration|e2e|contract)-spec\.ts$/;
const INFRA_PACKAGES = /^(?:@nestjs\/testing|testcontainers|@testcontainers\/.+|dockerode|docker-modem)$/;
const APP_MODULE_SOURCE = /(?:^|\/)app\.module(?:\.[cm]?[jt]s)?$/;
const OVERRIDES = new Set(['overrideProvider', 'overrideModule', 'overrideGuard', 'overrideInterceptor', 'overrideFilter', 'overridePipe']);
const WORLD_ENTRY = /(?:^|\/)world\/use-test-world(?:\.[cm]?[jt]s)?$/;

/** The `src/tests/<rest>` split of a tracked path: the side prefix and the rest, else null. */
function testsPathOf(file: string): { side: string; rest: string } | null {
  const match = TESTS_FILE.exec(file);
  return match ? { side: match[1]!, rest: match[2]! } : null;
}

/** One finding of this rule on a node. */
function at(ts: Ts, sourceFile: Parsed, node: Parsed, code: string, file: string, message: string): Finding {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  return found(code, file, `${file}:${line + 1}: ${message}`, { line: line + 1, column: character + 1 });
}

/** The module specifiers a file imports, re-exports, requires or dynamically imports, with their nodes. */
function specifiersOf(ts: Ts, sourceFile: Parsed): Array<{ source: string; node: Parsed }> {
  const out: Array<{ source: string; node: Parsed }> = [];
  const visit = (node: Parsed): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) out.push({ source: node.moduleSpecifier.text, node });
    else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)
      && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) out.push({ source: (node.arguments[0] as Parsed).text, node });
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** The named imports of a file: the module, the exported name and the specifier node. */
function importedNames(ts: Ts, sourceFile: Parsed): Array<{ source: string; imported: string; node: Parsed }> {
  const out: Array<{ source: string; imported: string; node: Parsed }> = [];
  for (const statement of sourceFile.statements as Parsed[]) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const element of named.elements) out.push({ source: statement.moduleSpecifier.text, imported: (element.propertyName ?? element.name).text, node: element });
  }
  return out;
}

/** The infrastructure findings of one file outside the world (`BE_TEST_TOPOLOGY`). */
function infraFindings(ts: Ts, sourceFile: Parsed, file: string): Finding[] {
  const hits: Finding[] = [];
  const say = (node: Parsed, what: string) => hits.push(at(ts, sourceFile, node, TOPOLOGY, file, `${what}: test infrastructure lives only in src/tests/world/ (@starci/test-world); a spec boots its subject through \`useTestWorld(...)\` from src/tests/world/use-test-world and this file holds data or builders only`));
  for (const { source, node } of specifiersOf(ts, sourceFile)) {
    if (INFRA_PACKAGES.test(source)) say(node, `imports ${source}`);
    else if (APP_MODULE_SOURCE.test(source)) say(node, `imports an app module (${source})`);
  }
  for (const { source, imported, node } of importedNames(ts, sourceFile)) {
    if (imported === 'NestFactory' && source === '@nestjs/core') say(node, 'imports NestFactory');
    else if (imported === 'AppModule' && !APP_MODULE_SOURCE.test(source)) say(node, `imports AppModule from ${source}`);
  }
  const visit = (node: Parsed): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === 'createTestingModule') say(node, 'calls createTestingModule');
      else if (name === 'listen') say(node, 'calls .listen(');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

/** The `override*` findings of one file (`BE_TEST_TOPOLOGY`, tests-no-override). */
function overrideFindings(ts: Ts, sourceFile: Parsed, file: string): Finding[] {
  const hits: Finding[] = [];
  const visit = (node: Parsed): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && OVERRIDES.has(node.expression.name.text)) {
      hits.push(at(ts, sourceFile, node, TOPOLOGY, file, `${node.expression.name.text}(...) replaces a provider in a test; nothing under src/tests and no integration, e2e or contract spec overrides a provider, guard or module: a service of the stack runs real and an external SaaS is a network fake of the world (world.fake.<provider>)`));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

/** Whether the spec imports `useTestWorld` from the world entry of its side and calls it (the entry resolved through the side's tsconfig). */
function usesWorldEntry(ts: Ts, sourceFile: Parsed, file: string, side: string, resolve: (from: string, source: string) => string | null): boolean {
  const entry = `${side}src/tests/world/use-test-world.ts`;
  const locals = new Set<string>();
  for (const { source, imported, node } of importedNames(ts, sourceFile)) {
    if (imported !== 'useTestWorld') continue;
    const resolved = resolve(file, source);
    if (resolved === entry || (resolved === null && WORLD_ENTRY.test(source))) locals.add(node.name.text);
  }
  if (locals.size === 0) return false;
  let called = false;
  const visit = (node: Parsed): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && locals.has(node.expression.text)) called = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return called;
}

/** The findings of R47's test placement over the tracked paths `files` of a back-end repository at `repoRoot`. */
export function testInfraPlacementFindings({ repoRoot, files }: { repoRoot: string; files: string[] }): Finding[] {
  const scoped = files.filter((file) => (testsPathOf(file) !== null || SPEC_FILE.test(file)) && !file.endsWith('.d.ts') && !file.includes('node_modules/')).sort(byCodeUnit);
  if (scoped.length === 0) return [];
  const ts = typescriptFor(repoRoot);
  if (ts === null) return [];
  const judges = new Map<string, ReturnType<typeof judgeOf>>();
  const findings: Finding[] = [];
  for (const file of scoped) {
    const text = readText(repoRoot, file);
    if (text === null) continue;
    const parts = testsPathOf(file);
    const side = parts?.side ?? SPEC_FILE.exec(file)![1]!;
    if (!judges.has(side)) judges.set(side, judgeOf(ts, repoRoot, side));
    const kind = path.extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const inWorld = parts !== null && parts.rest.startsWith('world/');
    if (parts !== null && !inWorld) findings.push(...infraFindings(ts, sourceFile, file));
    if (parts !== null || NON_UNIT_SPEC.test(file)) findings.push(...overrideFindings(ts, sourceFile, file));
    if (WORLD_SPEC.test(file) && !usesWorldEntry(ts, sourceFile, file, side, (from, source) => judges.get(side)!.resolve(from, source))) {
      findings.push(found(WORLD_MISSING, file, `${file}: an integration or e2e spec gets its world from \`useTestWorld(...)\` imported from ${side}src/tests/world/use-test-world and calls it; a world assembled in the spec or in a fixture (a boot helper, a bootWorld, Test.createTestingModule) is refused`));
    }
  }
  return findings;
}
