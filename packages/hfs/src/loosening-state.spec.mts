// A loosening is always red, and the tree is judged as it stands (owner rulings loosening-always-red and loosening-state-check). The state check
// (scripts/lib/loosening-state.mjs, the runtime's loosening-state self-check) reads files, never history: a deleted file and its spec, a re-pointed
// row, reworded text or a removed obsolete validation are not loosenings because nothing records what was there before. These specs prove the
// forms it refuses, the look-alikes it leaves alone, the lists it holds to the canon and the manifest, the thresholds, the exception files and the
// digest of the manifest. The forbidden spellings live in fixtures/loosening/, the declared fixture folder of knowledge/hfs/design-truths.yaml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { stateFindings, readTruths, truthsDigest, inScope, findingLine } from '../runtime/scripts/lib/loosening-state.mjs';
import { lexSource } from '../runtime/scripts/lib/js-lex.mjs';
// The fixtures are untyped .mjs data (src/fixtures is outside the typecheck): they are read by a dynamic import and typed here.
interface Form { id: string; file: string; text: string; kind: string; detail?: string }
interface Lookalike { id: string; file: string; text: string }
const fixtureModule = async <T,>(relative: string): Promise<T> => (await import(new URL(relative, import.meta.url).href)) as T;
const { FORBIDDEN, LOOKALIKES } = await fixtureModule<{ FORBIDDEN: Form[]; LOOKALIKES: Lookalike[] }>('./fixtures/loosening/forms.mjs');
const { FORBIDDEN_INDEX, LOOKALIKES_INDEX } = await fixtureModule<{ FORBIDDEN_INDEX: Form[]; LOOKALIKES_INDEX: Lookalike[] }>('./fixtures/bypass-index.mjs');
const { ADVERSARIAL, SAFE } = await fixtureModule<{ ADVERSARIAL: Form[]; SAFE: Lookalike[] }>('./fixtures/loosening/adversarial.mjs');

// reason: the design-truths manifest is YAML parsed from disk; its members are read and rebuilt by the specs below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Parsed = any;

const TRUTHS_TEXT = fs.readFileSync(new URL('../runtime/knowledge/hfs/design-truths.yaml', import.meta.url), 'utf8');
const TRUTHS = parseYaml(TRUTHS_TEXT);

/** The findings of a tree { [file]: text } under the manifest `truths` and the canon `canon`. */
const scan = (tree: Record<string, string>, { truths = TRUTHS, canon = {}, lists = true }: { truths?: Parsed; canon?: Parsed; lists?: boolean } = {}) => stateFindings({ files: Object.keys(tree), read: (file) => tree[file] ?? null, truths, canon, lists });
const kinds = (found: Array<{ kind: string }>) => found.map((entry) => entry.kind);
const withTruths = (extra: Parsed) => ({ ...TRUTHS, truths: [...TRUTHS.truths, extra] });

for (const form of [...FORBIDDEN, ...FORBIDDEN_INDEX]) {
  test(`red: ${form.id}`, () => {
    const found = scan({ [form.file]: form.text });
    assert.ok(found.some((entry) => entry.kind === form.kind && (form.detail === undefined || entry.detail.includes(form.detail))), `${form.id}: ${found.map(findingLine).join('; ') || 'no finding'}`);
  });
}

for (const form of ADVERSARIAL) {
  test(`red (adversarial): ${form.id}`, () => {
    const found = scan({ [form.file]: form.text }, { canon: {} });
    assert.ok(found.some((entry) => entry.kind === form.kind && (form.detail === undefined || entry.detail.includes(form.detail))), `${form.id}: ${found.map(findingLine).join('; ') || 'no finding'}`);
  });
}

for (const near of SAFE) {
  test(`not red (near miss): ${near.id}`, () => {
    assert.deepEqual(scan({ [near.file]: near.text }).map(findingLine), []);
  });
}

