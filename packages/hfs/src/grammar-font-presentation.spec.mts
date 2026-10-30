/** Family typography keeps every semantic font case and its concrete proof contract. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { familyPresentationKnowledge as presentedKnowledge, fontWeightsOf } from '../runtime/scripts/hfs/grammar-presentation.mjs';

// reason: the topics and playbooks are YAML parsed from disk; the shapes the assertions read are judged by those assertions at run time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Parsed = any;
interface Topic { rel: string; layer?: string; doc: Parsed; familySource?: string }
interface Presented { family: string; knowledge: Topic[] }
// reason: the library types the presented topics loosely (index signatures); the spec reads them as the parsed documents they are.
const presented = (knowledge: Topic[], options: { family: string }): Presented => presentedKnowledge(knowledge as unknown as Parameters<typeof presentedKnowledge>[0], options) as unknown as Presented;

const STARCI =fileURLToPath(new URL('../runtime/knowledge/grammars/core/playbook.yaml', import.meta.url));
const OFFSET_POP = fileURLToPath(new URL('../runtime/knowledge/grammars/offset-pop/playbook.yaml', import.meta.url));
const TOPICS = ['padding', 'font'];

const topics = (): Topic[] => TOPICS.map(name => ({
  rel: `knowledge/ui/presentation/${name}.yaml`,
  layer: 'presentation',
  doc: parseYaml(fs.readFileSync(new URL(`../runtime/knowledge/ui/presentation/${name}.yaml`, import.meta.url), 'utf8')),
}));

const fontOf = (result: Presented) => result.knowledge.find((topic) => topic.rel.endsWith('presentation/font.yaml')) as Topic;

function replaceFont(context: TestContext, file: string, change: (presentation: Parsed) => void) {
  const originalRead = fs.readFileSync;
  const doc = parseYaml(originalRead(file, 'utf8'));
  change(doc.presentation);
  context.mock.method(fs, 'readFileSync', function readPresentation(this: unknown, input: unknown, ...options: unknown[]) {
    if (typeof input === 'string' && path.resolve(input) === file) return JSON.stringify(doc);
    return (originalRead as (...args: unknown[]) => unknown).call(this, input, ...options);
  });
}

test('the family font recipe preserves all six semantic ranks and all nine cases without mutating knowledge', () => {
  const universal = topics();
  const before = structuredClone(universal);
  const result = presented(universal, { family: 'core' });
  const font = fontOf(result);
  assert.equal(font.doc.rules.length, 6);
  assert.equal(font.doc.rules.reduce((count: number, rule: Parsed) => count + rule.cases.length, 0), 9);
  const identities = (doc: Parsed) => doc.rules.map((rule: Parsed) => [rule.id, rule.cases.map((item: Parsed) => item.id)]);
  assert.deepEqual(identities(font.doc), identities((before.find(topic => topic.rel.endsWith('font.yaml')) as Topic).doc));
  assert.deepEqual(font.doc.scale.steps.map((step: Parsed) => step.id), ['FONT-1', 'FONT-2', 'FONT-3', 'FONT-4', 'FONT-5', 'FONT-6']);
  assert.match(font.familySource as string, /grammars\/core\/playbook.yaml#presentation\.font$/);
  assert.deepEqual(universal, before);
});

test('concrete font titles and render props remain available to numerical proof after semantic titles change', () => {
  const font = fontOf(presented(topics(), { family: 'core' }));
  const expected = new Map([
    ['FONT-1', 'text-xs'], ['FONT-2', 'text-sm'], ['FONT-3', 'text-base'],
    ['FONT-4', 'text-xl'], ['FONT-5', 'text-3xl'], ['FONT-6', 'text-4xl'],
  ]);
  for (const rule of font.doc.rules) {
    assert.ok(rule.familyTitle.includes(expected.get(rule.id)), rule.id);
    for (const item of rule.cases) {
      assert.equal(typeof item.owner, 'string');
      assert.equal(typeof item.render, 'string');
      assert.match(item.recipeSource, /#presentation\.font$/);
    }
  }
  const display = font.doc.rules.find((rule: Parsed) => rule.id === 'FONT-6').cases[0];
  assert.match(display.render, /scale="display"/);
  assert.match(display.render, /level=\{1\}/);
});

test('one semantic weight guidance retains its separately owned concrete weight table', () => {
  const universal = topics();
  const requirement = (universal.find(topic => topic.rel.endsWith('font.yaml')) as Topic).doc.guidance.find((item: Parsed) => item.id === 'weight').requirement;
  const font = fontOf(presented(universal, { family: 'core' }));
  const weights = font.doc.guidance.filter((item: Parsed) => item.id === 'weight');
  assert.equal(weights.length, 1);
  assert.equal(weights[0].requirement, requirement);
  for (const name of ['font-normal', 'font-medium', 'font-semibold']) assert.ok(weights[0].familyRequirement.includes(name), name);
});

test('font component ownership includes the previously unresolved action labels and both fact depths', () => {
  const font = fontOf(presented(topics(), { family: 'core' }));
  const rows = font.doc.componentOwnership.rows;
  assert.ok(rows.some((row: Parsed) => row.component === 'Input' && /reveal/.test(row.element) && row.rule === 'FONT-1'));
  const facts = rows.filter((row: Parsed) => row.component === 'SurfaceListCard' && /fact/.test(row.element));
  assert.deepEqual(new Set(facts.map((row: Parsed) => row.rule)), new Set(['FONT-1', 'FONT-2']));
  assert.equal(new Set(facts.map((row: Parsed) => row.element)).size, 2);
  for (const row of rows) assert.ok(font.doc.scale.steps.some((step: Parsed) => step.id === row.rule), `${row.component}/${row.element}`);
});

test('the scoring resolver retains normal, medium and semibold weights from the selected family matrix', () => {
  const font = fontOf(presented(topics(), { family: 'core' }));
  const guidance = font.doc.guidance.find((item: Parsed) => item.id === 'weight');
  const tokens: Record<string, string> = { '--font-weight-normal': '400', '--font-weight-medium': '500', '--font-weight-semibold': '600' };
  const scope = { variable: (name: string) => ({ value: tokens[name] }) };
  const original = parseYaml(fs.readFileSync(STARCI, 'utf8')).presentation.font.guidance.find((item: Parsed) => item.id === 'weight');
  assert.deepEqual(fontWeightsOf(guidance, scope), [400, 500, 600]);
  assert.deepEqual(fontWeightsOf(guidance, scope), fontWeightsOf(original, scope));
});

test('missing family weight guidance fails instead of removing the scoring row', (context: TestContext) => {
  replaceFont(context, STARCI, (presentation: Parsed) => { delete presentation.font.guidance; });
  assert.throws(() => presented(topics(), { family: 'core' }), /font guidance needs one concrete weight matrix/);
});

test('an empty family weight matrix is unavailable', (context: TestContext) => {
  replaceFont(context, STARCI, (presentation: Parsed) => { presentation.font.guidance.find((item: Parsed) => item.id === 'weight').requirement = ''; });
  assert.throws(() => presented(topics(), { family: 'core' }), /font weight matrix is missing or incomplete/);
});

test('unresolved CSS weight tokens fail visibly instead of shrinking the public set', () => {
  const font = fontOf(presented(topics(), { family: 'core' }));
  const guidance = font.doc.guidance.find((item: Parsed) => item.id === 'weight');
  assert.throws(() => fontWeightsOf(guidance, { variable: () => undefined }), /font weight tokens are unresolved/);
});

test('Offset Pop explicitly inherits Common font recipes while retaining its selected family identity', () => {
  const result = presented(topics(), { family: 'offset-pop' });
  assert.equal(result.family, 'offset-pop');
  const font = fontOf(result);
  assert.match(font.familySource as string, /grammars\/core\/playbook.yaml#presentation\.font$/);
  assert.match(font.doc.rules.find((rule: Parsed) => rule.id === 'FONT-4').familyTitle, /text-xl/);
});

test('missing family font data fails instead of dropping typography proof', (context: TestContext) => {
  replaceFont(context, STARCI, (presentation: Parsed) => { delete presentation.font; });
  assert.throws(() => presented(topics(), { family: 'core' }), /font.*(?:data|presentation|owner)/i);
});

test('partial family font case coverage is refused', (context: TestContext) => {
  replaceFont(context, STARCI, (presentation: Parsed) => { presentation.font.recipes.find((rule: Parsed) => rule.rule === 'FONT-1').cases.pop(); });
  assert.throws(() => presented(topics(), { family: 'core' }), /FONT-1.*(?:cover|case)/);
});

test('a missing concrete font title cannot erase the numerical rank proof', (context: TestContext) => {
  replaceFont(context, STARCI, (presentation: Parsed) => { delete presentation.font.recipes.find((rule: Parsed) => rule.rule === 'FONT-4').title; });
  assert.throws(() => presented(topics(), { family: 'core' }), /font recipe without its concrete title/);
});

test('duplicate font scale steps cannot hide a rank mapping', (context: TestContext) => {
  replaceFont(context, STARCI, (presentation: Parsed) => { presentation.font.scale.steps.push(presentation.font.scale.steps[0]); });
  assert.throws(() => presented(topics(), { family: 'core' }), /(?:duplicate.*font|font.*duplicate)/i);
});

test('font inheritance cycles fail without affecting padding inheritance', (context: TestContext) => {
  replaceFont(context, OFFSET_POP, (presentation: Parsed) => { presentation.font.inherits = 'offset-pop'; });
  assert.throws(() => presented(topics(), { family: 'offset-pop' }), /font.*inheritance cycles|inheritance cycles.*font/i);
});
