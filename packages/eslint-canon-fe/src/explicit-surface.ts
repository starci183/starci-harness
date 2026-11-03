/**
 * The explicit exported surface (HFS R368, `HFS_EXPLICIT_EXPORT_SURFACE`): an exported declaration states its type, in the file that exports it.
 *
 * A return type, variable type or parameter type left to inference is a surface importers read from the body and from the files the body uses, so
 * the result cache of `starci app check --gate lint` lints every importer again whenever the file changes (check-cache.md, ESLint). The rule
 * reports each export the isolated declaration emit (`ts.transpileDeclaration`) cannot write without inference, where it is written, and says
 * what to annotate. A component that returns only JSX has the type the JSX namespace gives it and is not reported. It is the very classifier the
 * cache reads (`declarationSurface` of the bundled runtime), so the rule reports exactly the files the cache counts as open.
 */
import ts from "typescript"
import { explicitSurfaceRule } from "#runtime/scripts/hfs/explicit-surface-rule.mjs"
import type { Recommended, Rules } from "./lib/rule.ts"

/** The rules this law contributes to the plugin. */
export const rules = {
  "explicit-export-surface": explicitSurfaceRule({ ts }),
} satisfies Rules

/** Every exported type is written out, at error. */
export const recommended: Recommended = {
  "starci-fe/explicit-export-surface": "error",
}
