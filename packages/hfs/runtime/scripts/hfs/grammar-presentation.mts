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

/** A guidance entry of a presentation topic (universal or a family's concrete one). */
export interface PresentationGuidance { id: string; requirement?: string; familyRequirement?: string; familySource?: string; [key: string]: unknown }
/** One case of a rule (universal) or of a recipe (concrete). */
export interface PresentationCase { id: string; owner?: string; render?: string; [key: string]: unknown }
/** The family's presentation data of one topic, as parsed from the grammar playbook. */
export interface PresentationData {
  inherits?: string;
  scale?: { steps: { id: string; value?: unknown }[] };
  componentOwnership?: { rows: { rule: string }[] };
  recipes?: { rule: string; title: string; cases?: PresentationCase[] }[];
  guidance?: PresentationGuidance[];
}
/** A universal topic: a stable relative path and the parsed document. */
export interface PresentationTopic {
  rel: string;
  doc: { rules?: { id: string; cases?: PresentationCase[]; [key: string]: unknown }[]; guidance?: PresentationGuidance[]; [key: string]: unknown };
  [key: string]: unknown;
}
/** The resolved owner of one presentation topic: its data and where it came from. */
interface PresentationOwner { data: PresentationData; source: string }
/** The active CSS token scope, as far as font weights need it. */
export interface TokenScope { variable(name: string): { value?: unknown } | null | undefined }

/** The Common text-weight matrix is complete only when each public weight has one declared class. */
function fontWeightClasses(guidance: PresentationGuidance | null | undefined): string[] {
  const matrix = guidance?.familyRequirement ?? guidance?.requirement ?? '';
  const pattern = new RegExp('`font-(' + TEXT_WEIGHT_NAMES.join('|') + ')`', 'g');
  const names = [...String(matrix).matchAll(pattern)].map((match) => match[1] as string);
  if (names.length !== TEXT_WEIGHT_NAMES.length || new Set(names).size !== TEXT_WEIGHT_NAMES.length) {
    throw new Error('Grammar font weight matrix is missing or incomplete');
  }
  return names;
}

/** Resolve a recorded rem, px or unitless scale value at the proof's baseline root; unsupported values stay unavailable. */
export const remPx = (value: unknown): number | null => {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(rem|px)?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const px = Number(match[1] as string) * (match[2] === 'px' ? 1 : REM_PX);
  return Number.isFinite(px) ? px : null;
};

/** Resolve the selected family's published text weights through the active CSS token scope. */
export function fontWeightsOf(guidance: PresentationGuidance | null | undefined, scope: TokenScope | null | undefined): number[] {
  const weights = fontWeightClasses(guidance).map(name => Number(scope?.variable(`--font-weight-${name}`)?.value));
  if (weights.some(weight => !Number.isFinite(weight))) throw new Error('Grammar font weight tokens are unresolved');
  return weights;
}

/** Missing or ambiguous family weight data cannot remove the render's weight proof. */
function validateFontGuidance(data: PresentationData): void {
  const weights = (data.guidance ?? []).filter((item) => item.id === 'weight');
  if (weights.length !== 1) throw new Error('Grammar font guidance needs one concrete weight matrix');
  fontWeightClasses(weights[0]);
}

/** Read the explicit family or the app declaration; CSS discovery never chooses presentation law. */
function selectedFamily(family: string | null | undefined, repo: string | null | undefined): string {
  if (family !== null && family !== undefined) return grammarFamilyFor(family).id;
  if (!repo) throw new Error('Presentation proof needs an explicit Grammar family or an app repository');
  const declaration = openHfs({ root: skillRoot, repoRoot: repo }).repo;
  return grammarFamilyFor(declaration.grammar ?? declaration.sides?.fe?.grammar).id;
}

