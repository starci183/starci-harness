import fs from 'node:fs';
import path from 'node:path';
import { createSlotResolver, loadSlotManifest, readRepoDeclaration, ruleParams } from '../runtime/scripts/hfs/slots.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { TEMPLATES_DIR } from '../sync/index.mjs';
import { ScaffoldError, pascalOf } from './service.mjs';
import { refuseFullAdapterInLite, refuseInEdition } from './edition-gate.mjs';
import { selectLiteWebhookEntries } from './add-inbox-lite.mjs';
import { LITE_TEMPLATED_TOPICS, selectLiteQueueEntries } from './add-queue-lite.mjs';
import { ensureLiteCli } from './add-cli-lite.mjs';
import { isMigrationName, migrationStamp } from '../runtime/scripts/hfs/rules/database-migrations.mjs';
import { patternFilePath } from './pattern-file-slots.mjs';

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VARIABLE = /<([A-Za-z][A-Za-z0-9]*)>/g;
const PLACEHOLDER = /@@([A-Za-z][A-Za-z0-9]*)@@/g;
const PLATFORM_PREFIX = 'src/modules/platform/';
const platformEntry = (entry) => entry.path.startsWith(PLATFORM_PREFIX) || entry.shared === true;
const TOPICS_DIR = path.join(import.meta.dirname, '..', 'runtime', 'knowledge', 'patterns', 'be');
const PATTERN_TEMPLATES = path.join(TEMPLATES_DIR, 'be', 'patterns');
const camelOf = (name) => { const pascal = pascalOf(name); return pascal[0].toLowerCase() + pascal.slice(1); };

/** The noun's app declaration and the ruleParams entry that supplies its topic and options. */
export function readAddContext(input) {
  const manifest = loadSlotManifest();
  const params = ruleParams(manifest, 'be');
  const spec = params.addKinds[input.noun];
  if (!spec) throw new ScaffoldError('HFS_ADD_NOUN_UNKNOWN', `starci app add knows ${Object.keys(params.addKinds).join(', ')}; ${input.noun} is none of them`);
  const declarationFile = path.join(input.repoRoot, 'hfs.json');
  if (!fs.existsSync(declarationFile)) throw new ScaffoldError('HFS_ADD_NOT_AN_APP', 'starci app add runs at the app root (the folder of hfs.json)');
  const repo = readRepoDeclaration(manifest, input.repoRoot);
  if (!repo.sides?.be) throw new ScaffoldError('HFS_ADD_NO_BACK_END', 'this app has no back-end side');
  return { ...input, manifest, params, spec, declarationFile, repo };
}

/** Lite's built-in migrate and seed groups come from its one CLI bootstrap, without a second instance tree. */
export function addBuiltinLiteCli({ noun, name, repo, repoRoot, manifest }) {
  if (noun !== 'cli' || repo.edition !== 'lite' || !['migrate', 'seed'].includes(name)) return null;
  if (repo.sides.be.apps.some(app => app.kind === 'cli')) throw new ScaffoldError('HFS_ADD_EXISTS', `the lite cli already carries its built-in ${name} group`);
  return { created: ensureLiteCli({ root: repoRoot, manifest, repo }), registered: { patterns: [], kinds: ['cli'] } };
}

const readTopic = (topic) => ({ id: topic, doc: parseYaml(fs.readFileSync(path.join(TOPICS_DIR, `${topic}.yaml`), 'utf8')) });

function readTree(topic, edition) {
  const file = path.join(TOPICS_DIR, `${topic}.yaml`);
  if (!fs.existsSync(file)) throw new ScaffoldError('HFS_ADD_TOPIC_MISSING', `the pattern topic ${topic} (knowledge/patterns/be/${topic}.yaml) is not carried by this package`);
  const doc = parseYaml(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(doc?.files)) throw new ScaffoldError('HFS_ADD_TREE_MISSING', `knowledge/patterns/be/${topic}.yaml has no files tree`);
  return edition === 'lite' && Array.isArray(doc.liteFiles) ? doc.liteFiles : doc.files;
}

const selectLiteApiEntries = entries => entries.map(entry => {
  if (entry.path === 'src/features/api/<feature>/application/<action>.command.ts') return { ...entry, template: 'api/application.command.principal.ts.tpl' };
  if (entry.path === 'src/features/api/<feature>/application/<action>.handler.ts') return { ...entry, template: 'api/application.handler.principal.ts.tpl' };
  return entry;
});

/** Extra lite api templates stay in the same template set as the pattern topics. */
export const liteApiTemplates = () => selectLiteApiEntries(readTree('api')).map(entry => entry.template).filter(Boolean);

