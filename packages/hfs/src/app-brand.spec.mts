// proves: HFS_BRAND_INVALID
// proves: HFS_BRAND_INVALID
// proves: HFS_BRAND_MISSING
// proves: HFS_BRAND_MISSING
// proves: HFS_BRAND_PROMPT_STALE
// proves: HFS_BRAND_PROMPT_STALE
// proves: HFS_BRAND_PROMPT_INCOMPLETE
// proves: HFS_BRAND_PROMPT_INCOMPLETE
// proves: HFS_BRAND_BASE_UNKNOWN
// proves: HFS_BRAND_BASE_UNKNOWN
// R437, the brand sheet (rules/brand.mts; contexts/project/brand.md PROJECT-BRAND-1, PROJECT-BRAND-2): `.starcistacks/brand/illustration.yaml` holds `basePrompt: { version, text }`, and every
// `statics/**/*.prompt.yaml` records the current version, a subject and a prompt that starts with the base text. The sheet's shape is an error; the rest are `local` (report-only in `--env local`).
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledPresets, runSync } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { brandFindings, parseBasePrompt, parseMediaBases } from '../runtime/scripts/hfs/rules/brand.mjs';
import { localOnlyCodes } from '../runtime/scripts/hfs/check-env.mjs';
import { A15_CODES, FINDERS } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const CODES = ['HFS_BRAND_INVALID', 'HFS_BRAND_MISSING', 'HFS_BRAND_PROMPT_STALE', 'HFS_BRAND_PROMPT_INCOMPLETE', 'HFS_BRAND_BASE_UNKNOWN'];
const BASE = 'A single 3D clay object on a white background, lit from the top left. One object plus at most one accent.';
const SHEET = (version: number | string = 1): string => `basePrompt:\n  version: ${version}\n  text: >-\n    A single 3D clay object on a white background,\n    lit from the top left. One object plus at most one accent.\n`;
const PROMPT = (over: Record<string, string> = {}): string => {
  const fields: Record<string, string> = { basePrompt: '\n  version: 1', subject: 'a contact card', prompt: `${BASE} a contact card`, model: 'image-model', seed: '7', ratio: '"1:1"', aiGenerated: 'true', approvedBy: 'owner', ...over };
  return `${Object.entries(fields).filter(([, value]) => value !== '').map(([key, value]) => `${key}: ${value}`).join('\n')}\n`;
};
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'app', 'skeleton', '.starcistacks', 'brand');

const write = (root: string, file: string, body: string): void => {
  const target = path.join(root, ...file.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
};
/** An app root with the files of `files` (app-relative path to text). */
function app(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-brand-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, body] of Object.entries(files)) write(root, file, body);
  return root;
}
const run = (root: string, edition = 'lite') => brandFindings({ repoRoot: root, repo: { kind: 'app', edition }, isRoot: true }) as { code: string; path: string; message: string; local?: boolean }[];
const codes = (list: { code: string }[]): string[] => list.map((finding) => finding.code);
const SHEET_FILE = '.starcistacks/brand/illustration.yaml';
const IMAGE = 'statics/illustrations/empty/customers.prompt.yaml';

test('the brand codes ship with the check, the three prompt codes are localOnly, and the brand folder has its tracked slot', () => {
  for (const code of CODES) assert.ok(A15_CODES.includes(code), code);
  assert.ok(FINDERS.includes(brandFindings));
  assert.deepEqual(CODES.filter((code) => localOnlyCodes().has(code)), CODES.slice(1));
  assert.equal(CODES.length, 5);
  const slot = loadSlotManifest().slots.find((entry) => entry.id === 'app.starcistacks.brand');
  assert.equal(slot?.path, '.starcistacks/brand/');
  assert.equal(slot?.tracked, 'tracked');
  for (const file of ['brand.md', 'illustration.md', 'illustration.yaml', 'media.md', 'media.yaml', 'references/**']) assert.ok(slot?.allows?.includes(file), file);
});

