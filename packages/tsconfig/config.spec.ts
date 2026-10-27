import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

type Raw = { readonly compilerOptions?: Readonly<Record<string, unknown>>; readonly include?: unknown; readonly exclude?: unknown; readonly files?: unknown };
type Manifest = { readonly exports: Readonly<Record<string, string>> };

const here = import.meta.dirname;
const APP_PRESETS = ['base.json', 'be.json', 'build.json', 'next.json', 'e2e.json'];
const PACKAGE_PRESETS = ['package-esm.json', 'package-cjs.json'];
const PRESETS = [...APP_PRESETS, ...PACKAGE_PRESETS];

const readRaw = (name: string): Raw => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8')) as Raw;

// Resolve a config exactly as tsc would (extends chain included) and hand back the effective options.
function effective(name: string): ts.CompilerOptions {
  const file = path.join(here, name);
  const read = ts.readConfigFile(file, ts.sys.readFile);
  assert.equal(read.error, undefined, `${name} parses`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, here, undefined, file);
  assert.deepEqual(parsed.errors.filter((e) => e.code !== 18003), [], `${name} resolves`);
  return parsed.options;
}

// Parse a config written into a scratch folder, so the `${configDir}` options resolve against that folder.
function parseIn(dir: string, name: string): ts.CompilerOptions {
  const file = path.join(dir, name);
  return ts.parseJsonConfigFileContent(ts.readConfigFile(file, ts.sys.readFile).config, ts.sys, dir, undefined, file).options;
}

const posix = (name: string): string => path.join(here, name).split(path.sep).join('/');

// The compile options of a preset for an in-memory probe: no emit, no project-only settings.
function probeOptions(name: string): ts.CompilerOptions {
  const { plugins: _plugins, rootDir: _rootDir, outDir: _outDir, ...rest } = effective(name);
  return { ...rest, noEmit: true, incremental: false };
}

for (const name of PRESETS) {
  test(`${name} is strict, including noImplicitAny`, () => {
    const options = effective(name);
    assert.equal(options.strict, true);
    assert.equal(options.noImplicitAny, true);
    assert.equal(options.strictNullChecks, true);
    assert.equal(options.isolatedModules, true);
  });
}

test('no config carries a path-relative option that would resolve inside node_modules', () => {
  for (const name of PRESETS) {
    const raw = readRaw(name);
    const options = raw.compilerOptions ?? {};
    for (const key of ['outDir', 'rootDir', 'baseUrl', 'paths', 'tsBuildInfoFile']) {
      const value = options[key];
      // `${configDir}` resolves against the config that extends the preset (TypeScript 5.5), never against node_modules.
      const anchored = typeof value === 'string' && value.startsWith('${configDir}/');
      assert.equal(key in options && !anchored, false, `${name} must not set ${key} unless it is anchored at \${configDir}; the repo tsconfig owns it`);
    }
    assert.equal('include' in raw || 'exclude' in raw || 'files' in raw, false, `${name} must not set include/exclude`);
  }
});