for (const lookalike of [...LOOKALIKES, ...LOOKALIKES_INDEX]) {
  test(`not red: ${lookalike.id}`, () => {
    assert.deepEqual(scan({ [lookalike.file]: lookalike.text }).map(findingLine), []);
  });
}

test('the check reads the tree and nothing else: a deleted file with its spec, a re-pointed row and reworded text leave no finding', () => {
  const before = { 'scripts/checks/old.mjs': 'export const a = 1;\n', 'packages/x/src/old.spec.mjs': "test('a', () => {});\n", 'knowledge/hfs/rules.yaml': 'rules:\n  - {id: R1, proves: [{path: packages/x/src/old.spec.mjs}]}\n' };
  const after = { 'knowledge/hfs/rules.yaml': 'rules:\n  - {id: R1, proves: [{path: packages/x/src/new.spec.mjs}]}\n', 'packages/x/src/new.spec.mjs': "test('a', () => {});\n", 'docs/a.md': 'The text says it differently now.\n' };
  assert.deepEqual(scan(before), []);
  assert.deepEqual(scan(after), []);
  assert.deepEqual(scan({}), [], 'an obsolete validation removed from a check leaves a tree with nothing to flag');
});

test('a loosening that stands is found whatever its age: the same tree gives the same findings every time', () => {
  const tree = { 'codecov.yml': 'ignore:\n  - "src/new/**"\n', 'scripts/x.mjs': '// @ts-nocheck\n' };
  assert.deepEqual(scan(tree), scan({ ...tree }));
  assert.deepEqual(kinds(scan(tree)).sort(), ['bypass', 'list-extra']);
});

const CANON = (by: string, items: string[]) => ({ derive: () => ({ by, items }) });

test('a list entry is green when the canon derives it for that file and the manifest names the derivation; an extra entry is red', () => {
  const tree = { 'codecov.yml': 'ignore:\n  - "be/**/*.module.ts"\n  - "be/src/extra.ts"\n' };
  const found = scan(tree, { canon: CANON('coverage-scope', ['be/**/*.module.ts']) });
  assert.deepEqual(found.map((entry) => entry.detail), ['ignore: be/src/extra.ts']);
});

test('an ignore that duplicates a broad glob is red unless the manifest lists it: a broad entry does not cover a narrower one', () => {
  const tree = { 'codecov.yml': 'ignore:\n  - "be/**"\n  - "be/src/a.ts"\n' };
  const derived = scan(tree, { canon: CANON('coverage-scope', ['be/**']) });
  assert.deepEqual(derived.map((entry) => entry.detail), ['ignore: be/src/a.ts']);
  const listing = withTruths({ id: 'x', cite: { ruling: 'design-truths-confirmed' }, says: 'x', allows: [{ list: 'coverage-exclusions', file: 'codecov.yml', entries: ['be/src/a.ts'] }] });
  assert.deepEqual(scan(tree, { truths: listing, canon: CANON('coverage-scope', ['be/**']) }), []);
  assert.equal(scan({ 'examples/a/codecov.yml': tree['codecov.yml'] as string }, { truths: listing, canon: CANON('coverage-scope', ['be/**']) }).length, 1, 'the entry holds for the file the manifest names, not for another');
});

test('a derivation the manifest does not name allows nothing', () => {
  const tree = { 'codecov.yml': 'ignore:\n  - "be/**"\n' };
  assert.deepEqual(scan(tree, { canon: CANON('not-in-the-manifest', ['be/**']) }).length, 1);
  assert.deepEqual(scan(tree, { canon: CANON('coverage-scope', ['be/**']) }), []);
});

test('the build output the canon declares outside every gate is not a list loosening, spelled any way', () => {
  const tree = { '.prettierignore': 'node_modules/\n**/dist/**\ncoverage\n./reports/\n*.tsbuildinfo\n', 'sonar-project.properties': 'sonar.exclusions=**/dist/**,**/coverage/**,**/node_modules/**\n' };
  assert.deepEqual(scan(tree), []);
});

