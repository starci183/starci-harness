/** Family-owned numerical recipes retain complete universal padding proof coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { familyPresentationKnowledge } from '../runtime/scripts/hfs/grammar-presentation.mjs';

const PADDING = new URL('../runtime/knowledge/ui/presentation/padding.yaml', import.meta.url);
const STARCI = fileURLToPath(new URL('../runtime/knowledge/grammars/core/playbook.yaml', import.meta.url));
const OFFSET_POP = fileURLToPath(new URL('../runtime/knowledge/grammars/offset-pop/playbook.yaml', import.meta.url));
const topics = () => [{ rel: 'knowledge/ui/presentation/padding.yaml', layer: 'presentation', doc: parseYaml(fs.readFileSync(PADDING, 'utf8')) }];

function replacePlaybook(context, file, change) {
  const originalRead = fs.readFileSync;
  const doc = parseYaml(originalRead(file, 'utf8'));
  change(doc.presentation.padding);
  context.mock.method(fs, 'readFileSync', function readPresentation(input, ...options) {
    if (typeof input === 'string' && path.resolve(input) === file) return JSON.stringify(doc);
    return originalRead.call(this, input, ...options);
  });
}

test('selected family restores concrete scale, component owners and every stable case without mutating semantic knowledge', () => {
  const universal = topics();
  const before = structuredClone(universal);
  const result = familyPresentationKnowledge(universal, { family: 'core' });
  assert.equal(result.family, 'core');
  assert.equal(familyPresentationKnowledge(universal, { family: 'core' }).family, 'core');
  const topic = result.knowledge[0];
  const step = topic.doc.scale.steps.find(item => item.id === 'PADDING-4');
  assert.equal(step.value, '1rem');
  assert.equal(step.class, 'p-4');
  assert.ok(topic.doc.componentOwnership.rows.some(item => item.component === 'SurfaceCard' && item.rule === 'PADDING-4'));
  const card = topic.doc.rules.find(rule => rule.id === 'PADDING-4').cases.find(item => item.id === 'case-2');
  assert.equal(card.owner, '`SurfaceCard`');
  assert.equal(card.render, 'Compose the card; no padding');
  assert.match(card.recipeSource, /grammars\/core\/playbook.yaml#presentation.padding$/);
  assert.deepEqual(topic.doc.rules.map(rule => [rule.id, rule.cases.map(item => item.id)]), before[0].doc.rules.map(rule => [rule.id, rule.cases.map(item => item.id)]));
  assert.deepEqual(universal, before);
});

test('Offset Pop explicitly inherits the shared Common recipe while retaining its selected family identity', () => {
  const result = familyPresentationKnowledge(topics(), { family: 'offset-pop' });
  assert.equal(result.family, 'offset-pop');
  assert.match(result.knowledge[0].familySource, /grammars\/core\/playbook.yaml#presentation.padding$/);
  assert.equal(result.knowledge[0].doc.scale.steps.find(item => item.id === 'PADDING-3').value, '.75rem');
});

test('app declaration selects the recipe with no CSS-family fallback', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-presentation-'));
  context.after(() => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.match(path.basename(directory), /^starci-presentation-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(directory, 'hfs.json'), JSON.stringify({
    hfs: 3, kind: 'app', project: 'fixture', sides: {
      be: { apps: [{ name: 'api', kind: 'api' }] },
      fe: { grammar: 'offset-pop', apps: [{ name: 'web', kind: 'next' }] },
    },
  }));
  assert.equal(familyPresentationKnowledge(topics(), { repo: directory }).family, 'offset-pop');
});

test('missing and unknown family selection never falls back to a default', () => {
  assert.throws(() => familyPresentationKnowledge(topics()), /explicit Grammar family/);
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'unknown' }), /no declared lint contract/);
});

test('a missing family padding owner fails instead of dropping numerical checks', context => {
  replacePlaybook(context, STARCI, data => { delete data.scale; });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'core' }), /incomplete padding presentation data/);
});

test('a partially missing scale cannot silently remove component inset proof', context => {
  replacePlaybook(context, STARCI, data => { data.scale.steps = data.scale.steps.filter(step => step.id !== 'PADDING-4'); });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'core' }), /component inset without a scale value/);
});

test('duplicate or unmeasurable scale steps fail rather than winning by order', context => {
  replacePlaybook(context, STARCI, data => { data.scale.steps.push(data.scale.steps[0]); });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'core' }), /duplicate or unusable padding scale steps/);
});

test('a scale value must retain a measurable nonnegative length', context => {
  replacePlaybook(context, STARCI, data => { data.scale.steps.find(step => step.id === 'PADDING-4').value = 'unmeasured'; });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'core' }), /duplicate or unusable padding scale steps/);
});

test('a removed concrete case fails complete case coverage', context => {
  replacePlaybook(context, STARCI, data => { data.recipes.find(rule => rule.rule === 'PADDING-4').cases.pop(); });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'core' }), /PADDING-4 does not cover its universal cases/);
});

test('duplicate concrete cases are refused rather than hiding an owner', context => {
  replacePlaybook(context, STARCI, data => {
    const recipe = data.recipes.find(rule => rule.rule === 'PADDING-4');
    recipe.cases.push(recipe.cases[0]);
  });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'core' }), /PADDING-4 does not cover its universal cases/);
});

test('explicit recipe inheritance cycles are refused', context => {
  replacePlaybook(context, OFFSET_POP, data => { data.inherits = 'offset-pop'; });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'offset-pop' }), /inheritance cycles/);
});

test('inherited recipes cannot also declare replacement geometry', context => {
  replacePlaybook(context, OFFSET_POP, data => { data.scale = { steps: [] }; });
  assert.throws(() => familyPresentationKnowledge(topics(), { family: 'offset-pop' }), /mixes inherited and replacement padding data/);
});
