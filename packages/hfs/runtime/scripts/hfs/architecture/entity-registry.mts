import type { ImportDeclaration, Node } from 'typescript';
import { braceVariants, globExpression } from '../../lib/glob.mjs';

/**
 * The entity registry (persistence.md BE-PERSISTENCE-3): the one file whose slot plays `role: entity-registry`
 * (`be.platform.database.entities`, lite's `src/modules/platform/database/entities.ts`). It lists every capability's `<c>Entities`
 * array as `PRIMARY_ENTITIES`, so it is the one platform file that imports domain and platform capability barrels, and only for
 * that name; and it is imported by deep path only from the files its slot's `importedBy` names (app composition and the test world).
 * The tier matrix (tiers.mjs), the public-entry check (owners.mjs) and the lint rule `import-owner-entry` read it here.
 */
export const ENTITY_REGISTRY_ROLE = 'entity-registry';

/** The tiers whose capabilities contribute an entity list to the registry. */
const CONTRIBUTING_TIERS = new Set(['domain', 'platform']);

/** A slot of the manifest as far as the entity registry reads it. */
export interface RegistrySlot {
  role?: string;
  tier?: string;
  importedBy?: string[];
}

/** The slot resolver as far as the entity registry reads it. */
export interface RegistryResolver {
  slotOf?(file: string): RegistrySlot | null | undefined;
  sideOf?(file: string): string | null | undefined;
  ownerOf(file: string): { slot: string; root: string } | null | undefined;
  slot(id: string): RegistrySlot | null | undefined;
}

/** An owner-graph edge: side-relative `from` and `to`, with the TypeScript statement that makes it. */
export interface RegistryEdge {
  from: string;
  to: string;
  declaration?: Node;
  edge?: { declaration?: Node };
}

/** The entity list a capability exports: `<c>Entities`, `<c>` its folder name in camelCase. */
export const entityListName = (capability: string): string => `${capability.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase())}Entities`;

/** The slot of `file` (side-relative or absolute) when it plays the entity-registry role, else null. */
export function registrySlot(resolver: RegistryResolver | null | undefined, file: string): RegistrySlot | null {
  const slot = resolver?.slotOf?.(file);
  return slot?.role === ENTITY_REGISTRY_ROLE ? slot : null;
}

/**
 * Whether `file` is one of the importers the registry slot admits by deep path (`importedBy`, side-relative patterns); an app-wide
 * resolver answers for a side-prefixed path (`be/apps/...`), which is read without its side folder.
 */
export function registryImporter(resolver: RegistryResolver | null | undefined, slot: RegistrySlot, file: string): boolean {
  const side = resolver?.sideOf?.(file);
  const rel = side ? file.slice(side.length + 1) : file;
  return (slot.importedBy ?? []).some(pattern => braceVariants(pattern).some((variant: string) => globExpression(variant).test(rel)));
}

/** The names an import declaration binds by name; null for a default, namespace or side-effect import and for any re-export. */
function namedImports(declaration: Node | undefined): string[] | null {
  const clause = (declaration as ImportDeclaration | undefined)?.importClause;
  const bindings = clause?.namedBindings as { elements?: readonly { propertyName?: { text: string }; name: { text: string } }[] } | undefined;
  if (!clause || clause.name || !Array.isArray(bindings?.elements) || !bindings.elements.length) return null;
  return bindings.elements.map(element => (element.propertyName ?? element.name).text);
}

/**
 * Whether an owner-graph edge (side-relative `from` and `to`, `edge.declaration` the TypeScript statement) is the registry naming a
 * capability's entity list: it leaves the registry, imports the public entry (`index.ts`) of a domain or platform capability, and
 * binds that capability's `<c>Entities` and nothing else.
 */
export function registryListImport(resolver: RegistryResolver, edge: RegistryEdge): boolean {
  if (!registrySlot(resolver, edge.from)) return false;
  const owner = resolver.ownerOf(edge.to);
  const tier = owner ? resolver.slot(owner.slot)?.tier : undefined;
  if (!owner || !CONTRIBUTING_TIERS.has(tier ?? '') || edge.to !== `${owner.root}/index.ts`) return false;
  const names = namedImports(edge.edge?.declaration ?? edge.declaration);
  const listName = entityListName(owner.root.split('/').at(-1) ?? '');
  return names !== null && names.every(name => name === listName);
}