for (const edition of ['lite'] as const) {
  test(`an app with no prompt file and no brand folder has no finding, and neither does a sheet with no prompt file`, (t) => {
    assert.deepEqual(run(app(t, {}), edition), []);
    assert.deepEqual(run(app(t, { [SHEET_FILE]: SHEET() }), edition), []);
  });

  test(`a prompt file made from the current basePrompt, with a subject and the base text first, is green (a wrapped base compares equal)`, (t) => {
    assert.deepEqual(run(app(t, { [SHEET_FILE]: SHEET(), [IMAGE]: PROMPT() }), edition), []);
  });

  test(`HFS_BRAND_INVALID is an error, not local: a sheet that is not YAML or whose basePrompt is not { version, text }`, (t) => {
    for (const body of ['basePrompt: [', 'name: x\n', SHEET('"one"'), SHEET(0), SHEET(1.5), 'basePrompt:\n  version: 1\n  text: ""\n']) {
      const [finding, ...rest] = run(app(t, { [SHEET_FILE]: body }), edition);
      assert.equal(finding?.code, 'HFS_BRAND_INVALID', body);
      assert.equal(finding?.local, undefined);
      assert.deepEqual(rest, []);
    }
    assert.deepEqual(codes(run(app(t, { [SHEET_FILE]: 'name: x\n', [IMAGE]: PROMPT() }), edition)), ['HFS_BRAND_INVALID']);
  });

  test(`HFS_BRAND_MISSING when a prompt file exists and the app has no illustration.yaml, local`, (t) => {
    const [finding, ...rest] = run(app(t, { [IMAGE]: PROMPT(), 'statics/illustrations/errors/not-found.prompt.yaml': PROMPT() }), edition);
    assert.equal(finding?.code, 'HFS_BRAND_MISSING');
    assert.equal(finding?.local, true);
    assert.match(finding?.message ?? '', /2 prompt files under statics\//u);
    assert.deepEqual(rest, []);
  });

  test(`HFS_BRAND_PROMPT_STALE when the recorded version is another or absent, local, one finding per file`, (t) => {
    const root = app(t, {
      [SHEET_FILE]: SHEET(2),
      [IMAGE]: PROMPT(),
      'statics/illustrations/empty/orders.prompt.yaml': PROMPT({ basePrompt: '\n  version: 2' }),
      'statics/illustrations/empty/leads.prompt.yaml': PROMPT({ basePrompt: '' }),
    });
    const findings = run(root, edition);
    assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [
      ['HFS_BRAND_PROMPT_STALE', 'statics/illustrations/empty/customers.prompt.yaml'],
      ['HFS_BRAND_PROMPT_STALE', 'statics/illustrations/empty/leads.prompt.yaml'],
    ]);
    assert.ok(findings.every((finding) => finding.local === true));
    assert.match(findings[0]?.message ?? '', /records basePrompt.version 1, the current one is 2/u);
    assert.match(findings[1]?.message ?? '', /records no basePrompt.version/u);
  });

  test(`HFS_BRAND_PROMPT_INCOMPLETE when the subject is absent, the prompt does not start with the base text, or the file is not YAML, local`, (t) => {
    const root = app(t, {
      [SHEET_FILE]: SHEET(),
      'statics/a.prompt.yaml': PROMPT({ subject: '' }),
      'statics/b.prompt.yaml': PROMPT({ prompt: 'a contact card on a red background' }),
      'statics/c.prompt.yaml': 'subject: [\n',
    });
    const findings = run(root, edition);
    assert.deepEqual(findings.map((finding) => [finding.code, finding.path]), [
      ['HFS_BRAND_PROMPT_INCOMPLETE', 'statics/a.prompt.yaml'],
      ['HFS_BRAND_PROMPT_INCOMPLETE', 'statics/b.prompt.yaml'],
      ['HFS_BRAND_PROMPT_INCOMPLETE', 'statics/c.prompt.yaml'],
    ]);
    assert.ok(findings.every((finding) => finding.local === true));
  });

  test(`a repository that is not an app root has no finding, and a file other than *.prompt.yaml under statics/ is not read`, (t) => {
    const root = app(t, { [IMAGE]: PROMPT(), 'statics/readme.yaml': 'x: 1\n' });
    assert.deepEqual(brandFindings({ repoRoot: root, repo: { kind: 'be', edition }, isRoot: true }), []);
    assert.deepEqual(brandFindings({ repoRoot: root, repo: { kind: 'app', edition }, isRoot: false }), []);
    assert.deepEqual(codes(run(app(t, { [SHEET_FILE]: SHEET(), 'statics/readme.yaml': 'x: 1\n' }), edition)), []);
  });
}

test('parseBasePrompt: the version is a positive integer and the text is not empty', () => {
  assert.deepEqual(parseBasePrompt('basePrompt:\n  version: 3\n  text: hello\n'), { base: { version: 3, text: 'hello' }, problem: null });
  assert.match(parseBasePrompt('basePrompt: 1\n').problem ?? '', /no `basePrompt` object/u);
  assert.match(parseBasePrompt('basePrompt:\n  text: hello\n').problem ?? '', /not a positive integer/u);
});