test('a placeholder of a template is not an entry', () => {
  assert.deepEqual(scan({ 'sonar-project.properties': 'sonar.exclusions={{sonarExclusions}}\nsonar.coverage.exclusions={{coverageExclusions}}\n' }), []);
});

test('thresholds: a gate limit of the Sonar gate must equal the manifest, a floor lowered or a ceiling raised is red, the same number is not', () => {
  const file = 'knowledge/sonar-gate.yaml';
  assert.deepEqual(scan({ [file]: 'newCode:\n  coverage:\n    minPercent: 100\n  duplication:\n    maxPercent: 3\n  issues:\n    max: 0\n' }), []);
  assert.deepEqual(scan({ [file]: 'newCode:\n  coverage:\n    minPercent: 95\n' }).map((entry) => entry.detail), ['minPercent 95']);
  assert.deepEqual(scan({ [file]: 'newCode:\n  duplication:\n    maxPercent: 5\n' }).map((entry) => entry.detail), ['maxPercent 5']);
  assert.deepEqual(scan({ [file]: 'overall:\n  issues:\n    max: 4\n' }).map((entry) => entry.detail), ['max 4']);
});

test('settings: the design truth requireCi false is allowed because the manifest lists it; requireCi true and a codecov that does not require CI are judged apart', () => {
  assert.deepEqual(scan({ '.starcistacks/application-stacks.yaml': 'release:\n  requireCi: false\n' }), []);
  const without = { ...TRUTHS, truths: TRUTHS.truths.filter((truth: Parsed) => truth.id !== 'require-ci-defaults-false') };
  assert.deepEqual(scan({ '.starcistacks/application-stacks.yaml': 'release:\n  requireCi: false\n' }, { truths: without }).map((entry) => entry.kind), ['setting']);
  assert.deepEqual(scan({ '.starcistacks/application-stacks.yaml': 'release:\n  requireCi: true\n' }), []);
});

test('exception files: one the manifest lists holds only the entries it allows, any other is red', () => {
  assert.deepEqual(scan({ 'modules/kernel/allowlist.yaml': 'export-used: []\nsonar-rules: []\n' }), []);
  assert.deepEqual(scan({ 'modules/kernel/approvals.yaml': 'approvals: []\n' }).map((entry) => entry.kind), ['exception-file']);
  const listed = withTruths({ id: 'x', cite: { ruling: 'loosening-always-red' }, says: 'x', allows: [{ exceptionFile: 'modules/kernel/approvals.yaml', maxEntries: 1 }] });
  assert.deepEqual(scan({ 'modules/kernel/approvals.yaml': 'approvals:\n  - one\n' }, { truths: listed }), []);
  assert.deepEqual(scan({ 'modules/kernel/approvals.yaml': 'approvals:\n  - one\n  - two\n' }, { truths: listed }).map((entry) => entry.kind), ['exception-file']);
});

test('the app gate leaves the managed lists to the drift check and still judges markers, thresholds and exception files', () => {
  const tree = { 'codecov.yml': 'ignore:\n  - "x/**"\ncoverage:\n  status:\n    project:\n      default:\n        target: 80%\n' };
  assert.deepEqual(kinds(scan(tree, { lists: false })), ['threshold']);
});

test('scope: only the vendored dependency copy and the declared fixture files are not read; every other tracked file is, whatever its folder or name', () => {
  const truths = readTruths(TRUTHS);
  assert.equal(inScope('engine/yaml.mjs', truths), false);
  assert.equal(inScope('packages/hfs/src/fixtures/loosening/forms.mjs', truths), false);
  assert.equal(inScope('packages/hfs/src/fixtures/loosening/extra.mjs', truths), true, 'a file added beside the fixtures is not exempt');
  for (const file of ['a/dist/b.js', 'be/src/modules/build/a.ts', 'x.generated.ts', 'x.min.js', 'packages/hfs/coverage/cli.mjs', 'node_modules/x/index.js']) assert.equal(inScope(file, truths), true, file);
  assert.equal(inScope('packages/hfs/src/other.spec.mjs', truths), true);
});

