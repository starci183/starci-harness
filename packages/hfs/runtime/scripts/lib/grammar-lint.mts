// Grammar-family lint selection reads the family catalog; an absent selection never chooses a family.
import fs from 'node:fs';
import { parseYamlCached } from './yaml-cached.mjs';

const CATALOG_FILE = new URL('../../knowledge/grammars/index.yaml', import.meta.url);

/**
 * The component/export contract of a Grammar family. `entry` and `styleEntry` are the shared contract's (`@starci/grammar/common`,
 * `common.css`): every install must export them. `entries` are every code entry the family admits, the shared one first, then the family's own
 * (`familyEntries` of its catalog entry: `@starci/grammar/offset-pop`, which re-exports Common); `styleEntries` every base stylesheet (each family
 * sheet imports the shared anatomy first, so one of them is enough); `themeEntries` the optional default palettes a stylesheet may import beside
 * a base one. A family's own entry is admitted only where the install a source resolves exports it.
 */
export interface GrammarComponentContract {
  package: string;
  entry: string;
  styleEntry: string;
  entries: readonly string[];
  styleEntries: readonly string[];
  themeEntries: readonly string[];
  peers: readonly string[];
  semanticRoles?: unknown;
}
/** A family's own public entries over the shared contract (`familyEntries` in knowledge/grammars/index.yaml). */
export interface GrammarFamilyEntries { entry?: unknown; styleEntry?: unknown; themeEntries?: unknown }
/** The lint contract a family declares; a null package means the family has no rules. */
export interface GrammarLintDeclaration { package?: string | null; factory?: unknown; prefix?: unknown }
/** One family entry of knowledge/grammars/index.yaml. */
export interface GrammarFamilyEntry {
  id: string;
  contractRef?: string;
  lint?: GrammarLintDeclaration;
  componentContract?: Partial<GrammarComponentContract> | null;
  familyEntries?: GrammarFamilyEntries | null;
  [key: string]: unknown;
}
/** The family catalog document. */
export interface GrammarCatalog { families?: GrammarFamilyEntry[] }

function readCatalog(): GrammarCatalog {
  return parseYamlCached(fs.readFileSync(CATALOG_FILE, 'utf8'));
}

function selectedFamily(family: unknown): { catalog: GrammarCatalog; selected: GrammarFamilyEntry } {
  if (typeof family !== 'string' || !family.trim()) throw new Error('sides.fe.grammar must explicitly name the selected Grammar family');
  const catalog = readCatalog();
  const matches = (catalog.families ?? []).filter(entry => entry.id === family);
  if (matches.length !== 1) throw new Error(`Grammar family ${family} has no declared lint contract in knowledge/grammars/index.yaml`);
  return { catalog, selected: matches[0] as GrammarFamilyEntry };
}

/**
 * Resolve a selection to its declared family id; only a catalog family id resolves, there are no aliases.
 * @param {string} family - The id an app or caller names (sides.fe.grammar).
 * @returns {{ id: string }} The declared family id.
 */
export function resolveGrammarFamily(family: unknown): Readonly<{ id: string }> {
  return Object.freeze({ id: selectedFamily(family).selected.id });
}

/** The explicitly selected authored family entry; callers share the catalog lookup rather than inferring a family. */
export function grammarFamilyFor(family: unknown): Readonly<GrammarFamilyEntry> {
  return Object.freeze(selectedFamily(family).selected);
}

/** The declared family's lint contract, including an explicit null package when that family has no rules. */
export function grammarLintFor(family: unknown): Readonly<{ family: string; package: null } | { family: string; package: string; factory: string; prefix: string }> {
  const { selected } = selectedFamily(family);
  if (!selected.lint || !Object.hasOwn(selected.lint, 'package')) {
    throw new Error(`Grammar family ${family} has no declared lint contract in knowledge/grammars/index.yaml`);
  }
  const lint = selected.lint;
  if (lint.package === null) return Object.freeze({ family: selected.id, package: null });
  if (typeof lint.package !== 'string' || !lint.package.startsWith('@starci/eslint-grammar-')
    || typeof lint.factory !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(lint.factory)
    || typeof lint.prefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(lint.prefix)) {
    throw new Error(`Grammar family ${family} has an invalid lint contract in knowledge/grammars/index.yaml`);
  }
  return Object.freeze({ family: selected.id, package: lint.package, factory: lint.factory, prefix: lint.prefix });
}

/** The lint package of every catalog family that declares one, sorted: the packages one family's selection swaps between. */
export function grammarLintPackages(): readonly string[] {
  const names = (readCatalog().families ?? []).map(entry => entry.lint?.package).filter((name): name is string => typeof name === 'string' && name.startsWith('@starci/eslint-grammar-'));
  return Object.freeze([...new Set(names)].sort());
}

/** The selected family's component/export contract: the shared contract it references, with the family's own entries over it. */
export function grammarContractFor(family: unknown): Readonly<GrammarComponentContract> {
  const { catalog, selected } = selectedFamily(family);
  const owners = (catalog.families ?? []).filter(entry => entry.id === selected.contractRef);
  const contract = owners.length === 1 ? owners[0]?.componentContract : null;
  if (!contract || typeof contract.package !== 'string' || !contract.package
    || typeof contract.entry !== 'string' || !contract.entry.startsWith(`${contract.package}/`)
    || typeof contract.styleEntry !== 'string' || !contract.styleEntry.startsWith(`${contract.package}/`)
    || !Array.isArray(contract.peers) || !contract.peers.every(peer => typeof peer === 'string' && peer.trim())) {
    throw new Error(`Grammar family ${family} has no valid component contract in knowledge/grammars/index.yaml`);
  }
  const own = familyEntriesOf(selected, contract.package, family);
  return Object.freeze({
    ...(contract as GrammarComponentContract),
    entries: Object.freeze([...new Set([contract.entry, ...(own ? [own.entry] : [])])]),
    styleEntries: Object.freeze([...new Set([contract.styleEntry, ...(own ? [own.styleEntry] : [])])]),
    themeEntries: Object.freeze([...(own?.themeEntries ?? [])]),
    peers: Object.freeze([...contract.peers]),
  });
}

/** The family's own entries, each a subpath of the shared package; undefined when the family declares none (it uses the shared entries alone). */
function familyEntriesOf(selected: GrammarFamilyEntry, packageName: string, family: unknown): { entry: string; styleEntry: string; themeEntries: string[] } | undefined {
  const own = selected.familyEntries;
  if (own === undefined || own === null) return undefined;
  const subpath = (value: unknown): value is string => typeof value === 'string' && value.startsWith(`${packageName}/`);
  const themes = own.themeEntries ?? [];
  if (!subpath(own.entry) || !subpath(own.styleEntry) || !Array.isArray(themes) || !themes.every(subpath)) {
    throw new Error(`Grammar family ${family} has invalid familyEntries in knowledge/grammars/index.yaml`);
  }
  return { entry: own.entry, styleEntry: own.styleEntry, themeEntries: [...themes] };
}
