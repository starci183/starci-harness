// The engine-owned database objects of an app (hfs.json sides.be.engineOwned): one capability owns a fixed set of tables, every
// partition of one of them (`<parent>_<entity>`) and every view matching one prefix pattern (`v_*`). R35, R86 and `app db drift`
// (R333) read the same declaration through these helpers, so what counts as the engine's is decided in one place.
import { isPlainObject } from '../../engine/plain-object.mjs';

/** The declaration: the owning capability folder name, its base tables, the table whose partitions it owns, the view prefix pattern and the manifest of declared entities (relative to the app root). */
export interface EngineOwned {
  capability: string;
  tables: readonly string[];
  partitionsOf: string;
  views: string;
  manifest: string;
}

const NAME = /^[a-z][a-z0-9_]*$/;
const CAPABILITY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VIEWS = /^[a-z][a-z0-9_]*\*$/;
const MANIFEST = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\.json$/;

/** True for an absent declaration or a well-formed one: {capability, tables, partitionsOf (one of tables), views (`prefix*`), manifest (a relative .json path)}. */
export const engineOwnedOk = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).sort().join() !== 'capability,manifest,partitionsOf,tables,views') return false;
  const tables = entry.tables;
  return typeof entry.capability === 'string' && CAPABILITY.test(entry.capability)
    && Array.isArray(tables) && tables.length > 0 && new Set(tables).size === tables.length && tables.every((table) => typeof table === 'string' && NAME.test(table))
    && typeof entry.partitionsOf === 'string' && tables.includes(entry.partitionsOf)
    && typeof entry.views === 'string' && VIEWS.test(entry.views)
    && typeof entry.manifest === 'string' && MANIFEST.test(entry.manifest) && !entry.manifest.split('/').includes('..');
};

/** What the engine owns, by kind, for a table or view name without its schema (public); null when it is none of them. */
export function engineKind(engine: EngineOwned | undefined, name: string): 'table' | 'partition' | 'view' | null {
  if (!engine) return null;
  const lower = name.toLowerCase();
  if (engine.tables.includes(lower)) return 'table';
  if (lower.startsWith(`${engine.partitionsOf}_`)) return 'partition';
  if (lower.startsWith(engine.views.slice(0, -1))) return 'view';
  return null;
}

/** Whether the capability folder (a path or its name) is the declared engine capability. */
export const isEngineCapability = (engine: EngineOwned, root: string): boolean => root.split('/').at(-1) === engine.capability;
