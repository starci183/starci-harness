/** The sides a project declares (PROJECT-1): hfs.json `sides` is any non-empty subset of be, fe and packages; R399 holds the tree and the stack declaration to it. */
// proves: HFS_SIDE_UNDECLARED@lite
// proves: HFS_SIDE_UNDECLARED@full
// proves: HFS_SIDE_FOLDER_MISSING@lite
// proves: STACKS_SIDES_DRIFT@lite
// proves: STACKS_SIDES_UNDECLARED@lite
// proves: STACKS_COMPONENT_SIDE@lite
import test from 'node:test';
import assert from 'node:assert/strict';
import { HfsSlotsError, declaredAppSides, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { sideFolderFindings, stackSideFindings } from '../runtime/scripts/hfs/rules/project-sides.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';

// reason: hfs.json declarations and stack documents are JSON trees the assertions build and judge.
type Json = any;
const manifest = loadSlotManifest();
const BE = { apps: [{ name: 'api', kind: 'api', contract: 'rest' }], kinds: ['api'] };
const FE = { apps: [{ name: 'web', kind: 'next' }], reads: ['be/contracts/'] };
const declare = (sides: Json, edition = 'lite') => resolveRepoDeclaration(manifest, { hfs: manifest.major, kind: 'app', project: 'demo', edition, sides });
const refused = (sides: Json, words: RegExp) => assert.throws(() => declare(sides), (error: unknown) => error instanceof HfsSlotsError && error.code === 'HFS_DECLARATION_INVALID' && words.test(error.message));

test('sides: any non-empty subset of be, fe and packages resolves; an empty set, an unknown side and a non-empty packages are refused', () => {
  assert.deepEqual(declare({ be: BE, fe: FE }).declaredSides, ['be', 'fe'], 'an app of both sides declares exactly them');
  assert.deepEqual(declare({ be: BE, packages: {} }).declaredSides, ['be', 'packages']);
  assert.deepEqual(declare({ fe: { apps: [{ name: 'web', kind: 'next' }] } }).declaredSides, ['fe']);
  assert.deepEqual(declare({ packages: {} }).declaredSides, ['packages']);
  assert.deepEqual(declaredAppSides(declare({ be: BE, packages: {} })), ['be'], 'only the declared app sides are judged');
  assert.deepEqual(declare({ be: BE, packages: {} }).sides!.fe.apps, [], 'an undeclared side resolves to an empty view');
  refused({}, /sides is empty/);
  refused({ be: BE, web: {} }, /sides\.web is not a side/);
  refused({ be: BE, packages: { apps: [] } }, /sides\.packages is the empty object/);
  refused({ fe: FE }, /sides\.fe\.reads names be\/contracts\/, but the project does not declare the be side/);
  assert.deepEqual(declarationShapeProblems({ hfs: 3, kind: 'app', project: 'demo', sides: { be: BE, fe: FE } }, ['be', 'fe']), [], 'both sides stay lawful');
});

test('R399 the tree: a declared side tracks files, a tracked side folder is declared', () => {
  const rest = declare({ be: BE, packages: {} });
  assert.deepEqual(sideFolderFindings(rest, ['hfs.json', 'be/apps/api/src/main.ts', 'packages/sdk/package.json']), [], 'be and packages tracked and declared');
  const missing = sideFolderFindings(rest, ['hfs.json', 'be/apps/api/src/main.ts']);
  assert.deepEqual(missing.map((finding) => [finding.code, finding.path]), [['HFS_SIDE_FOLDER_MISSING', 'packages/']]);
  assert.match(missing[0]!.message, /declares the packages side, but no file is tracked under packages\//);
  const undeclared = sideFolderFindings(rest, ['hfs.json', 'be/apps/api/src/main.ts', 'packages/sdk/package.json', 'fe/apps/web/package.json']);
  assert.deepEqual(undeclared.map((finding) => [finding.code, finding.path]), [['HFS_SIDE_UNDECLARED', 'fe/']]);
  const legacy = sideFolderFindings(declare({ be: BE, fe: FE }, 'full'), ['be/a.ts', 'fe/b.ts', 'packages/sdk/package.json']);
  assert.deepEqual(legacy.map((finding) => finding.code), ['HFS_SIDE_UNDECLARED'], 'a root package of an app that does not declare packages is reported');
  assert.match(legacy[0]!.message, /"packages": \{\}/);
});

test('R399 the stack: its sides equal hfs.json, and no component runs a side the project lacks', () => {
  const rest = declare({ be: BE, packages: {} });
  const sides = { be: true, fe: false, packages: true };
  const env = (images: Json, processes: Json[] = []) => ({ dev: { local: { processes } }, production: { deploy: { images } } });
  assert.deepEqual(stackSideFindings(rest, { sides, environments: env({ api: { app: 'api' }, db: { app: 'db' } }, [{ name: 'api', cwd: 'be', argv: ['npx'] }]) }), []);
  const absent = stackSideFindings(rest, { environments: {} });
  assert.deepEqual(absent.map((finding) => [finding.code, finding.level]), [['STACKS_SIDES_UNDECLARED', 'warning']]);
  assert.match(absent[0]!.message, /sides: \{be: true, fe: false, packages: true\}/);
  const drift = stackSideFindings(rest, { sides: { be: true, fe: true, packages: true }, environments: {} });
  assert.deepEqual(drift.map((finding) => finding.code), ['STACKS_SIDES_DRIFT']);
  assert.match(drift[0]!.message, /fe must be false/);
  const web = stackSideFindings(rest, { sides, environments: env({ api: { app: 'api' }, web: { app: 'web', buildArgs: { values: {} } } }, [{ name: 'web', argv: ['npm', 'run', 'dev:fe'] }]) });
  assert.deepEqual(web.map((finding) => finding.code), ['STACKS_COMPONENT_SIDE', 'STACKS_COMPONENT_SIDE']);
  assert.match(web[1]!.message, /deploy\.images\.web builds the app web, which no declared side declares/);
  assert.match(web[0]!.message, /local\.processes web runs the fe side/);
  const both = declare({ be: BE, fe: FE });
  assert.deepEqual(stackSideFindings(both, { sides: { be: true, fe: true, packages: false }, environments: env({ api: { app: 'api' }, web: { app: 'web', buildArgs: { values: {} } } }) }), [], 'an app of both sides keeps its web component');
});
