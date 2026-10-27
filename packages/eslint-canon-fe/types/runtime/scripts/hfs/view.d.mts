// The types of runtime/scripts/hfs/view.mjs, the bundled runtime the canon reads through `#runtime/*` until the runtime is built
// from packages/hfs with its own declarations.
import type { HfsView } from "../../../../src/lib/hfs-view.ts"

/** The view of the app folder on disk at `repoRoot`, against the manifest under `runtimeRoot`. */
export declare const openHfsView: (input: { readonly runtimeRoot: string; readonly repoRoot: string }) => HfsView

/** The view of one side of an in-memory app declaration. */
export declare const declaredHfsView: (input: {
  readonly runtimeRoot: string
  readonly declaration: unknown
  readonly repoRoot: string
  readonly side: string
}) => HfsView
