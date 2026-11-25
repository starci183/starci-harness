// `knowledge/hfs/canon-pins.yaml` is a part of its own in the fingerprint (check-cache.md "The fingerprint"): a package's source digest covers every tracked file, so a
// Grammar-only release that moved the pins used to make the `hfs` part differ and re-run every hfs-run family (NIVO's full gate after such a bump logged `hfs structure
// reused 0 checked 12868`, 8m25s). The packed manifest now carries the digest in parts (`starciSourceParts`: `core` and `canon-pins`); the `hfs` part is the core, the pins a part
// no family's records read, because the pin rules (canon-pins.mts, pin-findings.mts, the pipeline rule's hfs pin) judge them every run and nothing cached derives from them.
// The law holds: a reused result is the one a full run gives now. These specs prove it from both sides: a pins-only change reuses every structure record and the pin
// findings are recomputed from the new pins; a change of anything else in hfs still re-runs the families; and no cached step reads the pin data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, differencesByFamily, familiesOfPart, fingerprintDifferences, SOURCE_FIELD, SOURCE_PARTS_FIELD } from '../cache/fingerprint.mjs';
import { FAMILIES } from '../cache/types.mjs';
import { pinFindings } from '../runtime/scripts/hfs/pin-findings.mjs';
import { APP_SCOPE } from '../runtime/scripts/hfs/slots.mjs';
import { appRepo, FILES, PORTABLE, runPass, write } from './check-cache-structure-support.mjs';

const HFS_ROOT = fileURLToPath(new URL('..', import.meta.url));
const digest = (letter: string): string => letter.repeat(64);

/** An app root with `@starci/hfs` installed from a published build whose manifest carries the given source digest and, when given, its parts. */
function app(t: { after(fn: () => void): void }, manifest: { source: string; parts?: Record<string, string> }): { root: string; hfsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-canon-pins-part-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'node_modules', '@starci', 'hfs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@starci/hfs', version: '6.17.15', [SOURCE_FIELD]: manifest.source, ...(manifest.parts === undefined ? {} : { [SOURCE_PARTS_FIELD]: manifest.parts }) }));
  const entry = { version: '6.17.15', integrity: 'sha512-x', resolved: 'https://registry.npmjs.org/@starci/hfs/-/hfs-6.17.15.tgz' };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/@starci/hfs': entry } }));
  return { root, hfsDir: dir };
}

const printed = (given: { root: string; hfsDir: string }) => computeFingerprint({ root: given.root, tracked: [], hfsDir: given.hfsDir });
const familiesBetween = (before: { root: string; hfsDir: string }, after: { root: string; hfsDir: string }): Map<string, string[]> =>
  differencesByFamily(fingerprintDifferences(printed(before).parts, printed(after).parts));

test('the pins are a part of their own that no family reads; the hfs part is the core of the source', (t) => {
  assert.deepEqual(familiesOfPart('hfs:canon-pins'), []);
  assert.deepEqual(familiesOfPart('pkg:@starci/hfs:canon-pins'), []);
  assert.deepEqual(familiesOfPart('hfs'), ['hfs', 'secrets', 'wiring', 'db', 'uiaudit']);
  const one = app(t, { source: digest('1'), parts: { core: digest('c'), 'canon-pins': digest('a') } });
  const names = printed(one).parts.map((part) => part.name);
  assert.ok(names.includes('hfs') && names.includes('hfs:canon-pins') && names.includes('pkg:@starci/hfs') && names.includes('pkg:@starci/hfs:canon-pins'), names.join(', '));
  const core = printed(one).parts.find((part) => part.name === 'hfs');
  assert.ok(core !== undefined);
  assert.notEqual(core.sha256, printed(app(t, { source: digest('1') })).parts.find((part) => part.name === 'hfs')?.sha256, 'the part is the core, not the whole digest');
});

test('a change of canon-pins alone leaves every family\'s fingerprint as it was; a change of anything else in hfs re-runs the hfs-run families', (t) => {
  const before = app(t, { source: digest('1'), parts: { core: digest('c'), 'canon-pins': digest('a') } });
  const pinsOnly = app(t, { source: digest('2'), parts: { core: digest('c'), 'canon-pins': digest('b') } });
  assert.deepEqual([...familiesBetween(before, pinsOnly).keys()], [], 'a Grammar-only release moves the whole digest and the pins part, and no family');
  assert.deepEqual(fingerprintDifferences(printed(before).parts, printed(pinsOnly).parts), ['hfs:canon-pins', 'pkg:@starci/hfs:canon-pins']);
  const rules = app(t, { source: digest('3'), parts: { core: digest('d'), 'canon-pins': digest('a') } });
  assert.deepEqual([...familiesBetween(before, rules).keys()].sort(), ['db', 'hfs', 'secrets', 'uiaudit', 'wiring']);
  const both = app(t, { source: digest('4'), parts: { core: digest('d'), 'canon-pins': digest('b') } });
  assert.deepEqual([...familiesBetween(before, both).keys()].sort(), ['db', 'hfs', 'secrets', 'uiaudit', 'wiring']);
});

