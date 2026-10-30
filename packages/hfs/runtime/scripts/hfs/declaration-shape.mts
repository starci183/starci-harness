// declaration-shape.mjs - the dependency-free hfs.json shape validation used by the HFS slot loader. Semantic checks
// against a loaded manifest remain in slots.mjs; this module mirrors modules/schemas/hfs-repo.schema.yaml only.
import type { Parsed } from './manifest-shape.mjs';
import { isPlainObject } from '../../engine/plain-object.mjs';
import { APP_KIND, connectionShapeProblems, NAME, PACKAGE_NAME, RUNTIME_KIND, SLOT_ID } from './manifest-shape.mjs';
import { dbFunctionsOk } from './rule-params-shape.mjs';
import { kindShapeProblems, patternShapeProblems } from './declaration-slots.mjs';
import { byCodeUnit } from '../lib/list.mjs';

/** Shape problems of the optional hfs.json `db` block of a lite app: the environment variable naming its database, its image, forced RLS and its application role. */
const isStringList = (value: Parsed) => Array.isArray(value) && value.every((entry: Parsed) => typeof entry === 'string' && entry.trim());

function dbBlockProblems(block: Parsed): string[] {
  if (block === undefined) return [];
  if (!isPlainObject(block)) return ['db must be an object'];
  const bad: string[] = [];
  for (const key of Object.keys(block)) if (!['urlEnv', 'image', 'forceRls', 'forceRlsExemptions', 'appRole'].includes(key)) bad.push(`db has unknown key ${key}`);
  if (block.urlEnv !== undefined && (typeof block.urlEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(block.urlEnv))) bad.push('db.urlEnv must name an UPPER_CASE environment variable');
  if (block.image !== undefined && (typeof block.image !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(block.image))) bad.push('db.image must be a digest-pinned image reference');
  if (block.forceRls !== undefined && !isStringList(block.forceRls)) bad.push('db.forceRls must be a list of strings');
  if (block.appRole !== undefined && (typeof block.appRole !== 'string' || !/^[a-z][a-z0-9_]*$/.test(block.appRole))) bad.push('db.appRole must name a role');
  if (block.forceRlsExemptions !== undefined && !Array.isArray(block.forceRlsExemptions)) bad.push('db.forceRlsExemptions must be a list of { table, reason }');
  return bad;
}

function appShapeProblems(apps: Parsed, at: Parsed, side: Parsed, names: Parsed): string[] {
  const bad: string[] = [];
  if (!Array.isArray(apps) || !apps.length) {
    bad.push(`${at}.apps must list every ${side}/apps/<name> with its kind`);
    return bad;
  }
  apps.forEach((app, index) => {
    if (!isPlainObject(app) || !NAME.test(String(app.name)) || !NAME.test(String(app.kind)) || Object.keys(app).some((key: Parsed) => key !== 'name' && key !== 'kind')) bad.push(`${at}.apps[${index}] must be {name, kind}`);
    else if (names.has(app.name)) bad.push(`app ${app.name} is declared twice (${names.get(app.name)} and ${side})`);
    else names.set(app.name, side);
  });
  return bad;
}

function connectionProblems(side: Parsed, value: Parsed): string[] {
  const bad: string[] = [];
  if (side !== 'be') {
    bad.push('connections belong to the be side');
    return bad;
  }
  const list = Array.isArray(value.connections) ? value.connections : null;
  const shape = connectionShapeProblems(list, value.apps);
  if (shape.length) {
    bad.push(...shape);
    return bad;
  }
  if (new Set(list.map((connection: Parsed) => connection.name)).size !== list.length) bad.push('connections names must be unique');
  for (const a of list) for (const b of list) if (a !== b && `${b.envPrefix}_`.startsWith(`${a.envPrefix}_`)) bad.push(`connections ${a.name} and ${b.name} share env keys (${a.envPrefix}_ covers ${b.envPrefix}_)`);
  return bad;
}

/** Whether a declared list is present but not a list of distinct entries that all satisfy `valid`. */
const isBadUniqueList = (list: Parsed, valid: Parsed) => list !== undefined && (!Array.isArray(list) || !list.every((entry: Parsed) => valid(entry)) || new Set(list).size !== list.length);

function validExtraPackage(entry: Parsed) {
  return isPlainObject(entry) && Object.keys(entry).every(key => key === 'name' || key === 'reason')
    && typeof entry.name === 'string' && entry.name.length <= 214 && PACKAGE_NAME.test(entry.name)
    && typeof entry.reason === 'string' && entry.reason.trim().length > 0;
}

function extraPackageProblems(side: Parsed, entries: Parsed): string[] {
  if (entries === undefined) return [];
  if (side !== 'fe') return ['extraPackages belong to the fe side'];
  if (!Array.isArray(entries) || !entries.every(validExtraPackage)) return ['sides.fe.extraPackages must be a list of {name, reason} with a package name and a nonempty reason'];
  return [];
}

function grammarProblems(side: Parsed, grammar: Parsed): string[] {
  if (grammar === undefined) return [];
  if (side !== 'fe') return ['grammar belongs to the fe side'];
  return typeof grammar === 'string' && NAME.test(grammar) ? [] : ['sides.fe.grammar must name a Grammar family'];
}