function topicsOfPatterns(patterns) {
  const topics = new Set();
  for (const file of fs.readdirSync(TOPICS_DIR).filter((entry) => entry.endsWith('.yaml'))) {
    const doc = parseYaml(fs.readFileSync(path.join(TOPICS_DIR, file), 'utf8'));
    if (patterns.includes(doc?.pattern)) topics.add(file.slice(0, -'.yaml'.length));
  }
  return topics;
}

function requiredOption(need, value, noun) {
  if (typeof value !== 'string' || !value) throw new ScaffoldError('HFS_ADD_OPTION_MISSING', `starci app add ${noun} needs --${need}`);
  if (need === 'service') {
    const [service, serviceModule] = value.split('=');
    if (!service || !serviceModule) throw new ScaffoldError('HFS_ADD_OPTION_INVALID', '--service takes <ServiceClass>=<module specifier>');
    return { service, serviceModule };
  }
  if (!KEBAB.test(value)) throw new ScaffoldError('HFS_ADD_OPTION_INVALID', `--${need} ${value} must be kebab-case`);
  return { [need]: value };
}

function variablesOf({ spec, noun, name, options }) {
  if (!KEBAB.test(name)) throw new ScaffoldError('HFS_ADD_NAME_INVALID', `${noun} name ${name} must be kebab-case (letters, digits and single dashes)`);
  const values = { [spec.variable]: name };
  for (const need of spec.needs ?? []) Object.assign(values, requiredOption(need, options[need], noun));
  for (const [key, rule] of Object.entries(spec.defaults ?? {})) {
    if (values[key] === undefined) values[key] = rule === '@name' ? name : String(rule);
  }
  return values;
}

export function formsOf(values) {
  const forms = {};
  for (const [name, value] of Object.entries(values)) {
    const kebab = KEBAB.test(value);
    forms[name] = value;
    forms[name[0].toUpperCase() + name.slice(1)] = kebab ? pascalOf(value) : value[0].toUpperCase() + value.slice(1);
    forms[`${name}Camel`] = kebab ? camelOf(value) : value[0].toLowerCase() + value.slice(1);
    forms[`${name}Upper`] = kebab ? value.replaceAll('-', '_').toUpperCase() : value;
    forms[`${name}Snake`] = kebab ? value.replaceAll('-', '_') : value;
  }
  return forms;
}

const fillPath = (text, values) => {
  let missing = false;
  const filled = text.replace(VARIABLE, (whole, name) => (values[name] === undefined ? ((missing = true), whole) : values[name]));
  return missing ? null : filled;
};

const renderBody = (text, forms, template) => text.replace(PLACEHOLDER, (whole, name) => {
  if (forms[name] === undefined) throw new ScaffoldError('HFS_ADD_PLACEHOLDER_UNKNOWN', `template ${template} uses ${whole}, which no variable of this noun provides`);
  return forms[name];
});

/** Wiring may leave a placeholder unchanged; template bodies use the strict rendering refusal above. */
export const fillKnownForms = (text, forms) => text.replace(PLACEHOLDER, (whole, name) => forms[name] ?? whole);

function treesOf({ topics, repo, noun, spec }) {
  const liteApi = noun === 'api' && repo.edition === 'lite';
  return new Map([...topics].map((topic) => {
    const entries = repo.edition === 'lite' ? selectLiteQueueEntries(topic, selectLiteWebhookEntries(readTree(topic, repo.edition))) : readTree(topic);
    return [topic, liteApi && topic === spec.topic ? selectLiteApiEntries(entries) : entries];
  }));
}

function collectSlots(entries, platform, slots) {
  for (const entry of entries) {
    if (platformEntry(entry) === platform && entry.optional !== true && entry.slot) slots.add(entry.slot);
  }
}

/** Optional entries gate nothing; the generated instance and platform slots decide the edition. */
function validateWrittenSlots({ specs, topics, trees, manifest, repo, noun }) {
  const slots = new Set();
  for (const [, spec] of specs) collectSlots(trees.get(spec.topic), false, slots);
  for (const topic of topics) collectSlots(trees.get(topic), true, slots);
  refuseInEdition({ resolver: createSlotResolver(manifest, repo), slotIds: [...slots], command: `add ${noun}` });
}

