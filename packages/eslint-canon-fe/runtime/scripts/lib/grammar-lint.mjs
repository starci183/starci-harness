// Grammar-family lint selection reads the family catalog; an absent selection never chooses a family.
import fs from 'node:fs';
import { parseYamlCached } from './yaml-cached.mjs';

const CATALOG_FILE = new URL('../../knowledge/grammars/index.yaml', import.meta.url);

function readCatalog() {
  return parseYamlCached(fs.readFileSync(CATALOG_FILE, 'utf8'));
}

/** The catalog's one alias table: a deprecated id names exactly one canonical family and is never itself a family. */
function aliasTarget(catalog, family) {
  const aliases = catalog.familyAliases ?? {};
  if (!Object.hasOwn(aliases, family)) return null;
  const target = aliases[family];
  if (typeof target !== 'string' || Object.hasOwn(aliases, target)
    || (catalog.families ?? []).some(entry => entry.id === family)) {
    throw new Error(`Grammar family alias ${family} in knowledge/grammars/index.yaml must name one canonical family`);
  }
  return target;
}

function selectedFamily(family) {
  if (typeof family !== 'string' || !family.trim()) throw new Error('sides.fe.grammar must explicitly name the selected Grammar family');
  const catalog = readCatalog();
  const id = aliasTarget(catalog, family) ?? family;
  const matches = (catalog.families ?? []).filter(entry => entry.id === id);
  if (matches.length !== 1) throw new Error(`Grammar family ${family} has no declared lint contract in knowledge/grammars/index.yaml`);
  return { catalog, selected: matches[0] };
}

/**
 * Resolve a selection to its canonical family id through the catalog's alias table.
 * @param {string} family - The id an app or caller names (sides.fe.grammar).
 * @returns {{ id: string, alias: string | null, note: string | null }} The canonical id; for a deprecated alias, the alias and a note naming the canonical id.
 */
export function resolveGrammarFamily(family) {
  const { selected } = selectedFamily(family);
  if (selected.id === family) return Object.freeze({ id: family, alias: null, note: null });
  return Object.freeze({
    id: selected.id,
    alias: family,
    note: `Grammar family id ${family} is a deprecated alias of ${selected.id}; write sides.fe.grammar: ${selected.id}`,
  });
}

/** The explicitly selected authored family entry; callers share the catalog lookup rather than inferring a family. */
export function grammarFamilyFor(family) {
  return Object.freeze(selectedFamily(family).selected);
}

/** The declared family's lint contract (keyed by the canonical id), including an explicit null package when that family has no rules. */
export function grammarLintFor(family) {
  const { selected } = selectedFamily(family);
  if (!selected.lint || !Object.hasOwn(selected.lint, 'package')) {
    throw new Error(`Grammar family ${family} has no declared lint contract in knowledge/grammars/index.yaml`);
  }
  const lint = selected.lint;
  const canonical = selected.id;
  if (lint.package === null) return Object.freeze({ family: canonical, package: null });
  if (typeof lint.package !== 'string' || !lint.package.startsWith('@starci/eslint-grammar-')
    || typeof lint.factory !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(lint.factory)
    || typeof lint.prefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(lint.prefix)) {
    throw new Error(`Grammar family ${family} has an invalid lint contract in knowledge/grammars/index.yaml`);
  }
  return Object.freeze({ family: canonical, package: lint.package, factory: lint.factory, prefix: lint.prefix });
}

/** The selected family's shared component/export contract, resolved through its catalog reference. */
export function grammarContractFor(family) {
  const { catalog, selected } = selectedFamily(family);
  const owners = (catalog.families ?? []).filter(entry => entry.id === selected.contractRef);
  const contract = owners.length === 1 ? owners[0].componentContract : null;
  if (!contract || typeof contract.package !== 'string' || !contract.package
    || typeof contract.entry !== 'string' || !contract.entry.startsWith(`${contract.package}/`)
    || typeof contract.styleEntry !== 'string' || !contract.styleEntry.startsWith(`${contract.package}/`)
    || !Array.isArray(contract.peers) || !contract.peers.every(peer => typeof peer === 'string' && peer.trim())) {
    throw new Error(`Grammar family ${family} has no valid component contract in knowledge/grammars/index.yaml`);
  }
  return Object.freeze({ ...contract, peers: Object.freeze([...contract.peers]) });
}