/** The tree of the pinned files of the real manifest, with the digests of those texts as the pins. */
const PINNED = ['knowledge/hfs/design-truths.yaml', 'packages/hfs/src/fixtures/loosening/forms.mjs', 'packages/hfs/src/fixtures/loosening/swallows.mjs', 'packages/hfs/src/fixtures/loosening/adversarial.mjs', 'engine/yaml.mjs'];
const pinnedTree = () => Object.fromEntries(PINNED.map((file) => [file, fs.readFileSync(new URL(file.startsWith('packages/hfs/src/') ? `./${file.slice('packages/hfs/src/'.length)}` : `../runtime/${file}`, import.meta.url), 'utf8')]));
const pinsOf = (tree: Record<string, string>) => Object.fromEntries(Object.entries(tree).map(([file, text]) => [file, truthsDigest(text)]));
const pinKinds = (tree: Record<string, string>, pins: Record<string, string>) => stateFindings({ files: Object.keys(tree), read: (file) => tree[file] ?? null, truths: TRUTHS, pins }).filter((entry) => entry.kind === 'pin');

test('pins: the manifest, the fixtures and the vendored copy equal the digests the owner recorded; any difference is red', () => {
  const tree = pinnedTree();
  const pins = pinsOf(tree);
  assert.deepEqual(pinKinds(tree, pins), []);
  const edited = { ...tree, 'knowledge/hfs/design-truths.yaml': `${tree['knowledge/hfs/design-truths.yaml']}# an extra line\n` };
  assert.deepEqual(pinKinds(edited, pins).map((entry) => entry.file), ['knowledge/hfs/design-truths.yaml']);
  assert.match(pinKinds(edited, pins)[0]?.detail as string, /only an owner ruling may change it/);
  const weakened = { ...tree, 'packages/hfs/src/fixtures/loosening/adversarial.mjs': 'export const ADVERSARIAL = [];\nexport const SAFE = [];\n' };
  assert.deepEqual(pinKinds(weakened, pins).map((entry) => entry.file), ['packages/hfs/src/fixtures/loosening/adversarial.mjs']);
  assert.deepEqual(pinKinds({ ...tree, 'engine/yaml.mjs': `${tree['engine/yaml.mjs']}\nexport const injected = 1;\n` }, pins).map((entry) => entry.file), ['engine/yaml.mjs']);
});

test('pins: a declared file with no pin, a pinned file that is missing, and no ruling at all are red', () => {
  const tree = pinnedTree();
  const pins = pinsOf(tree);
  const { 'engine/yaml.mjs': dropped, ...fewer } = pins;
  assert.ok(dropped);
  assert.deepEqual(pinKinds(tree, fewer).map((entry) => entry.file), ['engine/yaml.mjs']);
  const { 'engine/yaml.mjs': gone, ...without } = tree;
  assert.ok(gone);
  assert.deepEqual(pinKinds(without, pins).map((entry) => entry.detail), ['a pinned file is missing']);
  assert.equal(pinKinds(tree, {}).length, PINNED.length, 'with no pins recorded every declared file is unpinned');
});

test('pins: a manifest that adds an exception turns the check red until the owner pins the new digest', () => {
  const tree = pinnedTree();
  const pins = pinsOf(tree);
  const text = (tree['knowledge/hfs/design-truths.yaml'] as string).replace('  - id: skip-lib-check-skips-third-party-declarations', "  - id: lane-exception\n    cite: {ruling: design-truths-confirmed}\n    says: A lane added this entry on its own say-so.\n    allows:\n      - {list: path-ignores, file: '**', entries: [src/hard]}\n  - id: skip-lib-check-skips-third-party-declarations");
  assert.notEqual(text, tree['knowledge/hfs/design-truths.yaml']);
  const lane = { ...tree, 'knowledge/hfs/design-truths.yaml': text };
  assert.equal(pinKinds(lane, pins).length, 1, 'the edited manifest differs from the pinned digest');
  assert.deepEqual(pinKinds(lane, { ...pins, 'knowledge/hfs/design-truths.yaml': truthsDigest(text) }), [], 'the owner recorded the new digest');
});

