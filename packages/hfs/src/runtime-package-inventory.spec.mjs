// The root archive equals npm's selected tracked inputs and verified generated output; foreign files and omissions are red.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { runNpm } from '../runtime/scripts/api/npm/run-npm.mjs';
import { packTrackedSelection } from '../runtime/scripts/gates/runtime-package-selection.mjs';
import { runtimePackageInventory } from '../runtime/scripts/lib/runtime-package-inventory.mjs';
import { tarFiles } from '../runtime/scripts/lib/tar-files.mjs';

const TRACKED = ['package.json', 'scripts/main.mjs', 'docs/guide.md', 'contributor-only.txt'];
const GENERATED = ['packages/hfs/runtime/scripts/main.mjs'];
const SELECTED = [...TRACKED.slice(0, 3), ...GENERATED];
const archive = (names = SELECTED) => new Map(names.map((file) => [`package/${file}`, Buffer.from(file)]));
const inspect = (options = {}) => runtimePackageInventory({ files: archive(), tracked: TRACKED, generated: GENERATED, selected: SELECTED, ...options });

test('the archive equals the npm-selected tracked projection, including verified generated files', () => {
  assert.deepEqual(inspect(), { tracked: 3, generated: 1 });
  assert.deepEqual(inspect({ generated: [], selected: TRACKED.slice(0, 3), files: archive(TRACKED.slice(0, 3)) }), { tracked: 3, generated: 0 });
});

test('ignored build output, scratch files and unselected tracked files are refused', () => {
  for (const foreign of ['examples/app/.next/cache/webpack/cache.pack', 'scratch.txt', 'contributor-only.txt', 'packages/hfs/runtime/extra.mjs']) {
    const result = inspect({ files: archive([...SELECTED, foreign]) });
    assert.match(result.red, /outside npm's tracked-only selection/);
    assert.ok(result.red.includes(foreign));
  }
});

test('an omitted selected tracked or generated input is refused', () => {
  for (const missing of ['docs/guide.md', GENERATED[0]]) {
    const result = inspect({ files: archive(SELECTED.filter((file) => file !== missing)) });
    assert.match(result.red, /omits 1 file/);
    assert.ok(result.red.includes(missing));
  }
});

test('a generated root permits only the generator-owned output names', () => {
  const generated = ['ui/src/i18n/generated/catalog.json'];
  const selected = [...TRACKED.slice(0, 3), ...generated];
  const foreign = 'ui/src/i18n/generated/extra.mjs';
  const result = inspect({ generated, selected, files: archive([...selected, foreign]) });
  assert.match(result.red, /outside npm's tracked-only selection/);
  assert.ok(result.red.includes(foreign));
});

test('a selected file outside tracked and verified generated inputs fails closed', () => {
  assert.match(inspect({ selected: [...SELECTED, 'unexpected.mjs'] }).unrun, /outside the tracked projection/);
});

test('unavailable, duplicate and malformed inventories fail closed', () => {
  const absolute = path.join(tempRoot(), 'absolute').split(path.sep).join('/');
  for (const selected of [null, [], [...SELECTED, SELECTED[0]], ['../escape'], ['/absolute'], [absolute], ['a\0b'], ['a\\b'], ['a//b']]) assert.ok(inspect({ selected }).unrun);
  for (const tracked of [null, [], ['../escape']]) assert.ok(inspect({ tracked }).unrun);
  assert.ok(inspect({ generated: ['/absolute'] }).unrun);
  assert.match(inspect({ files: new Map([['package/../escape', Buffer.alloc(0)]]) }).red, /outside npm's tracked-only selection/);
});

/** A source package with tracked npm metadata, a verified generated input and git-ignored build output. */
function packageFixture(t) {
  const directory = fs.mkdtempSync(path.join(tempRoot(), 'tracked-inventory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'source');
  const source = {
    'package.json': JSON.stringify({ name: 'tracked-inventory-fixture', version: '1.0.0', files: ['payload/', 'generated/', 'README.md'] }),
    'package-lock.json': JSON.stringify({ name: 'tracked-inventory-fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'tracked-inventory-fixture', version: '1.0.0' } } }),
    '.gitignore': '.next/\n',
    'README.md': 'package readme\n',
    'payload/.npmignore': 'private-draft.md\n',
    'payload/main.mjs': 'export const ready = true;\n',
    'payload/private-draft.md': 'tracked but excluded by npm\n',
  };
  for (const [file, text] of Object.entries(source)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  fs.mkdirSync(path.join(root, 'generated'));
  fs.writeFileSync(path.join(root, 'generated', 'copy.mjs'), source['payload/main.mjs']);
  return { directory, root, tracked: Object.keys(source), generated: ['generated/copy.mjs'] };
}

test('real npm selection equals the tracked placeholder projection and honors nested npm metadata', (t) => {
  const { directory, root, tracked, generated } = packageFixture(t);
  const selected = packTrackedSelection(root, path.join(directory, 'projection'), { tracked, generated });
  assert.deepEqual(selected.sort(), ['README.md', 'generated/copy.mjs', 'package.json', 'payload/main.mjs']);
  const packed = runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory], { cwd: root });
  assert.equal(packed.status, 0, packed.stderr);
  const files = tarFiles(fs.readFileSync(path.join(directory, JSON.parse(packed.stdout)[0].filename)));
  assert.deepEqual(runtimePackageInventory({ files, tracked, generated, selected }), { tracked: 3, generated: 1 });
  for (const [file, bytes] of files) assert.deepEqual(bytes, fs.readFileSync(path.join(root, file.slice('package/'.length))));
});

test('a git-ignored .next cache carried by real npm is refused by the tracked projection', (t) => {
  const { directory, root, tracked, generated } = packageFixture(t);
  const cache = 'payload/.next/cache/webpack/cache.pack';
  fs.mkdirSync(path.dirname(path.join(root, cache)), { recursive: true });
  fs.writeFileSync(path.join(root, cache), 'ignored build cache');
  const selected = packTrackedSelection(root, path.join(directory, 'projection'), { tracked, generated });
  const preview = runNpm(['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root });
  assert.equal(preview.status, 0, preview.stderr);
  const previewFiles = archive(JSON.parse(preview.stdout)[0].files.map((file) => file.path));
  assert.match(runtimePackageInventory({ files: previewFiles, tracked, generated, selected }).red, /outside npm's tracked-only selection/);
  const packed = runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory], { cwd: root });
  assert.equal(packed.status, 0, packed.stderr);
  const files = tarFiles(fs.readFileSync(path.join(directory, JSON.parse(packed.stdout)[0].filename)));
  const names = [...files.keys()].map((file) => file.slice('package/'.length));
  assert.ok(names.includes(cache), 'npm files selection admits the git-ignored build cache');
  const result = runtimePackageInventory({ files, tracked, generated, selected });
  assert.match(result.red, /outside npm's tracked-only selection/);
  assert.ok(result.red.includes(cache));
});

test('an unavailable npm projection fails closed', (t) => {
  const { directory, root, tracked, generated } = packageFixture(t);
  assert.throws(() => packTrackedSelection(root, path.join(directory, 'projection'), { tracked, generated, run: () => ({ status: 1 }) }), /could not select/);
});
