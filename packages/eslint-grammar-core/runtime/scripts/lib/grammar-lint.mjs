// Grammar-family lint selection reads the family catalog; an absent selection never chooses a family.
import fs from 'node:fs';
import { parseYamlCached } from './yaml-cached.mjs';
const CATALOG_FILE = new URL('../../knowledge/grammars/index.yaml', import.meta.url);
function readCatalog() {
    return parseYamlCached(fs.readFileSync(CATALOG_FILE, 'utf8'));
}
function selectedFamily(family) {
    if (typeof family !== 'string' || !family.trim())
        throw new Error('sides.fe.grammar must explicitly name the selected Grammar family');
    const catalog = readCatalog();
    const matches = (catalog.families ?? []).filter(entry => entry.id === family);
    if (matches.length !== 1)
        throw new Error(`Grammar family ${family} has no declared lint contract in knowledge/grammars/index.yaml`);
    return { catalog, selected: matches[0] };
}
/**
 * Resolve a selection to its declared family id; only a catalog family id resolves, there are no aliases.
 * @param {string} family - The id an app or caller names (sides.fe.grammar).
 * @returns {{ id: string }} The declared family id.
 */
export function resolveGrammarFamily(family) {
    return Object.freeze({ id: selectedFamily(family).selected.id });
}
/** The explicitly selected authored family entry; callers share the catalog lookup rather than inferring a family. */
export function grammarFamilyFor(family) {
    return Object.freeze(selectedFamily(family).selected);
}
/** The declared family's lint contract, including an explicit null package when that family has no rules. */
export function grammarLintFor(family) {
    const { selected } = selectedFamily(family);
    if (!selected.lint || !Object.hasOwn(selected.lint, 'package')) {
        throw new Error(`Grammar family ${family} has no declared lint contract in knowledge/grammars/index.yaml`);
    }
    const lint = selected.lint;
    if (lint.package === null)
        return Object.freeze({ family: selected.id, package: null });
    if (typeof lint.package !== 'string' || !lint.package.startsWith('@starci/eslint-grammar-')
        || typeof lint.factory !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(lint.factory)
        || typeof lint.prefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(lint.prefix)) {
        throw new Error(`Grammar family ${family} has an invalid lint contract in knowledge/grammars/index.yaml`);
    }
    return Object.freeze({ family: selected.id, package: lint.package, factory: lint.factory, prefix: lint.prefix });
}
/** The selected family's shared component/export contract, resolved through its catalog reference. */
export function grammarContractFor(family) {
    const { catalog, selected } = selectedFamily(family);
    const owners = (catalog.families ?? []).filter(entry => entry.id === selected.contractRef);
    const contract = owners.length === 1 ? owners[0]?.componentContract : null;
    if (!contract || typeof contract.package !== 'string' || !contract.package
        || typeof contract.entry !== 'string' || !contract.entry.startsWith(`${contract.package}/`)
        || typeof contract.styleEntry !== 'string' || !contract.styleEntry.startsWith(`${contract.package}/`)
        || !Array.isArray(contract.peers) || !contract.peers.every(peer => typeof peer === 'string' && peer.trim())) {
        throw new Error(`Grammar family ${family} has no valid component contract in knowledge/grammars/index.yaml`);
    }
    return Object.freeze({ ...contract, peers: Object.freeze([...contract.peers]) });
}