test('the starter the scaffold writes is a valid, version 1 sheet with the default concept, and its prompt is judged green', (t) => {
  const sheet = fs.readFileSync(path.join(TEMPLATE, 'illustration.yaml'), 'utf8');
  const { base, problem } = parseBasePrompt(sheet);
  assert.equal(problem, null);
  assert.equal(base?.version, 1);
  for (const phrase of ['3D clay', 'top left', 'No text', 'no faces', 'medical crosses']) assert.ok(base?.text.includes(phrase), phrase);
  for (const file of ['brand.md', 'illustration.md']) assert.match(fs.readFileSync(path.join(TEMPLATE, file), 'utf8'), /TODO\(brand\)/u);
  assert.ok(fs.existsSync(path.join(TEMPLATE, 'references', '.gitkeep')));
  const root = app(t, { [SHEET_FILE]: sheet, [IMAGE]: PROMPT({ prompt: `${base?.text as string} a contact card` }) });
  assert.deepEqual(run(root), []);
});

// The scaffold writes the starter once and sync leaves it alone: a freshly scaffolded app carries the brand folder, its own check has no finding about it, and an edit of it is no drift.
for (const edition of ['lite'] as const) {
  test(`starci app scaffold writes .starcistacks/brand/ once, with the project name filled, and sync neither judges nor rewrites an edit of it`, async (t) => {
    const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-brand-scaffold-'));
    t.after(() => fs.rmSync(into, { recursive: true, force: true }));
    const lockedOk = (root: string): LockResult => { fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n'); return { ok: true }; };
    const { root, files } = scaffoldApp({ name: 'demo', harness: { version: '1.1.0-alpha.3' }, into, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
    for (const file of ['brand.md', 'illustration.md', 'illustration.yaml', 'media.md', 'media.yaml', 'references/.gitkeep']) assert.ok(files.includes(`.starcistacks/brand/${file}`), file);
    const brand = fs.readFileSync(path.join(root, '.starcistacks', 'brand', 'brand.md'), 'utf8');
    assert.match(brand, /^# demo brand$/mu);
    assert.ok(!brand.includes('{{'), 'every skeleton variable is filled');
    const codes = () => checkRepo({ repoRoot: root, harness: { version: '1.1.0-alpha.3' }, files }).findings.filter((finding) => finding.level === 'error' && /^(?:HFS_BRAND_|HFS_SLOT_|HFS_STACKS_|STACKS_SHAPE)/u.test(finding.code) && (finding.path ?? '').startsWith('.starcistacks/brand')).map((finding) => finding.code);
    assert.deepEqual(codes(), []);
    fs.writeFileSync(path.join(root, '.starcistacks', 'brand', 'brand.md'), '# Our brand\n');
    const lines: string[] = [];
    await runSync([], { cwd: root, out: (line: string) => lines.push(line), presets: bundledPresets() });
    assert.equal(lines.filter((line) => line.includes('.starcistacks/brand')).length, 0, lines.join('\n'));
    assert.deepEqual(codes(), []);
  });
}

// R437 media bases: `.starcistacks/brand/media.yaml` holds `bases: { <name>: { version, text } }`; a prompt file names its base in `basePrompt.name` (default `illustration`).
const MEDIA_FILE = '.starcistacks/brand/media.yaml';
const MEDIA = (version: number | string = 1): string => `bases:\n  social-image:\n    version: ${version}\n    text: >-\n      A natural photo,\n      soft daylight. No text.\n  presenter:\n    version: 1\n    text: A presenter in a plain studio.\n`;
const SOCIAL = 'A natural photo, soft daylight. No text.';
const named = (name: string, version = 1): string => `\n  name: ${name}\n  version: ${version}`;
const MEDIA_PROMPT = (over: Record<string, string> = {}): string => PROMPT({ basePrompt: named('social-image'), prompt: JSON.stringify(`${SOCIAL}\n\na team at a counter`), ...over });
const SOCIAL_FILE = 'statics/social/launch/hero.prompt.yaml';

for (const edition of ['lite'] as const) {
  test(`a prompt file made from a media base by name, version and text is green, with or without an illustration.yaml`, (t) => {
    assert.deepEqual(run(app(t, { [MEDIA_FILE]: MEDIA(), [SOCIAL_FILE]: MEDIA_PROMPT() }), edition), []);
    assert.deepEqual(run(app(t, { [SHEET_FILE]: SHEET(), [MEDIA_FILE]: MEDIA(), [SOCIAL_FILE]: MEDIA_PROMPT(), [IMAGE]: PROMPT() }), edition), []);
  });

  test(`HFS_BRAND_BASE_UNKNOWN when a prompt file names a base neither file defines, or names none and there is no illustration.yaml, local`, (t) => {
    const unknown = run(app(t, { [SHEET_FILE]: SHEET(), [MEDIA_FILE]: MEDIA(), [SOCIAL_FILE]: MEDIA_PROMPT({ basePrompt: named('video-broll') }) }), edition);
    assert.deepEqual(codes(unknown), ['HFS_BRAND_BASE_UNKNOWN']);
    assert.equal(unknown[0]?.local, true);
    assert.match(unknown[0]?.message ?? '', /"video-broll".*known: social-image, presenter, illustration/u);
    assert.deepEqual(codes(run(app(t, { [MEDIA_FILE]: MEDIA(), [IMAGE]: PROMPT() }), edition)), ['HFS_BRAND_BASE_UNKNOWN']);
    assert.deepEqual(codes(run(app(t, { [SHEET_FILE]: SHEET(), [SOCIAL_FILE]: MEDIA_PROMPT() }), edition)), ['HFS_BRAND_BASE_UNKNOWN']);
    assert.deepEqual(codes(run(app(t, { [SHEET_FILE]: SHEET(), [SOCIAL_FILE]: MEDIA_PROMPT({ basePrompt: named('7') }) }), edition)), ['HFS_BRAND_BASE_UNKNOWN']);
  });

  test(`a media prompt is stale against its own base's version and incomplete against its own base's text`, (t) => {
    const stale = run(app(t, { [MEDIA_FILE]: MEDIA(2), [SOCIAL_FILE]: MEDIA_PROMPT() }), edition);
    assert.deepEqual(codes(stale), ['HFS_BRAND_PROMPT_STALE']);
    assert.match(stale[0]?.message ?? '', /current one is 2.*base `social-image`/u);
    assert.ok(stale.every((finding) => finding.local === true));
    // The illustration base text is not the social-image text.
    const incomplete = run(app(t, { [SHEET_FILE]: SHEET(), [MEDIA_FILE]: MEDIA(), [SOCIAL_FILE]: MEDIA_PROMPT({ prompt: `${BASE} a team at a counter` }) }), edition);
    assert.deepEqual(codes(incomplete), ['HFS_BRAND_PROMPT_INCOMPLETE']);
    // A media base raised to version 2 leaves the illustration prompt (version 1) green.
    assert.deepEqual(run(app(t, { [SHEET_FILE]: SHEET(), [MEDIA_FILE]: MEDIA(2), [IMAGE]: PROMPT() }), edition), []);
  });

  test(`HFS_BRAND_INVALID is an error for a media.yaml of the wrong shape, and a base of an invalid file is not also unknown`, (t) => {
    const bases = (name: string, body: string): string => `bases:\n  ${name}:\n${body}`;
    const bodies = ['bases: [', 'name: x\n', 'bases: {}\n', bases('illustration', '    version: 1\n    text: x\n'), bases('Social_Image', '    version: 1\n    text: x\n'), bases('a-b', '    version: 0\n    text: x\n'), bases('a-b', '    version: 1\n    text: ""\n'), 'bases:\n  a-b: text\n'];
    for (const body of bodies) {
      const [finding, ...rest] = run(app(t, { [MEDIA_FILE]: body }), edition);
      assert.equal(finding?.code, 'HFS_BRAND_INVALID', body);
      assert.equal(finding?.path, MEDIA_FILE);
      assert.equal(finding?.local, undefined);
      assert.deepEqual(rest, []);
    }
    assert.deepEqual(codes(run(app(t, { [SHEET_FILE]: SHEET(), [MEDIA_FILE]: 'bases: [', [SOCIAL_FILE]: MEDIA_PROMPT(), [IMAGE]: PROMPT() }), edition)), ['HFS_BRAND_INVALID']);
  });
}

test('parseMediaBases: the names, versions and texts of the bases', () => {
  const { bases, problem } = parseMediaBases(MEDIA());
  assert.equal(problem, null);
  assert.deepEqual([...(bases ?? new Map()).keys()], ['social-image', 'presenter']);
  assert.match(parseMediaBases('bases: 1\n').problem ?? '', /no `bases` object/u);
  assert.match(parseMediaBases('bases:\n  x1:\n    version: "1"\n    text: a\n').problem ?? '', /not a positive integer/u);
});

test('the starter media.yaml holds social-image, video-broll and presenter at version 1, none asking for text in the pixels, and a prompt from each is judged green', (t) => {
  const sheet = fs.readFileSync(path.join(TEMPLATE, 'media.yaml'), 'utf8');
  const { bases, problem } = parseMediaBases(sheet);
  assert.equal(problem, null);
  assert.deepEqual([...(bases ?? new Map()).keys()], ['social-image', 'video-broll', 'presenter']);
  const files: Record<string, string> = { [MEDIA_FILE]: sheet };
  for (const [name, base] of bases ?? new Map<string, { version: number; text: string }>()) {
    assert.equal(base.version, 1, name);
    assert.match(base.text, /No text, no letters, no numbers/u, name);
    files[`statics/media/${name}.prompt.yaml`] = PROMPT({ basePrompt: named(name), prompt: JSON.stringify(`${base.text}\n\na team at a counter`) });
  }
  assert.match(fs.readFileSync(path.join(TEMPLATE, 'media.md'), 'utf8'), /^# \{\{project\}\} media$/mu);
  assert.deepEqual(run(app(t, files)), []);
});