function planEntry(entry, { topic, instance, shared, beRoot, repoRoot, withStamp, forms }) {
  if (entry.optional === true) return null;
  const target = fillPath(entry.path, withStamp);
  if (target === null) return null;
  const absolute = path.join(repoRoot, ...patternFilePath(target, entry.root).split('/'));
  // A platform capability is whole or absent: its index prevents regeneration of all its files.
  const owner = entry.owner ?? target.split('/').slice(0, 4).join('/');
  if (!instance && fs.existsSync(path.join(beRoot, ...owner.split('/'), 'index.ts'))) return null;
  if ((!instance || shared) && fs.existsSync(absolute)) return null;
  if (!entry.template) throw new ScaffoldError('HFS_ADD_TEMPLATE_MISSING', `${topic}.yaml lists ${entry.path} without a template, so it cannot be generated`);
  const templateFile = path.join(PATTERN_TEMPLATES, ...entry.template.split('/'));
  if (!fs.existsSync(templateFile)) throw new ScaffoldError('HFS_ADD_TEMPLATE_MISSING', `${topic}.yaml names template ${entry.template} for ${entry.path}, which the package does not carry`);
  return { target, absolute, body: renderBody(fs.readFileSync(templateFile, 'utf8'), forms, entry.template), instance };
}

function appendEntries(entries, context, planned) {
  for (const entry of entries) {
    const file = planEntry(entry, context);
    if (file) planned.push(file);
  }
}

/** Planned app migrations append after every active migration, before any generated file is written. */
function requireMigrationOrder(repoRoot, planned) {
  const directory = path.join(repoRoot, 'supabase', 'migrations');
  const migrations = planned.filter(file => path.dirname(file.absolute) === directory);
  if (migrations.length === 0) return;
  const existing = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  let latest = existing.filter(name => isMigrationName(name) && migrationStamp(name.slice(0, 14)) !== null)
    .map(name => name.slice(0, 14)).sort().at(-1);
  for (const file of migrations.sort((left, right) => left.target.localeCompare(right.target))) {
    const name = path.basename(file.absolute);
    const stamp = name.slice(0, 14);
    if (!isMigrationName(name) || migrationStamp(stamp) === null)
      throw new ScaffoldError('HFS_ADD_MIGRATION_ORDER', `generated migration ${name} needs a valid UTC timestamp and migration name`);
    if (latest && stamp <= latest)
      throw new ScaffoldError('HFS_ADD_MIGRATION_ORDER', `the current UTC timestamp ${stamp} is not later than the latest migration ${latest}; fix the clock or wait for the next second`);
    latest = stamp;
  }
}

/** Renders all topic-owned paths and bodies before any instance file is written. */
export function planKind(context) {
  const { noun, name, spec, params, repo, options, now } = context;
  const specs = [noun, ...(spec.also ?? [])].map((each) => [each, params.addKinds[each]]);
  const patterns = [...new Set(specs.flatMap(([, eachSpec]) => eachSpec.patterns))];
  const topics = new Set([...specs.map(([, eachSpec]) => eachSpec.topic), ...topicsOfPatterns(patterns)]);
  refuseFullAdapterInLite({ edition: repo.edition, topics: [...topics].map(readTopic), command: `add ${noun}`, liteTemplated: LITE_TEMPLATED_TOPICS });
  const trees = treesOf({ topics, repo, noun, spec });
  validateWrittenSlots({ ...context, specs, topics, trees });
  const values = Object.assign({}, ...specs.map(([each, eachSpec]) => variablesOf({ spec: eachSpec, noun: each, name, options })), variablesOf({ spec, noun, name, options }));
  const timestamp = now();
  const stampOf = value => new Date(value).toISOString().replace(/\D/g, '').slice(0, 14);
  const withStamp = { ...values, epochMs13: String(timestamp).padStart(13, '0').slice(0, 13), stamp: stampOf(timestamp), nextStamp: stampOf(timestamp + 1000) };
  const forms = formsOf(withStamp);
  const beRoot = path.join(context.repoRoot, 'be');
  const planned = [];
  for (const [each, eachSpec] of specs) {
    const entries = trees.get(eachSpec.topic).filter(entry => !platformEntry(entry));
    appendEntries(entries, { topic: eachSpec.topic, instance: true, shared: each !== noun, beRoot, repoRoot: context.repoRoot, withStamp, forms }, planned);
  }
  for (const topic of topics) {
    const entries = trees.get(topic).filter(platformEntry);
    appendEntries(entries, { topic, instance: false, shared: false, beRoot, repoRoot: context.repoRoot, withStamp, forms }, planned);
  }
  const clash = planned.filter(file => file.instance && fs.existsSync(file.absolute)).map(file => file.target);
  if (clash.length) throw new ScaffoldError('HFS_ADD_EXISTS', `${noun} ${name} already exists: ${clash.join(', ')}`);
  requireMigrationOrder(context.repoRoot, planned);
  return { values, forms, beRoot, patterns, planned };
}