function declarationSideProblems(side: Parsed, value: Parsed, names: Parsed): string[] {
  const bad: string[] = [];
  const at = `sides.${side}`;
  if (!isPlainObject(value)) return [`${at} must be an object`];
  for (const key of Object.keys(value)) if (!['apps', 'optionalSlots', 'patterns', 'kinds', 'connections', 'reads', 'extraPackages', 'grammar', 'backing', 'dbFunctions'].includes(key)) bad.push(`${at} has unknown key ${key}`);
  if (value.dbFunctions !== undefined && (side !== 'be' || !dbFunctionsOk(value.dbFunctions, { bare: true }))) bad.push(`${at}.dbFunctions belongs to the be side and lists {name, reason} database functions, each schema-qualified (schema.name, never pg_catalog) or a bare pg built-in of the canon's list, with unique names`);
  bad.push(...appShapeProblems(value.apps, at, side, names));
  if (isBadUniqueList(value.optionalSlots, (slot: Parsed) => SLOT_ID.test(String(slot)))) bad.push(`${at}.optionalSlots must be a unique list of slot ids`);
  if (value.backing !== undefined && side !== 'be') bad.push('backing belongs to the be side');
  else if (isBadUniqueList(value.backing, (name: Parsed) => NAME.test(String(name)))) bad.push(`${at}.backing must be a unique list of backing service names`);
  bad.push(...patternShapeProblems(value, at, NAME), ...kindShapeProblems(value, at, NAME));
  if (isBadUniqueList(value.reads, (read: Parsed) => typeof read === 'string' && read.length > 0)) bad.push(`${at}.reads must be a unique list of paths`);
  if (value.connections !== undefined) bad.push(...connectionProblems(side, value));
  bad.push(...extraPackageProblems(side, value.extraPackages), ...grammarProblems(side, value.grammar));
  return bad;
}

/** Product vocabulary is a declaration, never a switch for a rule. */
function lexiconBlockProblems(lexicon: Parsed): string[] {
  if (lexicon === undefined) return [];
  if (!isPlainObject(lexicon)) return ['lexicon must be an object'];
  const bad: string[] = [];
  for (const key of Object.keys(lexicon)) if (key !== 'removed') bad.push(`lexicon has unknown key ${key}`);
  if (isBadUniqueList(lexicon.removed, (word: Parsed) => typeof word === 'string' && word.trim().length > 0)) bad.push('lexicon.removed must be a unique list of nonempty words');
  return bad;
}

/** Front-end error reporting remains optional in both editions. */
function observeBlockProblems(observe: Parsed): string[] {
  if (observe === undefined) return [];
  if (!isPlainObject(observe)) return ['observe must be an object'];
  const bad: string[] = [];
  for (const key of Object.keys(observe)) if (key !== 'reporter') bad.push(`observe has unknown key ${key}`);
  if (observe.reporter !== undefined && (typeof observe.reporter !== 'string' || !observe.reporter.trim())) bad.push('observe.reporter must name the optional error reporter');
  return bad;
}

const DECLARATION_KEYS = new Set(['hfs', 'kind', 'project', 'edition', 'db', 'sides', 'browser', 'lexicon', 'observe']);
const RUNTIME_DECLARATION_KEYS = new Set(['hfs', 'kind', 'project']);

function productDeclarationProblems(declaration: Parsed, profiles: Parsed): string[] {
  const bad: string[] = [];
  for (const key of Object.keys(declaration)) if (!DECLARATION_KEYS.has(key)) bad.push(`unknown key ${key}`);
  bad.push(...dbBlockProblems(declaration.db), ...lexiconBlockProblems(declaration.lexicon), ...observeBlockProblems(declaration.observe));
  if (declaration.browser !== undefined && declaration.browser !== true) bad.push('browser is `true` when the app has a browser journey (slot app.browser), and is left out otherwise');
  if (declaration.kind !== APP_KIND) bad.push(`kind must be ${APP_KIND} (a product is one app repository with a be and an fe side) or ${RUNTIME_KIND} (the StarCi runtime repository)`);
  if (!isPlainObject(declaration.sides) || Object.keys(declaration.sides).sort(byCodeUnit).join() !== profiles.join()) { bad.push('sides must declare exactly be and fe'); return bad; }
  const names = new Map();
  for (const side of profiles) bad.push(...declarationSideProblems(side, declaration.sides[side], names));
  return bad;
}

/** Shape problems of a parsed hfs.json, in the words of modules/schemas/hfs-repo.schema.yaml. */
export function declarationShapeProblems(declaration: Parsed, profiles: Parsed): string[] {
  const bad: string[] = [];
  if (!isPlainObject(declaration)) return ['hfs.json is not an object'];
  if (!(Number.isInteger(declaration.hfs) && declaration.hfs >= 1)) bad.push('hfs must be the pinned manifest major (an integer, 1 or more)');
  if (!NAME.test(String(declaration.project))) bad.push('project must be a project name');
  if (declaration.kind === RUNTIME_KIND) {
    for (const key of Object.keys(declaration)) if (!RUNTIME_DECLARATION_KEYS.has(key)) bad.push(`unknown key ${key} (a runtime declaration is {hfs, kind, project})`);
    return bad;
  }
  bad.push(...productDeclarationProblems(declaration, profiles));
  return bad;
}