test('citations: a truth, a group, a budget pin or the gate limits cited by a rule or a source alone is a malformed manifest', () => {
  const bySource = { ...TRUTHS, truths: [{ id: 'x', cite: { source: 'a lane says so' }, says: 'x', allows: [{ setting: 'requireCi', value: false }] }] };
  assert.deepEqual(kinds(scan({}, { truths: bySource })), ['truths']);
  const group = { ...TRUTHS, outsideTheGates: [{ id: 'g', cite: { rule: 'R204' }, entries: ['x'] }] };
  assert.deepEqual(kinds(scan({}, { truths: group })), ['truths']);
  const limits = { ...TRUTHS, gateLimits: { ...TRUTHS.gateLimits, cite: undefined } };
  assert.deepEqual(kinds(scan({}, { truths: limits })), ['truths']);
});

test('allowances are bound to files: an entry listed for one file does not hold for another, and an allowance without a file is malformed', () => {
  assert.deepEqual(scan({ 'packages/grammar/tsconfig.build.json': '{"exclude": ["src/stories/**"]}' }), []);
  assert.deepEqual(kinds(scan({ 'be/tsconfig.json': '{"exclude": ["src/stories/**"]}' })), ['list-extra']);
  assert.deepEqual(scan({ 'be/tsconfig.json': '{"exclude": ["src/tests", "**/*.spec.ts"]}' }), []);
  assert.deepEqual(kinds(scan({ 'be/eslint.config.mjs': 'export default [{ ignores: ["**/*.spec.ts"] }];' })), ['list-extra']);
  const unbound = withTruths({ id: 'x', cite: { ruling: 'design-truths-confirmed' }, says: 'x', allows: [{ list: 'path-ignores', entries: ['src/hard'] }] });
  assert.deepEqual(kinds(scan({}, { truths: unbound })), ['truths']);
});

test('rooted output folders hold at the root only; build output holds at any depth', () => {
  assert.deepEqual(scan({ '.prettierignore': 'contracts/\nreports/\n' }), []);
  assert.deepEqual(kinds(scan({ '.prettierignore': '**/contracts/**\n' })), ['list-extra']);
  assert.deepEqual(scan({ '.prettierignore': '**/dist/**\n**/node_modules/**\n' }), []);
  assert.deepEqual(scan({ 'codecov.yml': 'ignore:\n  - "**/dist/**"\n' }), []);
});

test('the lexer reads a line break the way JavaScript does and a regular expression after a condition', () => {
  const afterBreak = lexSource(`const a = 1;\r// first\nconst b = 2;`);
  assert.deepEqual(afterBreak.comments.map((entry) => [entry.line, entry.text.trim()]), [[2, 'first']]);
  const afterHead = lexSource("if (ok) /'/.test(s); // note");
  assert.deepEqual(afterHead.comments.map((entry) => entry.text.trim()), ['note']);
  const division = lexSource("const half = (a) / 2; // note\nconst c = 'x';");
  assert.deepEqual(division.comments.map((entry) => entry.text.trim()), ['note']);
  assert.deepEqual(lexSource("<p>Don't {/* x */}</p>").comments.map((entry) => entry.text.trim()), ['x'], 'an apostrophe with no closing quote on its line is no string');
});

