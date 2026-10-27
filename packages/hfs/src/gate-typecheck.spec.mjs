import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { readTypeProject, typeImpact } from '../runtime/scripts/gates/type-impact.mjs';
import { boundedSys, headTsc, newTscFindings } from '../runtime/scripts/gates/gate.mjs';
import { baseTsc } from '../runtime/scripts/gates/type-program.mjs';
import { loadSlotManifest, openHfs } from '../runtime/scripts/hfs/slots.mjs';

const APP_CONFIG = 'fe/apps/web/tsconfig.json';
const APP_SOURCE = 'fe/apps/web/src/index.ts';
const ROOT_OPTIONS = { strict: true, types: [], target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' };
const write = (root, file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
};

/** A side-wide aggregate and an app whose aliases are meaningful only in that app's compiler program. */
function appFixture(t, { appConfig = APP_CONFIG, references = false, invalid = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot(), 'hfs-gate-types-')));
  const sourceDir = path.posix.relative(path.posix.dirname(appConfig), 'fe/apps/web/src');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', { name: 'fixture', private: true });
  write(root, 'fe/tsconfig.json', {
    compilerOptions: ROOT_OPTIONS,
    ...(references ? { files: [], references: [{ path: `./${path.posix.relative('fe', appConfig)}` }] } : {}),
  });
  write(root, appConfig, {
    extends: path.posix.relative(path.posix.dirname(appConfig), 'fe/tsconfig.json'),
    compilerOptions: { paths: { '@/*': [`${sourceDir.startsWith('.') ? sourceDir : `./${sourceDir}`}/*`] } },
    include: [`${sourceDir}/**/*.ts`],
  });
  write(root, 'fe/apps/web/src/modules/api.ts', 'export const api = 1;\n');
  write(root, APP_SOURCE, `import { api } from '@/modules/api';\nexport const value: ${invalid ? 'string' : 'number'} = api;\n`);
  return { root, appConfig };
}

/** The gate's real compiler, with its cache isolated inside this disposable fixture. */
function findingsOf(fixture, project, required = []) {
  return headTsc(ts, fixture.root, project, {
    bound: fixture.root,
    cache: { worktree: path.join(fixture.root, '.compiler-cache') },
    required,
  });
}

/** Overlay only the changed inputs, as the gate does when comparing current diagnostics with base. */
function baseFindingsOf(fixture, project, before) {
  return baseTsc(ts, fixture.root, project, {
    bound: fixture.root,
    delta: { changed: new Set(before.keys()), added: new Set(), deleted: new Set(), renamed: new Map() },
    readBase: (file) => before.get(file) ?? null,
  });
}

/** The shipped project reader and compiler bound supply the same membership used in production. */
const readProject = (root) => (project) => readTypeProject(ts, root, project, boundedSys(ts, root));

/** Measure every selected program so aggregate diagnostics and alias errors cannot escape an assertion. */
const impactFindings = (fixture, impact) => impact.projects.flatMap((project) => findingsOf(fixture, project, impact.required.get(project)));

/** Configuration changes take the broad impact path that formerly selected both the aggregate and its app. */
function broadImpact(fixture) {
  return typeImpact(fixture.root, ['package.json', APP_SOURCE], { readProject: readProject(fixture.root) });
}

test('broad typecheck impact runs the owning app config without aggregate alias false findings', (t) => {
  const fixture = appFixture(t);
  const impact = broadImpact(fixture);
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG, 'fe/tsconfig.json']);
  assert.deepEqual(impact.required.get(APP_CONFIG), [APP_SOURCE]);
  assert.deepEqual(impactFindings(fixture, impact), []);
});

test('a real app type error remains a finding after aggregate resolution', (t) => {
  const fixture = appFixture(t, { invalid: true });
  const impact = broadImpact(fixture);
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG, 'fe/tsconfig.json']);
  const findings = impactFindings(fixture, impact);
  assert.deepEqual(findings.map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: APP_SOURCE }]);
});

