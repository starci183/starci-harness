// Family presentation data decorates universal proof cases without moving their semantic identities.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../engine/yaml.mjs';
import { skillRoot } from '../../engine/runtime-root.mjs';
import { openHfs } from './slots.mjs';
import { grammarFamilyFor } from '../lib/grammar-lint.mjs';

const GRAMMARS = fileURLToPath(new URL('../../knowledge/grammars/', import.meta.url));
const PADDING_TOPIC = 'presentation/padding.yaml';
const TOPIC_NAMES = ['padding', 'font'];
const REM_PX = 16;
const TEXT_WEIGHT_NAMES = ['normal', 'medium', 'semibold'];

/** The Common text-weight matrix is complete only when each public weight has one declared class. */
function fontWeightClasses(guidance) {
  const matrix = guidance?.familyRequirement ?? guidance?.requirement ?? '';
  const pattern = new RegExp('`font-(' + TEXT_WEIGHT_NAMES.join('|') + ')`', 'g');
  const names = [...String(matrix).matchAll(pattern)].map(match => match[1]);
  if (names.length !== TEXT_WEIGHT_NAMES.length || new Set(names).size !== TEXT_WEIGHT_NAMES.length) {
    throw new Error('Grammar font weight matrix is missing or incomplete');
  }
  return names;
}

/** Resolve a recorded rem, px or unitless scale value at the proof's baseline root; unsupported values stay unavailable. */
export const remPx = (value) => {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(rem|px)?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const px = Number(match[1]) * (match[2] === 'px' ? 1 : REM_PX);
  return Number.isFinite(px) ? px : null;
};

/** Resolve the selected family's published text weights through the active CSS token scope. */
export function fontWeightsOf(guidance, scope) {
  const weights = fontWeightClasses(guidance).map(name => Number(scope?.variable(`--font-weight-${name}`)?.value));
  if (weights.some(weight => !Number.isFinite(weight))) throw new Error('Grammar font weight tokens are unresolved');
  return weights;
}

/** Missing or ambiguous family weight data cannot remove the render's weight proof. */
function validateFontGuidance(data) {
  const weights = (data.guidance ?? []).filter(item => item.id === 'weight');
  if (weights.length !== 1) throw new Error('Grammar font guidance needs one concrete weight matrix');
  fontWeightClasses(weights[0]);
}

/** Read the explicit family or the app declaration; CSS discovery never chooses presentation law. */
function selectedFamily(family, repo) {
  if (family !== null && family !== undefined) return grammarFamilyFor(family).id;
  if (!repo) throw new Error('Presentation proof needs an explicit Grammar family or an app repository');
  const declaration = openHfs({ root: skillRoot, repoRoot: repo }).repo;
  return grammarFamilyFor(declaration.grammar ?? declaration.sides?.fe?.grammar).id;
}