/** The one declared presentation owner, following only explicit inheritance and rejecting cycles. */
function presentationOwner(family: string, name: string, seen: Set<string> = new Set()): PresentationOwner {
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
  const data: PresentationData | undefined = doc?.presentation?.[name]; // reason: parsed YAML from disk, validated below
  if (!data || typeof data !== 'object') throw new Error(`Grammar family ${family} has no ${name} presentation data`);
  if (Object.hasOwn(data, 'inherits')) {
    if (Object.keys(data).some((key) => !['inherits', 'ownership', 'contract'].includes(key))) {
      throw new Error(`Grammar family ${family} mixes inherited and replacement ${name} data`);
    }
    return presentationOwner(data.inherits as string, name, seen);
  }
  if (!Array.isArray(data.scale?.steps) || !data.scale.steps.length
    || !Array.isArray(data.componentOwnership?.rows) || !data.componentOwnership.rows.length
    || !Array.isArray(data.recipes) || !data.recipes.length) {
    throw new Error(`Grammar family ${family} has incomplete ${name} presentation data`);
  }
  const steps = new Map(data.scale.steps.map((step) => [step.id, step] as const));
  if (steps.size !== data.scale.steps.length || data.scale.steps.some((step) => typeof step.id !== 'string'
    || !step.id || (name === 'padding' && (remPx(step.value) === null || (remPx(step.value) as number) < 0)))) {
    throw new Error(`Grammar family ${family} has duplicate or unusable ${name} scale steps`);
  }
  if (data.componentOwnership.rows.some((row) => !steps.has(row.rule))) {
    throw new Error(`Grammar family ${family} has a component ${name === 'padding' ? 'inset' : 'font rank'} without a scale value`);
  }
  if (data.recipes.some((recipe) => typeof recipe.title !== 'string' || !recipe.title.trim())) {
    throw new Error(`Grammar family ${family} has a ${name} recipe without its concrete title`);
  }
  if (name === 'font') validateFontGuidance(data);
  return { data, source: `knowledge/grammars/${relative.split(path.sep).join('/')}#presentation.${name}` };
}

/** Preserve every universal case while attaching the exact renderer recipe and its numerical owner. */
function presentationTopic(topic: PresentationTopic, owner: PresentationOwner, name: string): PresentationTopic {
  const { data, source } = owner;
  const recipes = new Map((data.recipes as NonNullable<PresentationData['recipes']>).map((recipe) => [recipe.rule, recipe] as const));
  const rules = topic.doc.rules ?? [];
  if (recipes.size !== (data.recipes as unknown[]).length || recipes.size !== rules.length) {
    throw new Error(`Grammar ${name} recipes do not cover the universal rule identities exactly once`);
  }
  const attached = rules.map((rule) => {
    const recipe = recipes.get(rule.id);
    const byCase = new Map((recipe?.cases ?? []).map((item) => [item.id, item] as const));
    if (!recipe || byCase.size !== (recipe.cases as unknown[]).length || byCase.size !== (rule.cases ?? []).length) {
      throw new Error(`Grammar ${name} recipe ${rule.id} does not cover its universal cases exactly once`);
    }
    const cases = (rule.cases as PresentationCase[]).map((item) => {
      const concrete = byCase.get(item.id);
      if (!concrete || typeof concrete.render !== 'string' || typeof concrete.owner !== 'string') {
        throw new Error(`Grammar ${name} recipe ${rule.id}/${item.id} has no renderer contract`);
      }
      return { ...item, owner: concrete.owner, render: concrete.render, recipeSource: source };
    });
    return { ...rule, familyTitle: recipe.title, cases };
  });
  const guidance = new Map((topic.doc.guidance ?? []).map((item) => [item.id, item] as const));
  for (const concrete of data.guidance ?? []) {
    const semantic = guidance.get(concrete.id);
    guidance.set(concrete.id, semantic ? { ...semantic, familyRequirement: concrete.requirement as string, familySource: source }
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
export function familyPresentationKnowledge(knowledge: PresentationTopic[], { family = null, repo = null }: { family?: string | null; repo?: string | null } = {}): { family: string; knowledge: PresentationTopic[] } {
  const selected = selectedFamily(family, repo);
  const topics = knowledge.filter((topic) => topic.rel.endsWith(PADDING_TOPIC));
  if (topics.length !== 1) throw new Error('Presentation proof needs exactly one universal padding topic');
  const decorated = new Map<PresentationTopic, PresentationTopic>();
  for (const name of TOPIC_NAMES) {
    const matches = knowledge.filter((topic) => topic.rel.endsWith(`presentation/${name}.yaml`));
    if (matches.length > 1) throw new Error(`Presentation proof has duplicate universal ${name} topics`);
    if (matches.length) decorated.set(matches[0] as PresentationTopic, presentationTopic(matches[0] as PresentationTopic, presentationOwner(selected, name), name));
  }
  return { family: selected, knowledge: knowledge.map((topic) => decorated.get(topic) ?? topic) };
}