test('references-only configs resolve a custom-named referenced app project', (t) => {
  const fixture = appFixture(t, { appConfig: 'fe/apps/web/tsconfig.app.json', references: true });
  const impact = broadImpact(fixture);
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [fixture.appConfig, 'fe/tsconfig.json']);
  assert.deepEqual(impact.required.get(fixture.appConfig), [APP_SOURCE]);
  assert.deepEqual(findingsOf(fixture, fixture.appConfig, impact.required.get(fixture.appConfig)), []);
});

test('a selected source resolves through references even without broad configuration impact', (t) => {
  const fixture = appFixture(t, { appConfig: 'fe/apps/web/tsconfig.app.json', references: true, invalid: true });
  const impact = typeImpact(fixture.root, [APP_SOURCE], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [fixture.appConfig]);
  assert.deepEqual(findingsOf(fixture, fixture.appConfig, impact.required.get(fixture.appConfig)).map((finding) => finding.rule), ['TS2322']);
});

test('an ancestor config keeps real source outside its nested app project', (t) => {
  const fixture = appFixture(t);
  const shared = 'fe/tools.ts';
  write(fixture.root, shared, 'export const broken: string = 1;\n');
  const impact = typeImpact(fixture.root, ['package.json', shared, APP_SOURCE], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.ok(impact.projects.includes('fe/tsconfig.json'), 'an ancestor with its own source remains a measured program');
  assert.deepEqual(impact.required.get('fe/tsconfig.json'), [shared]);
  assert.deepEqual(impactFindings(fixture, impact).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: shared }]);
});

test('a referenced project can own app source outside its config directory', (t) => {
  const fixture = appFixture(t, { appConfig: 'fe/config/tsconfig.app.json', references: true, invalid: true });
  for (const files of [[APP_SOURCE], ['package.json', APP_SOURCE]]) {
    const impact = typeImpact(fixture.root, files, { readProject: readProject(fixture.root) });
    assert.deepEqual(impact.errors, []);
    assert.deepEqual(impact.projects, files.includes('package.json') ? [fixture.appConfig, 'fe/tsconfig.json'] : [fixture.appConfig]);
    assert.deepEqual(impact.required.get(fixture.appConfig), [APP_SOURCE]);
    assert.deepEqual(findingsOf(fixture, fixture.appConfig, impact.required.get(fixture.appConfig)).map((finding) => finding.rule), ['TS2322']);
  }
});

/** A narrower nested project leaves a real source file for its parent to measure. */
function partialAppFixture(t) {
  const fixture = appFixture(t);
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/index.ts', 'src/modules/api.ts'],
  });
  const uncovered = 'fe/apps/web/src/uncovered.ts';
  write(fixture.root, uncovered, 'export const broken: string = 1;\n');
  return { ...fixture, uncovered };
}

test('manifest impact retains parent coverage when a nested project includes only some source', (t) => {
  const fixture = partialAppFixture(t);
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.ok(impact.projects.includes('fe/tsconfig.json'), 'directory containment alone does not prove nested compiler coverage');
  assert.ok(findingsOf(fixture, 'fe/tsconfig.json').some((finding) => finding.rule === 'TS2322' && finding.path === fixture.uncovered));
});

test('direct selection of source omitted by its nested config uses its including ancestor', (t) => {
  const fixture = partialAppFixture(t);
  const impact = typeImpact(fixture.root, [fixture.uncovered], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.required.get('fe/tsconfig.json'), [fixture.uncovered]);
  assert.deepEqual(impactFindings(fixture, impact).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.uncovered }]);
});

test('a selected file excluded by every candidate still fails compiler coverage', (t) => {
  const fixture = partialAppFixture(t);
  write(fixture.root, 'fe/tsconfig.json', { compilerOptions: ROOT_OPTIONS, exclude: ['apps/web/src/uncovered.ts'] });
  const impact = typeImpact(fixture.root, [fixture.uncovered], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.required.get(APP_CONFIG), [fixture.uncovered]);
  assert.throws(() => impactFindings(fixture, impact), /GATE_TSC_FILE_EXCLUDED/);
});