test('nest.json is gone: be.json is the one back-end preset, and the package exports exactly the files it ships', () => {
  assert.equal(fs.existsSync(path.join(here, 'nest.json')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')) as Manifest;
  assert.deepEqual(Object.keys(manifest.exports).sort(), PRESETS.map((name) => `./${name}`).sort());
  for (const target of Object.values(manifest.exports)) assert.ok(fs.existsSync(path.join(here, target)), target);
});

const STRICT_FLAGS = ['strict', 'noImplicitAny', 'strictNullChecks', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitOverride', 'noImplicitReturns', 'noFallthroughCasesInSwitch', 'noUnusedLocals', 'noUnusedParameters'];

for (const name of PRESETS) {
  test(`${name} inherits every strictness flag of base.json, none of them lowered`, () => {
    const options = effective(name);
    for (const flag of STRICT_FLAGS) assert.equal(options[flag], true, `${name} ${flag}`);
    assert.equal(options.allowUnusedLabels, false, `${name} allowUnusedLabels`);
  });
}

test('no preset below base.json states a strictness flag, and skipLibCheck is stated once, in base.json', () => {
  const owned = new Set([...STRICT_FLAGS, 'allowUnusedLabels', 'skipLibCheck']);
  for (const name of PRESETS.filter((preset) => preset !== 'base.json')) {
    const raw = readRaw(name);
    for (const key of Object.keys(raw.compilerOptions ?? {})) assert.equal(owned.has(key), false, `${name} restates ${key}; base.json owns it`);
  }
  assert.equal(effective('base.json').skipLibCheck, true);
});

test('be.json carries every flag of the locked back-end contract, none of them lowered', () => {
  const be = effective('be.json');
  for (const flag of ['strict', 'noImplicitAny', 'strictNullChecks', 'noUncheckedIndexedAccess', 'noImplicitOverride', 'noImplicitReturns', 'noFallthroughCasesInSwitch', 'noUnusedLocals', 'noUnusedParameters', 'isolatedModules', 'experimentalDecorators', 'emitDecoratorMetadata']) {
    assert.equal(be[flag], true, flag);
  }
  assert.equal(be.allowJs, false);
  assert.equal(be.noEmit, true, 'a plain `tsc -p tsconfig.json` never emits');
  assert.equal(be.module, ts.ModuleKind.NodeNext);
  assert.equal(be.moduleResolution, ts.ModuleResolutionKind.NodeNext);
});

test('build.json only turns emit on; next is the bundler jsx profile', () => {
  const build = effective('build.json');
  assert.equal(build.noEmit, false);
  assert.equal(build.strict, true);
  assert.equal(build.noUncheckedIndexedAccess, true);
  const next = effective('next.json');
  assert.equal(next.moduleResolution, ts.ModuleResolutionKind.Bundler);
  assert.equal(next.noEmit, true);
  assert.equal(next.jsx, ts.JsxEmit.ReactJSX);
});

test('package-esm.json builds a package from src/ to dist/ with declarations; its sources run on Node as they are', () => {
  const esm = effective('package-esm.json');
  assert.equal(esm.module, ts.ModuleKind.NodeNext);
  assert.equal(esm.moduleResolution, ts.ModuleResolutionKind.NodeNext);
  assert.equal(esm.noEmit, false);
  assert.equal(esm.declaration, true);
  assert.equal(esm.allowJs, false);
  // Node strips the types of a spec and of the source it imports, so a source holds only erasable syntax, imports `./x.ts`,
  // and the build rewrites that to `./x.js`.
  assert.equal(esm.verbatimModuleSyntax, true);
  assert.equal(esm.erasableSyntaxOnly, true);
  assert.equal(esm.rewriteRelativeImportExtensions, true);
  const cjs = effective('package-cjs.json');
  // A CommonJS package (one jest or prettier loads with require) writes `export =` and ES imports that compile to require.
  assert.equal(cjs.verbatimModuleSyntax, false);
  assert.equal(cjs.erasableSyntaxOnly, false);
  assert.equal(cjs.rewriteRelativeImportExtensions, true);
  assert.equal(cjs.declaration, true);
});

test('a package config resolves src/ and dist/ against its own folder and emits ES modules or CommonJS by its package type', () => {
  for (const [preset, type, marker] of [['package-esm.json', 'module', 'export const answer'], ['package-cjs.json', 'commonjs', 'exports.answer']] as const) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-tsconfig-package-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'probe', type }));
      fs.writeFileSync(path.join(dir, 'src', 'answer.ts'), 'export const answer: number = 42\n');
      fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export { answer } from "./answer.ts"\n');
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: posix(preset), compilerOptions: { types: [] }, include: ['src'] }));
      const options = parseIn(dir, 'tsconfig.json');
      assert.equal(options.rootDir, path.join(dir, 'src').split(path.sep).join('/'));
      assert.equal(options.outDir, path.join(dir, 'dist').split(path.sep).join('/'));
      const program = ts.createProgram([path.join(dir, 'src', 'index.ts'), path.join(dir, 'src', 'answer.ts')], options);
      const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      assert.deepEqual(diagnostics, [], preset);
      assert.equal(program.emit().emitSkipped, false, preset);
      const index = fs.readFileSync(path.join(dir, 'dist', 'index.js'), 'utf8');
      assert.match(index, /\.\/answer\.js/, `${preset}: the relative import is rewritten to .js`);
      assert.ok(fs.readFileSync(path.join(dir, 'dist', 'answer.js'), 'utf8').includes(marker), `${preset}: ${type} output`);
      assert.ok(fs.existsSync(path.join(dir, 'dist', 'index.d.ts')), `${preset}: declarations`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the managed repository configs resolve through the presets: paths only in tsconfig.json, overlays after it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-tsconfig-'));
  try {
    const paths = { '@features/*': ['./src/features/*'], '@modules/*': ['./src/modules/*'], '@tests/*': ['./src/tests/*'] };
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: posix('be.json'), compilerOptions: { paths } }));
    fs.writeFileSync(path.join(dir, 'tsconfig.build.json'), JSON.stringify({ extends: ['./tsconfig.json', posix('build.json')], compilerOptions: { outDir: './dist' }, exclude: ['dist', '**/*.spec.ts'] }));
    fs.writeFileSync(path.join(dir, 'tsconfig.e2e.json'), JSON.stringify({ extends: ['./tsconfig.json', posix('e2e.json')], include: ['e2e/**/*.ts'] }));
    const repo = parseIn(dir, 'tsconfig.json');
    assert.deepEqual(Object.keys(repo.paths ?? {}).sort(), Object.keys(paths).sort());
    assert.equal(repo.noEmit, true);
    const build = parseIn(dir, 'tsconfig.build.json');
    assert.equal(build.noEmit, false);
    assert.equal(build.experimentalDecorators, true);
    assert.equal(path.basename(build.outDir ?? ''), 'dist');
    const e2e = parseIn(dir, 'tsconfig.e2e.json');
    assert.equal(e2e.noEmit, true);
    assert.equal(e2e.incremental, false);
    assert.equal(e2e.strict, true);
    assert.equal(e2e.experimentalDecorators, true);
    assert.equal(e2e.noUncheckedIndexedAccess, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an implicit any, an unchecked index and an unused local each fail to compile under be.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-tsconfig-any-'));
  try {
    const cases: ReadonlyArray<readonly [string, string, number]> = [
      ['implicit-any.ts', 'export function probe(value) { return value }\n', 7006],
      ['indexed.ts', 'export const first = (items: string[]): string => items[0]\n', 2322],
      ['unused.ts', 'export function probe(): number { const unused = 1; return 2 }\n', 6133],
      ['returns.ts', 'export function probe(flag: boolean): number | undefined { if (flag) { return 1 } }\n', 7030],
    ];
    for (const name of ['be.json', 'next.json']) {
      for (const [file, text, code] of cases.slice(0, name === 'be.json' ? cases.length : 1)) {
        const source = path.join(dir, file);
        fs.writeFileSync(source, text);
        const codes = ts.getPreEmitDiagnostics(ts.createProgram([source], probeOptions(name))).map((d) => d.code);
        assert.ok(codes.includes(code), `${name} ${file}: expected TS${code}, got ${codes.join(',')}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('an explicit undefined in an optional property fails to compile under every preset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-tsconfig-exact-'));
  try {
    const source = path.join(dir, 'optional.ts');
    // A type of its own: the be preset's ES2023 lib has no DOM types and a clean install has no @types/node, so AbortSignal would not resolve.
    fs.writeFileSync(source, 'type Signal = { readonly aborted: boolean }\nexport const options: { readonly signal?: Signal } = { signal: undefined }\n');
    for (const name of PRESETS) {
      const codes = ts.getPreEmitDiagnostics(ts.createProgram([source], { ...probeOptions(name), types: [] })).map((d) => d.code);
      assert.ok(codes.includes(2375), `${name}: expected TS2375, got ${codes.join(",")}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
