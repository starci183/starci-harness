/**
 * Next.js's own contract for route segment files, read from the runtime's one statement of it
 * (`scripts/lib/next-contract.mjs`, shipped in `runtime/` by `scripts/hfs/sync-runtime.mjs`), so every law
 * holds the same list by construction.
 */
import { NEXT_RESERVED_EXPORTS as RESERVED, NEXT_ROUTE_SEGMENT_STEMS as STEMS } from "#runtime/scripts/lib/next-contract.mjs"

/** The exports Next.js reserves in a route segment file. */
export const NEXT_RESERVED_EXPORTS: ReadonlySet<string> = RESERVED

/** The stems of Next.js route segment files. */
export const NEXT_ROUTE_SEGMENT_STEMS: ReadonlySet<string> = STEMS
