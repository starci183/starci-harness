// proves: HFS_CANON_PIN_DRIFT@lite
// proves: HFS_CANON_PIN_DRIFT@full
// The canon pins: the bundled file pins no command line, the CLI that runs @starci/hfs supplies the starci-harness row, every
// @starci row names its folder's version here, and the runtime copies the canon packages carry are the same bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { HARNESS_PACKAGE, bundledPins, canonPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { pipelineFindings } from '../runtime/scripts/hfs/rules/pipeline.mjs';

const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');
const COPY = 'runtime/knowledge/hfs/canon-pins.yaml';
const COPIES = ['eslint-canon-be', 'eslint-canon-fe', 'eslint-grammar-core', 'eslint-grammar-offset-pop'];
const HARNESS = { version: '1.1.0-alpha.3' };

test('the bundled pins carry no starci-harness row: the CLI is pinned by the CLI that runs this package', () => {
  assert.equal(Object.hasOwn(bundledPins(), HARNESS_PACKAGE), false);
  assert.equal(Object.hasOwn(canonPins(), HARNESS_PACKAGE), false);
  assert.deepEqual(canonPins({ harness: HARNESS })[HARNESS_PACKAGE], { version: HARNESS.version, group: 'starci', install: 'registry', side: 'both' });
});

test('every @starci pin names its folder in starci-harness at the version there', () => {
  const rows = Object.entries(bundledPins()).filter(([, pin]) => pin.source !== undefined);
  assert.ok(rows.length > 0);
  for (const [name, pin] of rows) {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPOSITORY, pin.source), 'utf8'));
    assert.equal(manifest.name, name, pin.source);
    assert.equal(pin.version, manifest.version, `${name} is pinned at ${pin.version}, ${pin.source} is ${manifest.version}`);
  }
});

test('the canon packages carry the same bytes of the pins as @starci/hfs', () => {
  const own = fs.readFileSync(path.join(import.meta.dirname, '..', COPY));
  for (const pkg of COPIES) assert.ok(fs.readFileSync(path.join(REPOSITORY, 'packages', pkg, COPY)).equals(own), `packages/${pkg}/${COPY}`);
});

test('contexts/stack/pins.yaml names every @starci package at its bundled pin and pins no command line either', () => {
  const stack = parseYaml(fs.readFileSync(path.join(REPOSITORY, 'contexts', 'stack', 'pins.yaml'), 'utf8')).pins;
  assert.equal(Object.hasOwn(stack, HARNESS_PACKAGE), false);
  for (const [name, pin] of Object.entries(bundledPins()).filter(([, row]) => row.group === 'starci')) assert.equal(stack[name]?.version, pin.version, name);
});

for (const edition of ['lite', 'full']) {
  test(`HFS_CANON_PIN_DRIFT@${edition}: starci-harness is judged against the CLI that runs the check, never a bundled pin`, (t) => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-harness-pin-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    fs.writeFileSync(path.join(repoRoot, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'proof', edition, sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }));
    fs.mkdirSync(path.join(repoRoot, 'be'));
    fs.mkdirSync(path.join(repoRoot, 'fe'));
    const declare = (version) => fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ private: true, devDependencies: { [HARNESS_PACKAGE]: version } }));
    const drift = (harness) => checkRepo({ repoRoot, harness, files: ['hfs.json', 'package.json'] }).findings
      .filter((finding) => finding.code === 'HFS_CANON_PIN_DRIFT').map(({ dependency, pinned, declared }) => ({ dependency, pinned, declared }));

    declare('1.1.0-alpha.2');
    assert.deepEqual(drift(HARNESS), [{ dependency: HARNESS_PACKAGE, pinned: HARNESS.version, declared: '1.1.0-alpha.2' }]);
    assert.deepEqual(drift({ version: '1.1.0-alpha.2' }), [], 'the app declares the CLI that judges it');
    assert.deepEqual(drift(undefined), [], 'run without a CLI, nothing judges the app\'s starci-harness');
  });
}

test('HFS_CI_MISSING_CANON: a CI step naming a starci-harness version names the CLI that runs the check', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-harness-ci-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repoRoot, '.github', 'workflows'), { recursive: true });
  const findings = (version) => {
    fs.writeFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), `steps:\n  - run: npx starci-harness@${version} app lint\n`);
    return pipelineFindings({ repoRoot, files: ['.github/workflows/ci.yml'], pins: canonPins({ harness: HARNESS }) }).map((finding) => finding.code);
  };
  assert.deepEqual(findings(HARNESS.version), []);
  assert.deepEqual(findings('1.1.0-alpha.2'), ['HFS_CI_MISSING_CANON']);
});