test('sibling referenced configs that both include external source remain owning programs', (t) => {
  const first = 'fe/config-one/tsconfig.app.json', second = 'fe/config-two-longer/tsconfig.app.json';
  const fixture = appFixture(t, { appConfig: first, references: true });
  write(fixture.root, second, JSON.parse(fs.readFileSync(path.join(fixture.root, first), 'utf8')));
  write(fixture.root, 'fe/tsconfig.json', {
    compilerOptions: ROOT_OPTIONS,
    files: [],
    references: [{ path: './config-one/tsconfig.app.json' }, { path: './config-two-longer/tsconfig.app.json' }],
  });
  const impact = typeImpact(fixture.root, [APP_SOURCE], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [first, second]);
  assert.deepEqual(impact.required.get(first), [APP_SOURCE]);
  assert.deepEqual(impact.required.get(second), [APP_SOURCE]);
});

test('a removed default config can hand its source to a referenced custom config', (t) => {
  const fixture = appFixture(t, { appConfig: 'fe/apps/web/tsconfig.app.json', references: true });
  const impact = typeImpact(fixture.root, ['package.json', APP_CONFIG], {
    deleted: [APP_CONFIG],
    readProject: readProject(fixture.root),
  });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [fixture.appConfig, 'fe/tsconfig.json']);
});

test('source-only impact does not parse a malformed unrelated side config', (t) => {
  const fixture = appFixture(t);
  write(fixture.root, 'be/tsconfig.json', '{ invalid');
  const impact = typeImpact(fixture.root, [APP_SOURCE], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG]);
  assert.deepEqual(impact.required.get(APP_CONFIG), [APP_SOURCE]);
});

test('canonical generated dist declarations do not become source obligations', (t) => {
  const fixture = hfsAppFixture(t);
  write(fixture.root, 'fe/apps/web/dist/generated.d.ts', 'export declare const generated: string = 1;\n');
  const impact = broadImpact(fixture);
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG, 'fe/tsconfig.json']);
  assert.deepEqual(impactFindings(fixture, impact), []);
});

test('a leaf app retains generated ambient declarations and generated type validation inputs', (t) => {
  const fixture = hfsAppFixture(t), generated = 'fe/apps/web/.next/types/validation.ts';
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['next-env.d.ts', 'src/**/*.ts', '.next/types/**/*.ts'],
  });
  write(fixture.root, 'fe/apps/web/next-env.d.ts', 'declare const CANONICAL_VERSION: number;\n');
  write(fixture.root, APP_SOURCE, "import { api } from '@/modules/api';\nexport const value: number = api + CANONICAL_VERSION;\n");
  write(fixture.root, generated, 'export const broken: string = 1;\n');
  assert.deepEqual(findingsOf(fixture, APP_CONFIG).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: generated }]);
});

test('a residual app config retains its nearest app ambient declaration context', (t) => {
  const fixture = hfsAppFixture(t);
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['next-env.d.ts', 'src/**/*.ts'],
  });
  write(fixture.root, 'fe/apps/web/next-env.d.ts', 'declare const CANONICAL_VERSION: number;\n');
  const valid = 'const version: number = CANONICAL_VERSION;\nexport default { version };\n';
  write(fixture.root, fixture.peer, valid);
  assert.deepEqual(findingsOf(fixture, 'fe/tsconfig.json'), []);
  write(fixture.root, fixture.peer, valid.replace('version: number', 'version: string'));
  assert.deepEqual(findingsOf(fixture, 'fe/tsconfig.json').map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.peer }]);
  assert.deepEqual(baseFindingsOf(fixture, 'fe/tsconfig.json', new Map([[fixture.peer, valid]])), []);
});

