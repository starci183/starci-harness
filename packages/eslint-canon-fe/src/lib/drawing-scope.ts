/** Shared HFS scope of connected/presentational component pairs. */
import { hfsOf } from "./hfs.ts"
import type { AnyContext } from "./rule.ts"
import { fileOf, inSlot, kindOfFile, roleOfFile } from "./scope.ts"

const SPLIT_KINDS = new Set<string | null>(["blocks", "pages", "layouts", "overlays"])

/** The owning surface folder of the linted entry or presentation file. */
const surfaceName = (context: AnyContext): string | undefined => hfsOf(context).relative(fileOf(context)).split("/").slice(-2)[0]

/** Whether the file belongs to an HFS owner with a connected/presentational pair. */
export const inSplitTier = (context: AnyContext): boolean => inSlot(context, "fe.components", "fe.feature") && SPLIT_KINDS.has(kindOfFile(context))

/** The paired presentation file's component kind, or null outside that scope. */
export const pureHalf = (context: AnyContext): string | null =>
  inSplitTier(context) && roleOfFile(context) === "drawing" && /^[A-Z][A-Za-z0-9]*$/.test(String(surfaceName(context))) ? kindOfFile(context) : null
