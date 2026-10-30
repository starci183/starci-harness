// catalog.generated.d.mts - the types of catalog.generated.mjs, the command table runtime/scripts/cli/gen-catalog.mjs writes from the
// starci CLI registry (cli/src/registry.ts). Hand-written: the generated module carries no types of its own.
import type { CatalogFlag, CatalogVerb } from './validate-args.mjs';

/** One catalogued verb: its summary and the flags, positionals, editions and json mode validateArgs judges a command line by. */
export interface CatalogEntry extends CatalogVerb { summary: string; flags: CatalogFlag[] }

/** The starci command catalog: the global flags, and per group its verbs and, for a group that is itself a command, `self`. */
export declare const CATALOG: {
  readonly schema: string;
  readonly global: CatalogFlag[];
  readonly groups: Record<string, { readonly verbs: Record<string, CatalogEntry>; readonly self?: CatalogEntry }>;
};
