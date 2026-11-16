// data-stores.mts - R426: every store that must be kept has an adapter (contexts/project/stacks.md PROJECT-STACKS-14), over the `data:` member
// of .starcistacks/application-stacks.yaml:
//   DATA_STORE_UNDECLARED  a stateful component or declared backing (the one definition of stateful-components.mts, shared with R267) is the
//                          `component` of no store and of no `derived` entry, or a store or derived entry names a component the stack lacks;
//   DATA_STORE_KIND        a store with no id, an id declared twice, a kind outside the closed list (database, storage) or a level other than
//                          logical or physical;
//   DATA_STORE_ADAPTER     a store's `adapter.module` is absent, is no tracked source file under the app root, or holds no class that
//                          `implements StoreAdapter`; `adapter.command`, when present, is a non-empty argv of strings, and is required for a store of
//                          a data set whose purpose is seed-backup (the command `starci app data` runs to reach the store, protocol starci/data-entries@1)
//                          and for a store a seed-standard fills without a project `completeness` (the seed door the bring-up loader applies it through);
//   DATA_DERIVED_SOURCE    a `derived` entry whose `rebuild` is empty, whose component is missing or whose `from`, when present, is no declared store
//                          (`from` is optional: a source outside the project, such as an ingress's ACME certificates, names none).
// A project with no stateful component and no `data:` member is green. R267's BACKUP_UNDECLARED (a swarm environment's backup records) is a
// separate law over the same stateful definition.
import { isPlainObject as plain } from '../../../engine/plain-object.mjs';
import { findStackDeclaration } from '../../lib/stack-declaration.mjs';
import { found, readText } from './read.mjs';
import { statefulComponentsOf } from './stateful-components.mjs';
import type { Finding, Parsed, Repo } from './rule-types.mjs';

// The closed lists are owned by `@starci/seed` src/words.ts (STORE_KINDS); @starci/hfs does not depend on it, so they are copied.
/** The store kinds. */
export const STORE_KINDS: readonly string[] = ['database', 'storage'];
/** The store levels. */
export const STORE_LEVELS: readonly string[] = ['logical', 'physical'];

const STACK_FILE = '.starcistacks/application-stacks.yaml';
const mapping = (value: unknown): Record<string, Parsed> => (plain(value) ? value as Record<string, Parsed> : {});
const list = (value: unknown): Parsed[] => (Array.isArray(value) ? value : []);
const present = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const IMPLEMENTS = /\bimplements\b[^{]*\bStoreAdapter\b|\)\s*:\s*StoreAdapter\b/u;

/** The component ids a stack declaration names: components and backing. */
const declaredComponents = (doc: Parsed): Set<string> => new Set([...Object.keys(mapping(doc.components)), ...Object.keys(mapping(doc.backing))]);

/** True when `module` is a safe app-relative path (no absolute path, no `..`). */
const relative = (module: string): boolean => !/^(?:[A-Za-z]:|[\\/])/u.test(module) && module.split(/[\\/]/u).every((part) => part !== '..' && part !== '' && part !== '.');

/**
 * DATA_STORE_* and DATA_DERIVED_SOURCE over a parsed stack declaration. `tracked` is the set of the app's tracked files and `source` gives a
 * tracked file's text (null: unreadable). Pure.
 */
