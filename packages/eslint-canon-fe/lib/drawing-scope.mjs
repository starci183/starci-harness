/** Shared HFS scope of connected/presentational component pairs. */
import { hfsOf } from "./hfs.mjs"
import { fileOf, inSlot, kindOfFile, roleOfFile } from "./scope.mjs"

const SPLIT_KINDS = new Set(["blocks", "pages", "layouts", "overlays"])

/** The owning surface folder of the linted entry or presentation file. */
const surfaceName = (context) => hfsOf(context).relative(fileOf(context)).split("/").slice(-2)[0]

/** Whether the file belongs to an HFS owner with a connected/presentational pair. */
export const inSplitTier = (context) => inSlot(context, "fe.components", "fe.feature") && SPLIT_KINDS.has(kindOfFile(context))

/** The paired presentation file's component kind, or null outside that scope. */
export const pureHalf = (context) =>
  inSplitTier(context) && roleOfFile(context) === "drawing" && /^[A-Z][A-Za-z0-9]*$/.test(surfaceName(context)) ? kindOfFile(context) : null