/** The one declared presentation owner, following only explicit inheritance and rejecting cycles. */
function presentationOwner(family, name, seen = new Set()) {
  if (seen.has(family)) throw new Error(`Grammar ${name} inheritance cycles at ${family}`);
  seen.add(family);
  const entry = grammarFamilyFor(family);
  if (typeof entry.productComposition !== 'string' || !entry.productComposition) {
    throw new Error(`Grammar family ${family} has no presentation playbook`);
  }
  const file = path.resolve(GRAMMARS, entry.productComposition);
  const relative = path.relative(GRAMMARS, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Grammar family ${family} has an invalid presentation path`);
  const doc = parseYaml(fs.readFileSync(file, 'utf8'));
  const data = doc?.presentation?.[name];
  if (!data || typeof data !== 'object') throw new Error(`Grammar family ${family} has no ${name} presentation data`);
  if (Object.hasOwn(data, 'inherits')) {
    if (Object.keys(data).some(key => !['inherits', 'ownership', 'contract'].includes(key))) {
      throw new Error(`Grammar family ${family} mixes inherited and replacement ${name} data`);
    }
    return presentationOwner(data.inherits, name, seen);
  }
  if (!Array.isArray(data.scale?.steps) || !data.scale.steps.length
    || !Array.isArray(data.componentOwnership?.rows) || !data.componentOwnership.rows.length
    || !Array.isArray(data.recipes) || !data.recipes.length) {
    throw new Error(`Grammar family ${family} has incomplete ${name} presentation data`);
  }
  const steps = new Map(data.scale.steps.map(step => [step.id, step]));
  if (steps.size !== data.scale.steps.length || data.scale.steps.some(step => typeof step.id !== 'string'
    || !step.id || (name === 'padding' && (remPx(step.value) === null || remPx(step.value) < 0)))) {
    throw new Error(`Grammar family ${family} has duplicate or unusable ${name} scale steps`);
  }
  if (data.componentOwnership.rows.some(row => !steps.has(row.rule))) {
    throw new Error(`Grammar family ${family} has a component ${name === 'padding' ? 'inset' : 'font rank'} without a scale value`);
  }
  if (data.recipes.some(recipe => typeof recipe.title !== 'string' || !recipe.title.trim())) {
    throw new Error(`Grammar family ${family} has a ${name} recipe without its concrete title`);
  }
  if (name === 'font') validateFontGuidance(data);
  return { data, source: `knowledge/grammars/${relative.split(path.sep).join('/')}#presentation.${name}` };
}

/** Preserve every universal case while attaching the exact renderer recipe and its numerical owner. */
function presentationTopic(topic, owner, name) {
  const { data, source } = owner;
  const recipes = new Map(data.recipes.map(recipe => [recipe.rule, recipe]));
  const rules = topic.doc.rules ?? [];
  if (recipes.size !== data.recipes.length || recipes.size !== rules.length) {
    throw new Error(`Grammar ${name} recipes do not cover the universal rule identities exactly once`);
  }
  const attached = rules.map(rule => {
    const recipe = recipes.get(rule.id);
    const byCase = new Map((recipe?.cases ?? []).map(item => [item.id, item]));
    if (!recipe || byCase.size !== recipe.cases.length || byCase.size !== (rule.cases ?? []).length) {
      throw new Error(`Grammar ${name} recipe ${rule.id} does not cover its universal cases exactly once`);
    }
    const cases = rule.cases.map(item => {
      const concrete = byCase.get(item.id);
      if (!concrete || typeof concrete.render !== 'string' || typeof concrete.owner !== 'string') {
        throw new Error(`Grammar ${name} recipe ${rule.id}/${item.id} has no renderer contract`);
      }
      return { ...item, owner: concrete.owner, render: concrete.render, recipeSource: source };
    });
    return { ...rule, familyTitle: recipe.title, cases };
  });
  const guidance = new Map((topic.doc.guidance ?? []).map(item => [item.id, item]));
  for (const concrete of data.guidance ?? []) {
    const semantic = guidance.get(concrete.id);
    guidance.set(concrete.id, semantic ? { ...semantic, familyRequirement: concrete.requirement, familySource: source }
      : { ...concrete, familySource: source });
  }
  return {
    ...topic,
    familySource: source,
    doc: { ...topic.doc, scale: data.scale, componentOwnership: data.componentOwnership,
      guidance: [...guidance.values()], rules: attached },
  };
}

/**
 * Bind supported universal presentation cases to the selected family's numerical recipes without mutation.
 * Missing family data and incomplete coverage fail visibly rather than selecting another family.
 * @param {object[]} knowledge - Universal topics with stable relative paths and parsed documents.
 * @param {{ family?: string, repo?: string }} input - Explicit family or the app whose declaration selects it.
 * @returns {{ family: string, knowledge: object[] }} Selected family and proof-ready topics with owner provenance.
 */
export function familyPresentationKnowledge(knowledge, { family = null, repo = null } = {}) {
  const selected = selectedFamily(family, repo);
  const topics = knowledge.filter(topic => topic.rel.endsWith(PADDING_TOPIC));
  if (topics.length !== 1) throw new Error('Presentation proof needs exactly one universal padding topic');
  const decorated = new Map();
  for (const name of TOPIC_NAMES) {
    const matches = knowledge.filter(topic => topic.rel.endsWith(`presentation/${name}.yaml`));
    if (matches.length > 1) throw new Error(`Presentation proof has duplicate universal ${name} topics`);
    if (matches.length) decorated.set(matches[0], presentationTopic(matches[0], presentationOwner(selected, name), name));
  }
  return { family: selected, knowledge: knowledge.map(topic => decorated.get(topic) ?? topic) };
}