export function dataStoreFindings(doc: Parsed, tracked: ReadonlySet<string>, source: (file: string) => string | null): Finding[] {
  if (!plain(doc)) return [];
  const stateful = statefulComponentsOf(doc);
  if (doc.data === undefined && stateful.length === 0) return [];
  const findings: Finding[] = [];
  const at = (code: string, where: string, message: string, extra: Record<string, unknown> = {}) => findings.push(found(code, STACK_FILE, `data.${where}: ${message} (PROJECT-STACKS-14)`, extra));
  if (doc.data !== undefined && !plain(doc.data)) at('DATA_STORE_KIND', '', 'the data declaration must be a mapping of stores, derived and sets');
  const data = mapping(doc.data);
  const components = declaredComponents(doc);
  const stores = list(data.stores), derived = list(data.derived);
  const storeIds = new Set<string>();
  const backedUp = new Set(list(data.sets).flatMap((set: Parsed) => (plain(set) && set.purpose === 'seed-backup' ? list(set.stores).filter(present) : [])));
  // A store a seed-standard fills is applied through its door by the bring-up's loader (stack/standard-load.mts); a project kind (completeness) reads its own.
  const seeded = new Set(list(data.sets).flatMap((set: Parsed) => (plain(set) && set.purpose === 'seed-standard' && set.completeness === undefined ? list(set.stores).filter(present) : [])));
  const covered = new Set<string>();

  stores.forEach((store: Parsed, index: number) => {
    const where = `stores[${String(index)}]`;
    if (!plain(store)) { at('DATA_STORE_KIND', where, 'a store is a mapping {id, kind, level, component, adapter}'); return; }
    if (!present(store.id)) at('DATA_STORE_KIND', where, 'a store needs an id');
    else if (storeIds.has(store.id)) at('DATA_STORE_KIND', where, `the store id ${store.id} is declared twice`);
    else storeIds.add(store.id);
    if (!STORE_KINDS.includes(store.kind)) at('DATA_STORE_KIND', where, `kind ${JSON.stringify(store.kind ?? null)} is outside the closed list (${STORE_KINDS.join(', ')}); a new kind is a harness change`, { store: store.id });
    if (!STORE_LEVELS.includes(store.level)) at('DATA_STORE_KIND', where, `level ${JSON.stringify(store.level ?? null)} must be logical or physical`, { store: store.id });
    if (!present(store.component) || !components.has(store.component)) at('DATA_STORE_UNDECLARED', where, `the component ${JSON.stringify(store.component ?? null)} is no component or backing of the stack`, { store: store.id });
    else covered.add(store.component);
    const module = plain(store.adapter) ? store.adapter.module : undefined;
    if (!present(module) || !relative(module)) at('DATA_STORE_ADAPTER', where, 'adapter.module must name the app-relative source file of the class that implements StoreAdapter', { store: store.id });
    else if (!tracked.has(module)) at('DATA_STORE_ADAPTER', where, `adapter.module ${module} is no tracked source file`, { store: store.id, module });
    else if (!IMPLEMENTS.test(source(module) ?? '')) at('DATA_STORE_ADAPTER', where, `adapter.module ${module} holds no class that implements StoreAdapter and no factory whose declared return type is StoreAdapter`, { store: store.id, module });
    const command = plain(store.adapter) ? store.adapter.command : undefined;
    if (command !== undefined && !(Array.isArray(command) && command.length > 0 && command.every(present))) at('DATA_STORE_ADAPTER', where, 'adapter.command must be a non-empty argv of strings: the app command that serves the store over starci/data-entries@1', { store: store.id });
    else if (command === undefined && present(store.id) && backedUp.has(store.id)) at('DATA_STORE_ADAPTER', where, `the store ${store.id} belongs to a seed-backup set, so adapter.command must name the app command that serves it over starci/data-entries@1 (starci app data runs it)`, { store: store.id });
    else if (command === undefined && present(store.id) && seeded.has(store.id)) at('DATA_STORE_ADAPTER', where, `the store ${store.id} is filled by a seed-standard, so adapter.command must name the app command that serves it over starci/data-entries@1: the seed door the bring-up applies the standard through`, { store: store.id });
  });

  derived.forEach((entry: Parsed, index: number) => {
    const where = `derived[${String(index)}]`;
    if (!plain(entry)) { at('DATA_DERIVED_SOURCE', where, 'a derived entry is a mapping {component, from?, rebuild}'); return; }
    if (!present(entry.component) || !components.has(entry.component)) at('DATA_DERIVED_SOURCE', where, `the component ${JSON.stringify(entry.component ?? null)} is no component or backing of the stack`);
    else covered.add(entry.component);
    if (entry.from !== undefined && (!present(entry.from) || !storeIds.has(entry.from))) at('DATA_DERIVED_SOURCE', where, `from ${JSON.stringify(entry.from ?? null)} is no declared store`, { component: entry.component });
    if (!present(entry.rebuild)) at('DATA_DERIVED_SOURCE', where, 'rebuild must say how the component is rebuilt from its source', { component: entry.component });
  });

  for (const component of stateful) {
    if (!covered.has(component)) at('DATA_STORE_UNDECLARED', `stores`, `the stateful component ${component} is the component of no store and of no derived entry: declare a store with an adapter, or declare it derived from a store and how it is rebuilt`, { component });
  }
  return findings;
}

/** Findings of R426 at the app root of an app. */
export function dataStoresFindings({ repoRoot, repo, isRoot, all = [] }: { repoRoot: string; repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  const stack = findStackDeclaration(repoRoot);
  return stack.doc ? dataStoreFindings(stack.doc, new Set(all), (file) => readText(repoRoot, file)) : [];
}