/** A declared app config peer belongs to the same canonical metadata slot as its compiler config. */
function hfsAppFixture(t) {
  const fixture = appFixture(t), manifest = loadSlotManifest();
  write(fixture.root, 'hfs.json', {
    hfs: manifest.major,
    kind: 'app',
    project: 'fixture',
    edition: 'lite',
    sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } },
  });
  const peer = 'fe/apps/web/next.config.ts';
  write(fixture.root, peer, 'export default {};\n');
  const hfs = openHfs({ repoRoot: fixture.root, manifest });
  assert.equal(hfs.slotOf(peer)?.id, hfs.slotOf(APP_CONFIG)?.id);
  assert.equal(hfs.slotOf(peer)?.tier, 'none');
  return { ...fixture, peer, hfs };
}

test('a real error in canonical next.config.ts remains a broad-impact finding', (t) => {
  const fixture = hfsAppFixture(t);
  write(fixture.root, fixture.peer, 'const broken: string = 1;\nexport default { broken };\n');
  const impact = broadImpact(fixture);
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG, 'fe/tsconfig.json']);
  assert.deepEqual(impactFindings(fixture, impact).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.peer }]);
});

test('direct selection of canonical next.config.ts has an including compiler owner', (t) => {
  const fixture = hfsAppFixture(t);
  const impact = typeImpact(fixture.root, [fixture.peer], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.required.get('fe/tsconfig.json'), [fixture.peer]);
  assert.deepEqual(impactFindings(fixture, impact), []);
  write(fixture.root, fixture.peer, 'const broken: string = 1;\nexport default { broken };\n');
  assert.deepEqual(impactFindings(fixture, impact).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.peer }]);
});

test('side-only config roots use each app mapping when they import app source', (t) => {
  const fixture = hfsAppFixture(t), otherConfig = 'fe/apps/landing/tsconfig.json';
  const declaration = JSON.parse(fs.readFileSync(path.join(fixture.root, 'hfs.json'), 'utf8'));
  declaration.sides.fe.apps.push({ name: 'landing', kind: 'next' });
  write(fixture.root, 'hfs.json', declaration);
  write(fixture.root, fixture.peer, "import { api } from '@/modules/api';\nexport default { api };\n");
  write(fixture.root, otherConfig, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/**/*.ts'],
  });
  write(fixture.root, 'fe/apps/landing/src/modules/api.ts', 'export const api = "landing";\n');
  write(fixture.root, 'fe/apps/landing/next.config.ts', "import { api } from '@/modules/api';\nconst value: string = api;\nexport default { value };\n");
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.ok(impact.projects.includes(otherConfig));
  assert.deepEqual(impactFindings(fixture, impact), []);
});

test('HFS config metadata does not hide uncovered production source from the parent program', (t) => {
  const fixture = hfsAppFixture(t), source = 'fe/apps/web/src/modules/time/index.ts';
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/index.ts', 'src/modules/api.ts'],
  });
  write(fixture.root, source, 'export const broken: string = 1;\n');
  const sourceSlot = fixture.hfs.slotOf(source);
  assert.ok(sourceSlot, 'the uncovered source belongs to a canonical production slot');
  assert.notEqual(sourceSlot.tier, 'none');
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.ok(impact.projects.includes('fe/tsconfig.json'));
  assert.ok(findingsOf(fixture, 'fe/tsconfig.json').some((finding) => finding.rule === 'TS2322' && finding.path === source));
});

test('a project that owns only config metadata still reports its errors alongside referenced packages', (t) => {
  const fixture = hfsAppFixture(t), shared = 'fe/packages/shared/tsconfig.json';
  fs.unlinkSync(path.join(fixture.root, APP_SOURCE));
  fs.unlinkSync(path.join(fixture.root, 'fe/apps/web/src/modules/api.ts'));
  write(fixture.root, fixture.peer, 'const broken: string = 1;\nexport default { broken };\n');
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    files: ['next.config.ts'],
    references: [{ path: '../../packages/shared' }],
  });
  write(fixture.root, shared, {
    extends: '../../tsconfig.json',
    compilerOptions: { composite: true },
    include: ['src/**/*.ts'],
  });
  write(fixture.root, 'fe/packages/shared/src/index.ts', 'export const shared = 1;\n');
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG, shared, 'fe/tsconfig.json']);
  assert.ok(findingsOf(fixture, APP_CONFIG).some((finding) => finding.rule === 'TS2322' && finding.path === fixture.peer));
});