test('the manifest: its digest changes with the text and not with line endings, and a malformed truth is reported', () => {
  assert.equal(truthsDigest(TRUTHS_TEXT), truthsDigest(TRUTHS_TEXT.replaceAll('\n', '\r\n')));
  assert.notEqual(truthsDigest(TRUTHS_TEXT), truthsDigest(`${TRUTHS_TEXT}# changed\n`));
  assert.match(truthsDigest('x'), /^[0-9a-f]{64}$/);
  const anonymous = withTruths({ id: 'no-cite', says: 'x', allows: [{ setting: 'requireCi', value: false }] });
  assert.deepEqual(kinds(scan({}, { truths: anonymous })), ['truths']);
  assert.deepEqual(kinds(scan({}, { truths: { ...TRUTHS, schema: 'wrong' } })), ['truths']);
  assert.deepEqual(scan({}), [], 'the real manifest is well-formed');
});

test('every truth of the manifest names its cite, a sentence and what it allows', () => {
  for (const truth of TRUTHS.truths) {
    assert.ok(Object.keys(truth.cite).length > 0 && truth.says.length > 20 && truth.allows.length > 0, truth.id);
  }
  for (const group of TRUTHS.outsideTheGates) assert.ok(Object.keys(group.cite).length > 0 && group.entries.length > 0, group.id);
});

const SLOTS_TEXT = fs.readFileSync(new URL('../runtime/knowledge/hfs/slots.yaml', import.meta.url), 'utf8');
const RUNTIME_SLOTS = 'knowledge/hfs/runtime-slots.yaml';
const runtimeSlots = (soft: number) => `ruleParams:\n  runtime:\n    fileLines: {soft: ${soft}, hardGrowth: true}\n`;
const SLOTS = 'knowledge/hfs/slots.yaml';

/** The details of the budget findings of the slot manifest `text` at `file`. */
const budgetsOf = (file: string, text: string) => scan({ [file]: text }).filter((entry) => entry.kind === 'budget').map((entry) => entry.detail);

test('budgets: the slot manifests of the canon equal their pins', () => {
  assert.deepEqual(budgetsOf(SLOTS, SLOTS_TEXT), []);
  assert.deepEqual(budgetsOf(RUNTIME_SLOTS, runtimeSlots(500)), []);
});

test('budgets: a ceiling raised, a floor lowered, a slot budget raised or removed, and a hardGrowth turned off are red', () => {
  const raised = SLOTS_TEXT.replace('fileLines: {soft: 500, hardGrowth: true}', 'fileLines: {soft: 600, hardGrowth: true}');
  assert.deepEqual(budgetsOf(SLOTS, raised), ['fileLines.soft 600, the ceiling is 500']);
  assert.deepEqual(budgetsOf(SLOTS, SLOTS_TEXT.replace('functionLines: 80', 'functionLines: 120')), ['functionLines 120, the ceiling is 80']);
  assert.deepEqual(budgetsOf(SLOTS, SLOTS_TEXT.replace('duplicateBlock: {lines: 8, tokens: 60}', 'duplicateBlock: {lines: 8, tokens: 30}')), ['duplicateBlock.tokens 30, the floor is 60']);
  assert.deepEqual(budgetsOf(SLOTS, SLOTS_TEXT.replace('fileLines: {soft: 500, hardGrowth: true}', 'fileLines: {soft: 500, hardGrowth: false}')), ['fileLines.hardGrowth false, the canon says true']);
  assert.ok(budgetsOf(SLOTS, SLOTS_TEXT.replace('budget: {component.tsx: 300, index.tsx: 200, dataHooks: 6, useState: 6}', 'budget: {component.tsx: 900, index.tsx: 200, dataHooks: 6, useState: 6}')).some((detail) => detail.includes('component.tsx 900')));
  assert.ok(budgetsOf(SLOTS, SLOTS_TEXT.replace('budget: {file: 400}', 'budget: {}')).some((detail) => detail.includes('missing')));
  assert.deepEqual(budgetsOf(SLOTS, SLOTS_TEXT.replace('featureFiles: 250\n', '')), ['featureFiles missing, the ceiling is 250']);
  assert.deepEqual(budgetsOf(RUNTIME_SLOTS, runtimeSlots(800)), ['fileLines.soft 800, the ceiling is 500']);
  assert.deepEqual(budgetsOf(SLOTS, '{{'), ['the file is not readable YAML, so its budgets cannot be judged']);
});

