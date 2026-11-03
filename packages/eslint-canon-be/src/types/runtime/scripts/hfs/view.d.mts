// The types of runtime/scripts/hfs/view.mjs (a bundled copy of @starci/hfs's runtime, untyped JavaScript), read through
// `#runtime/*`; the view's shapes are src/lib/hfs-view.ts.
import type { HfsView } from "../../../../lib/hfs-view.ts"

/** The view of the app folder on disk at `repoRoot`. */
export declare function openHfsView(input: { readonly runtimeRoot: string; readonly repoRoot: string }): HfsView

/** The view of one side of an in-memory app declaration. */
export declare function declaredHfsView(input: { readonly runtimeRoot: string; readonly declaration: object; readonly repoRoot: string; readonly side: string }): HfsView

/** The view of the root packages of the app at `repoRoot` (the app root), for the laws of `side`. */
export declare function openPackagesHfsView(input: { readonly runtimeRoot: string; readonly repoRoot: string; readonly side: "be" | "fe" }): HfsView

/** The view of the root packages of an in-memory app declaration. */
export declare function declaredPackagesHfsView(input: { readonly runtimeRoot: string; readonly declaration: object; readonly repoRoot: string; readonly side: "be" | "fe" }): HfsView