test('an HFS side-view keeps side-only app configuration measured', (t) => {
  const fixture = hfsAppFixture(t), side = path.join(fixture.root, 'fe');
  const impact = typeImpact(side, ['tsconfig.json'], { readProject: readProject(side) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, ['apps/web/tsconfig.json', 'tsconfig.json']);
  write(fixture.root, fixture.peer, 'const broken: string = 1;\nexport default { broken };\n');
  const sideFixture = { root: side };
  assert.deepEqual(impactFindings(sideFixture, impact).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: 'apps/web/next.config.ts' }]);
});

test('an explicitly declared missing parent root remains a compiler finding', (t) => {
  const fixture = appFixture(t);
  write(fixture.root, 'fe/tsconfig.json', { compilerOptions: ROOT_OPTIONS, files: ['missing.ts'] });
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    files: [],
    include: ['src/**/*.ts'],
  });
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.ok(impact.projects.includes('fe/tsconfig.json'));
  assert.ok(findingsOf(fixture, 'fe/tsconfig.json').some((finding) => finding.rule === 'TS6053'));
});

test('an include with no matches stays measured by the shipped reader and compiler', (t) => {
  const fixture = appFixture(t);
  write(fixture.root, 'fe/tsconfig.json', { compilerOptions: ROOT_OPTIONS, include: ['missing/**/*.ts'] });
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impact.projects, [APP_CONFIG, 'fe/tsconfig.json']);
  assert.ok(impactFindings(fixture, impact).some((finding) => finding.rule === 'TS18003'));
});

/** A real sibling config exists but cannot satisfy a compiler read outside the fixture's bound. */
function outsideConfig(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot(), 'hfs-gate-outside-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'tsconfig.json', { compilerOptions: ROOT_OPTIONS, files: [] });
  return path.join(root, 'tsconfig.json');
}

test('an extends outside the compiler bound is a tool error rather than absent coverage', (t) => {
  const fixture = appFixture(t), outside = outsideConfig(t);
  write(fixture.root, 'fe/tsconfig.json', { extends: outside });
  assert.throws(() => typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) }), /Cannot read file|could not be read/);
});

test('a reference outside the compiler bound is a tool error rather than a skipped program', (t) => {
  const fixture = appFixture(t), outside = outsideConfig(t);
  write(fixture.root, 'fe/tsconfig.json', { compilerOptions: ROOT_OPTIONS, files: [], references: [{ path: outside }] });
  assert.throws(() => typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) }), /GATE_TSC_OWNER_UNPROVEN.*outside the app/);
});

test('source named coverage remains an ancestor obligation instead of generated output', (t) => {
  const fixture = hfsAppFixture(t), source = 'fe/apps/web/src/coverage/x.ts';
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/index.ts', 'src/modules/api.ts'],
  });
  write(fixture.root, source, 'export const broken: string = 1;\n');
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.deepEqual(impactFindings(fixture, impact).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: source }]);
});