test('a build packed before the parts existed is keyed by its whole digest, as it was: any change re-runs the hfs-run families', (t) => {
  const before = app(t, { source: digest('1') });
  const after = app(t, { source: digest('2') });
  assert.deepEqual([...familiesBetween(before, after).keys()].sort(), ['db', 'hfs', 'secrets', 'uiaudit', 'wiring']);
  assert.equal(printed(before).parts.some((part) => part.name.includes('canon-pins')), false);
  const mixed = app(t, { source: digest('1'), parts: { core: digest('c'), 'canon-pins': digest('a') } });
  assert.deepEqual([...familiesBetween(before, mixed).keys()].sort(), ['db', 'hfs', 'secrets', 'uiaudit', 'wiring'], 'a build with parts never matches one without: the cache is conservative across the change');
});

test('a manifest whose parts are unreadable, or that lacks the whole digest, is keyed by the whole digest', (t) => {
  for (const parts of [[] as unknown as Record<string, string>, { 'canon-pins': digest('a') }, { core: '' }]) {
    const odd = app(t, { source: digest('1'), parts });
    assert.equal(printed(odd).parts.some((part) => part.name === 'hfs:canon-pins'), false);
    assert.equal(printed(odd).parts.find((part) => part.name === 'hfs')?.sha256, printed(app(t, { source: digest('1') })).parts.find((part) => part.name === 'hfs')?.sha256);
  }
});

test('a pins-only change reuses every structure record and the pin findings are recomputed from the new pins', async (t) => {
  const root = appRepo(t, { ...FILES, 'package.json': JSON.stringify({ name: 'demo', devDependencies: { zod: '3.0.0' } }) });
  const parts = (pins: string) => ({ ...PORTABLE, parts: [{ name: 'hfs', sha256: 'core-1' }, { name: 'hfs:canon-pins', sha256: pins }, { name: 'pkg:@starci/hfs:canon-pins', sha256: pins }] });
  const cold = await runPass(root, { fingerprint: parts('pins-1'), secrets: true });
  assert.equal(cold.pass.report?.mode, 'full');
  assert.ok((cold.pass.report?.checked ?? 0) > 0);
  // The pins moved: the fingerprint's only difference is the pins part, which no family reads.
  const differing = differencesByFamily(fingerprintDifferences(parts('pins-1').parts, parts('pins-2').parts));
  assert.equal(differing.size, 0);
  const warm = await runPass(root, { fingerprint: parts('pins-2'), secrets: true });
  t.diagnostic(`canon-pins-only change: cold checked ${String(cold.pass.report?.checked)}, warm reused ${String(warm.pass.report?.reused)} checked ${String(warm.pass.report?.checked)}`);
  assert.equal(warm.pass.report?.mode, 'diff', 'the structure family runs diff-only');
  assert.equal(warm.pass.report?.checked, 0, 'no file is judged again');
  assert.ok((warm.pass.report?.reused ?? 0) > 0);
  assert.equal(warm.pass.secretsReport?.checked, 0);
  assert.deepEqual(warm.calls, [], 'the architecture machine of neither side runs again');
  // The pin rules run every run, on the pins now in force: the same package.json is drift under one pin map and clean under another.
  const judge = (version: string) => pinFindings({ repoRoot: root, files: ['package.json'], profile: APP_SCOPE, pins: { zod: { version, side: 'both' } }, only: null });
  assert.deepEqual(judge('3.0.0'), [], 'the old pins accept the manifest');
  assert.deepEqual(judge('3.1.0').map((finding) => finding.code), ['HFS_CANON_PIN_DRIFT'], 'the new pins are judged now, with no record to stand in the way');
  // And the law's other side: a change of the core still runs the family in full.
  write(root, 'be/src/notes.ts', 'export const notes = 1;\n');
  const core = { ...PORTABLE, parts: [{ name: 'hfs', sha256: 'core-2' }, { name: 'hfs:canon-pins', sha256: 'pins-2' }, { name: 'pkg:@starci/hfs:canon-pins', sha256: 'pins-2' }] };
  const full = await runPass(root, { fingerprint: core, secrets: true });
  assert.equal(full.pass.report?.mode, 'full');
  assert.equal(full.pass.report?.reused, 0);
});

test('no cached step reads the pin data: the pin rules are the only consumers of canon-pins in the checks, and they run every run', () => {
  const sources = (folder: string): string[] => fs.readdirSync(path.join(HFS_ROOT, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mts') && !entry.name.endsWith('.d.mts') && !entry.name.endsWith('.spec.mts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  const consumers = (folder: string): string[] => sources(folder)
    .filter((file) => /canon-pins\.mjs|bundledPins|canonPins\(/u.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(HFS_ROOT, file).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(consumers('cache'), [], 'nothing under cache/ reads the pins: a record can never be derived from them');
  assert.deepEqual(consumers('runtime/scripts'), ['runtime/scripts/hfs/canon-pins.mts', 'runtime/scripts/hfs/check.mts', 'runtime/scripts/hfs/pin-findings.mts'],
    'a new consumer of canon-pins is a reader the fingerprint must name: give it a family in SPLIT_PARTS, or keep the pins in the hfs part');
  const memoed = fs.readFileSync(path.join(HFS_ROOT, 'cache', 'structure-memo.mts'), 'utf8');
  assert.match(memoed, /Everything else the pass runs \(the slots, the tree, the pins,/u, 'the memo documents that the pins stay always-run');
  assert.ok(FAMILIES.includes('hfs'));
});
