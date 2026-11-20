// master-plan.mts - R449: the Master Plan of a project, `.starciwork/master-plan.yaml` (schema `starci/master-plan@1`,
// contexts/project/master-plan-record.md PROJECT-MASTER-PLAN-1). It holds the nine layers in their fixed order (business, tech, patterns, ui, data,
// testing, security, observability, domains); each layer its `decisions[]`, its `reason`, its `rules[]` (each `{ id, kind: always|never,
// text, enforcedBy? }`) and an optional `roadmap[]`. The check reads the shape and the rule ids, never whether a decision is right:
//   HFS_MASTER_PLAN_MISSING  a warning in every env: the app root tracks no master-plan.yaml yet (`starci app scaffold` writes the skeleton);
//   HFS_MASTER_PLAN_INVALID  an error: the file is not YAML, breaks the shape, repeats a rule id, or names in `enforcedBy` an hfs rule id
//                            (`R<n>`) the rule catalog does not hold. A check preset name or `review` is not resolved here: the presets
//                            are the harness's (ops/checks.yaml), and `starci app master-plan` reports each rule's enforcement against them.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { parseYaml } from '../../../engine/yaml.mjs';
import { loadRuleCatalog } from '../rule-catalog.mjs';
import { found, readText } from './read.mjs';
import type { Finding, Parsed } from './rule-types.mjs';

export const HFS_MASTER_PLAN_MISSING = 'HFS_MASTER_PLAN_MISSING';
export const HFS_MASTER_PLAN_INVALID = 'HFS_MASTER_PLAN_INVALID';
/** The Master Plan of an app root, app-relative (slot app.starciwork). */
export const MASTER_PLAN_FILE = '.starciwork/master-plan.yaml';
export const MASTER_PLAN_SCHEMA = 'starci/master-plan@1';
/** The nine layers, in the order the file holds them: a later layer never contradicts an earlier one. */
export const MASTER_PLAN_LAYERS = Object.freeze(['business', 'tech', 'patterns', 'ui', 'data', 'testing', 'security', 'observability', 'domains'] as const);
const RULE = '(PROJECT-MASTER-PLAN-1)';
const RULE_ID = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/u;
const HFS_RULE_ID = /^R\d+$/u;
/** A check preset name of ops/checks.yaml: lowercase kebab-case. */
const PRESET = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TOP_KEYS = new Set(['schema', 'project', 'layers']);
const LAYER_KEYS = new Set(['id', 'title', 'decisions', 'reason', 'rules', 'roadmap']);
const RULE_KEYS = new Set(['id', 'kind', 'text', 'enforcedBy']);

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const extra = (record: Record<string, unknown>, keys: ReadonlySet<string>): string[] => Object.keys(record).filter((key) => !keys.has(key));

/** The names an `enforcedBy` holds: one name or a list of them. */
export const enforcersOf = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []);

/** The problems of one rule entry at `at`, each a sentence fragment. */
function ruleProblems(rule: unknown, at: string, ids: Set<string>): string[] {
  if (!plain(rule)) return [`${at} is not \`{ id, kind, text, enforcedBy? }\``];
  const record = rule as Record<string, unknown>;
  const problems = extra(record, RULE_KEYS).map((key) => `${at} has the unknown key \`${key}\``);
  const { id, kind, text: body, enforcedBy } = record;
  if (typeof id !== 'string' || !RULE_ID.test(id)) problems.push(`${at}.id ${JSON.stringify(id)} is not an id of letters, digits and dashes`);
  else if (ids.has(id)) problems.push(`${at}.id ${id} is used by another rule`);
  else ids.add(id);
  if (kind !== 'always' && kind !== 'never') problems.push(`${at}.kind is ${JSON.stringify(kind)}, not \`always\` or \`never\``);
  if (!text(body)) problems.push(`${at}.text is empty`);
  if (enforcedBy !== undefined) {
    const names = enforcersOf(enforcedBy);
    const shaped = typeof enforcedBy === 'string' || (Array.isArray(enforcedBy) && enforcedBy.length > 0 && names.length === enforcedBy.length);
    if (!shaped) problems.push(`${at}.enforcedBy is not a name or a non-empty list of names`);
    for (const name of names) if (name !== 'review' && !HFS_RULE_ID.test(name) && !PRESET.test(name)) problems.push(`${at}.enforcedBy names ${JSON.stringify(name)}, which is neither an hfs rule id (R<n>), a check preset name nor \`review\``);
  }
  return problems;
}