test('an ancestor reference finds an external including owner on narrow and broad impact', (t) => {
  const fixture = appFixture(t), external = 'fe/config/tsconfig.app.json', source = 'fe/apps/web/src/external.ts';
  write(fixture.root, 'fe/tsconfig.json', {
    compilerOptions: ROOT_OPTIONS,
    files: [],
    references: [{ path: './config/tsconfig.app.json' }],
  });
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/index.ts', 'src/modules/api.ts'],
  });
  write(fixture.root, external, {
    extends: '../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['../apps/web/src/*'] } },
    include: ['../apps/web/src/external.ts'],
  });
  write(fixture.root, source, 'export const broken: string = 1;\n');
  for (const files of [[source], ['package.json', source]]) {
    const impact = typeImpact(fixture.root, files, { readProject: readProject(fixture.root) });
    assert.deepEqual(impact.errors, []);
    assert.deepEqual(impact.required.get(external), [source]);
    assert.equal(impact.required.get(APP_CONFIG)?.includes(source) ?? false, false);
    assert.deepEqual(impactFindings(fixture, impact).filter((finding) => finding.rule === 'TS2322').map((finding) => finding.path), [source]);
  }
});

test('a fully delegated rootful aggregate retains its own reference options diagnostics', (t) => {
  const fixture = appFixture(t);
  write(fixture.root, 'fe/tsconfig.json', {
    compilerOptions: ROOT_OPTIONS,
    references: [{ path: './apps/web' }],
  });
  const impact = typeImpact(fixture.root, ['package.json'], { readProject: readProject(fixture.root) });
  assert.deepEqual(impact.errors, []);
  assert.ok(impact.projects.includes('fe/tsconfig.json'));
  assert.ok(findingsOf(fixture, 'fe/tsconfig.json').some((finding) => finding.rule === 'TS6306'));
});

test('a newly broken side-only config is new against its valid base program', (t) => {
  const fixture = hfsAppFixture(t);
  const valid = "import { api } from '@/modules/api';\nconst value: number = api;\nexport default { value };\n";
  write(fixture.root, fixture.peer, valid.replace('value: number', 'value: string'));
  const head = findingsOf(fixture, 'fe/tsconfig.json');
  const base = baseFindingsOf(fixture, 'fe/tsconfig.json', new Map([[fixture.peer, valid]]));
  assert.deepEqual(base, []);
  const judged = newTscFindings(head, base);
  assert.equal(judged.preexisting, 0);
  assert.deepEqual(judged.fresh.map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.peer }]);
});

test('an unchanged broken side-only config remains preexisting in the base comparison', (t) => {
  const fixture = hfsAppFixture(t);
  write(fixture.root, fixture.peer, 'const broken: string = 1;\nexport default { broken };\n');
  const source = fs.readFileSync(path.join(fixture.root, APP_SOURCE), 'utf8');
  const head = findingsOf(fixture, 'fe/tsconfig.json');
  const base = baseFindingsOf(fixture, 'fe/tsconfig.json', new Map([[APP_SOURCE, source]]));
  assert.deepEqual(base.map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.peer }]);
  assert.deepEqual(newTscFindings(head, base), { fresh: [], preexisting: 1 });
});

test('a second identical diagnostic in one config remains a new multiset finding', (t) => {
  const fixture = hfsAppFixture(t);
  const before = 'const first: string = 1;\nexport default { first };\n';
  write(fixture.root, fixture.peer, 'const first: string = 1;\nconst second: string = 2;\nexport default { first, second };\n');
  const head = findingsOf(fixture, 'fe/tsconfig.json');
  const base = baseFindingsOf(fixture, 'fe/tsconfig.json', new Map([[fixture.peer, before]]));
  const expected = { rule: 'TS2322', path: fixture.peer };
  const identity = ({ rule, path: file }) => ({ rule, path: file });
  assert.deepEqual(head.map(identity), [expected, expected]);
  assert.deepEqual(base.map(identity), [expected]);
  const judged = newTscFindings(head, base);
  assert.equal(judged.preexisting, 1);
  assert.deepEqual(judged.fresh.map(identity), [expected]);
});

test('base projection uses the base app include rather than current delegated membership', (t) => {
  const fixture = partialAppFixture(t);
  const before = fs.readFileSync(path.join(fixture.root, APP_CONFIG), 'utf8');
  write(fixture.root, APP_CONFIG, {
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/**/*.ts'],
  });
  assert.deepEqual(findingsOf(fixture, 'fe/tsconfig.json'), []);
  assert.deepEqual(findingsOf(fixture, APP_CONFIG).map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.uncovered }]);
  const base = baseFindingsOf(fixture, 'fe/tsconfig.json', new Map([[APP_CONFIG, before]]));
  assert.deepEqual(base.map(({ rule, path: file }) => ({ rule, path: file })), [{ rule: 'TS2322', path: fixture.uncovered }]);
});