test('budgets: a tightened budget is no loosening', () => {
  assert.deepEqual(budgetsOf(SLOTS, SLOTS_TEXT.replace('functionLines: 80', 'functionLines: 60')), []);
});

test('skipLibCheck is a design truth of the canon base tsconfig and of no other file', () => {
  const allowed = TRUTHS.truths.flatMap((truth: Parsed) => truth.allows).filter((allow: Parsed) => allow.compilerOption === 'skipLibCheck');
  assert.deepEqual(allowed.map((allow: Parsed) => allow.files), [['packages/tsconfig/base.json']]);
  const base = '{"compilerOptions": {"skipLibCheck": true}}';
  assert.deepEqual(scan({ 'packages/tsconfig/base.json': base }), []);
  assert.deepEqual(kinds(scan({ 'packages/tsconfig/next.json': base })), ['strictness']);
  assert.deepEqual(kinds(scan({ 'packages/tsconfig/base.json': '{"compilerOptions": {"skipLibCheck": true, "strict": false}}' })), ['strictness']);
});

test('a budget pin without a cite is a malformed manifest', () => {
  const uncited = { ...TRUTHS, budgets: [{ file: SLOTS }] };
  assert.deepEqual(kinds(scan({}, { truths: uncited })), ['truths']);
});

test('lex: strings, templates with nested expressions, regular expressions and comments are told apart, and lines stay right', () => {
  const text = "const a = 'x // y';\nconst b = `t ${ f('}') + `n${1}` } u`;\nconst c = /[/']+/g; // tail\n/* block\n line */\nconst d = 4 / 2;\n";
  const lexed = lexSource(text);
  assert.deepEqual(lexed.comments.map((entry) => [entry.line, entry.text.trim()]), [[3, 'tail'], [4, 'block'], [5, 'line']]);
  assert.ok(lexed.strings.some((entry) => entry.text === 'x // y' && entry.line === 1));
  assert.ok(lexed.strings.some((entry) => entry.text === '}'));
  assert.equal(lexed.code.length, text.length);
  assert.ok(lexed.code.split('\n')[5]?.includes('4 / 2'), 'a division is not a regular expression');
  assert.ok(!lexed.code.includes('tail') && !lexed.code.includes("'+"));
});

const HOOK_INPUT = 'modules/kernel/hook-input.yaml';
const HOOK_INPUT_TEXT = fs.readFileSync(new URL(`../runtime/${HOOK_INPUT}`, import.meta.url), 'utf8');

test('budgets: the hook input limits equal their pins, and a raised byte bound or deadline, a shortened input window or a removed limit is red', () => {
  assert.deepEqual(budgetsOf(HOOK_INPUT, HOOK_INPUT_TEXT), []);
  assert.deepEqual(budgetsOf(HOOK_INPUT, HOOK_INPUT_TEXT.replace('maxBytes: 1048576', 'maxBytes: 2097152')), ['maxBytes 2097152, the ceiling is 1048576']);
  assert.deepEqual(budgetsOf(HOOK_INPUT, HOOK_INPUT_TEXT.replace('verdictTimeoutMs: 20000', 'verdictTimeoutMs: 60000')), ['verdictTimeoutMs 60000, the ceiling is 20000']);
  assert.deepEqual(budgetsOf(HOOK_INPUT, HOOK_INPUT_TEXT.replace('minInputWindowMs: 5000', 'minInputWindowMs: 100')), ['minInputWindowMs 100, the floor is 5000']);
  assert.deepEqual(budgetsOf(HOOK_INPUT, HOOK_INPUT_TEXT.replace(/teardownTimeoutMs: 1000\r?\n/, '')), ['teardownTimeoutMs missing, the ceiling is 1000']);
});