/** The problems of one layer entry, which must be layer `expected`. */
function layerProblems(layer: unknown, expected: string, index: number, ids: Set<string>): string[] {
  const at = `layers[${index}]`;
  if (!plain(layer)) return [`${at} is not a layer object`];
  const record = layer as Record<string, unknown>;
  const problems = extra(record, LAYER_KEYS).map((key) => `${at} has the unknown key \`${key}\``);
  if (record['id'] !== expected) problems.push(`${at}.id is ${JSON.stringify(record['id'])}, but layer ${index + 1} is \`${expected}\` (the order is ${MASTER_PLAN_LAYERS.join(', ')})`);
  if (record['title'] !== undefined && !text(record['title'])) problems.push(`${at}.title is empty`);
  if (!strings(record['decisions'])) problems.push(`${at}.decisions is not a list of non-empty texts`);
  if (typeof record['reason'] !== 'string') problems.push(`${at}.reason is not a text (write "" while it is undecided)`);
  if (record['roadmap'] !== undefined && !strings(record['roadmap'])) problems.push(`${at}.roadmap is not a list of non-empty texts`);
  const rules = record['rules'];
  if (!Array.isArray(rules)) problems.push(`${at}.rules is not a list`);
  else rules.forEach((rule, at2) => problems.push(...ruleProblems(rule, `${at}.rules[${at2}]`, ids)));
  return problems;
}

/** The problems of a master-plan.yaml text against the shape alone (no catalog), and the hfs rule ids its rules name. */
export function masterPlanProblems(source: string): { problems: string[]; hfsRules: string[] } {
  let doc: Parsed;
  try { doc = parseYaml(source); } catch { return { problems: ['is not YAML'], hfsRules: [] }; }
  if (!plain(doc)) return { problems: ['is not a mapping'], hfsRules: [] };
  const problems = extra(doc, TOP_KEYS).map((key) => `has the unknown key \`${key}\``);
  if (doc.schema !== MASTER_PLAN_SCHEMA) problems.push(`has the schema ${JSON.stringify(doc.schema)}, not ${MASTER_PLAN_SCHEMA}`);
  if (doc.project !== undefined && !text(doc.project)) problems.push('has an empty project');
  const layers: unknown = doc.layers;
  if (!Array.isArray(layers) || layers.length !== MASTER_PLAN_LAYERS.length) {
    problems.push(`has ${Array.isArray(layers) ? layers.length : 'no list of'} layers, not the ${MASTER_PLAN_LAYERS.length} layers ${MASTER_PLAN_LAYERS.join(', ')}`);
    return { problems, hfsRules: [] };
  }
  const ids = new Set<string>();
  layers.forEach((layer, index) => problems.push(...layerProblems(layer, MASTER_PLAN_LAYERS[index] as string, index, ids)));
  const hfsRules = layers.flatMap((layer) => (plain(layer) && Array.isArray(layer.rules) ? layer.rules : []))
    .flatMap((rule: Parsed) => (plain(rule) ? enforcersOf(rule.enforcedBy) : []))
    .filter((name: string) => HFS_RULE_ID.test(name));
  return { problems, hfsRules: [...new Set(hfsRules)] };
}

/** The hfs rule ids the runtime's own catalog holds, or null when it cannot be read (the catalog's own check refuses that). */
function catalogIds(): ReadonlySet<string> | null {
  try { return new Set(loadRuleCatalog().rules.map((rule) => rule.id)); } catch { return null; }
}

/** Findings of R449 at the app root: a warning while the plan is absent, an error while it is malformed. */
export function masterPlanFindings({ repoRoot, repo, isRoot, files }: { repoRoot: string; repo: Parsed; isRoot: boolean; files: readonly string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  if (!files.includes(MASTER_PLAN_FILE)) {
    return [found(HFS_MASTER_PLAN_MISSING, MASTER_PLAN_FILE, `${MASTER_PLAN_FILE} is not tracked: write the project's Master Plan, the nine layers ${MASTER_PLAN_LAYERS.join(', ')}, each with its decisions, reason and always/never rules (\`starci app scaffold\` writes the skeleton; a briefed task reads the layers of its op) ${RULE}`, { level: 'warning' })];
  }
  const source = readText(repoRoot, MASTER_PLAN_FILE);
  if (source === null) return [found(HFS_MASTER_PLAN_INVALID, MASTER_PLAN_FILE, `${MASTER_PLAN_FILE} cannot be read as text ${RULE}`)];
  const { problems, hfsRules } = masterPlanProblems(source);
  const known = hfsRules.length === 0 ? null : catalogIds();
  if (known !== null) for (const id of hfsRules) if (!known.has(id)) problems.push(`a rule names the hfs rule ${id} in enforcedBy, which the rule catalog does not hold`);
  return problems.length === 0 ? [] : [found(HFS_MASTER_PLAN_INVALID, MASTER_PLAN_FILE, `${MASTER_PLAN_FILE} ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? `; and ${problems.length - 8} more` : ''} ${RULE}`, { problems })];
}
