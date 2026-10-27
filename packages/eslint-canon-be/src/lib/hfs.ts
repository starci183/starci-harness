/**
 * The one door between the lint rules and the HFS slot manifest of the repository being linted.
 *
 * A consuming `eslint.config.mjs` is the one line `export default starciBeConfig({ hfs: loadHfs(import.meta.url) })`.
 * The config lives in the be/ side folder of an app; `loadHfs` finds the app-root `hfs.json` one level up and gives every file
 * linted under that folder the view of the be side (paths relative to be/), with the slot manifest this package ships in
 * `runtime/` (a byte copy of the runtime's `knowledge/hfs/slots.yaml`, `scripts/hfs/slots.mjs` and `scripts/hfs/view.mjs`, refreshed by
 * `scripts/hfs/sync-runtime.mjs`), and returns an object the factory puts in `settings.starci.hfs`.
 *
 * Every path-scoped rule asks `slotOf` here instead of testing a path with a regular expression: a rule never assumes
 * `/src/modules/` or `/src/tests/`. A rule that needs the manifest and finds no `settings.starci.hfs` stops the lint run
 * with an error naming the fix, because a rule must not guess.
 */
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { declaredHfsView, openHfsView, type HfsView } from "../../runtime/scripts/hfs/view.mjs"
import type { Context } from "./rule.ts"
import { RUNTIME_ROOT as RUNTIME } from "./runtime-root.ts"

export type {
    HfsAllowsVerdict,
    HfsApp,
    HfsClassification,
    HfsConnection,
    HfsParamName,
    HfsRuleParams,
    HfsSlot,
    HfsSpecDouble,
    HfsUnitRole,
    HfsView,
} from "../../runtime/scripts/hfs/view.mjs"

/**
 * The HFS view of the side whose `eslint.config.mjs` (in be/) calls this.
 *
 * @param configUrl - `import.meta.url` of the repository's `eslint.config.mjs`.
 * @returns The frozen HFS view (profile, apps, connections, ruleParams, slotOf, tierOf, ownerOf).
 */
export const loadHfs = (configUrl: string): HfsView => openHfsView({ runtimeRoot: RUNTIME, repoRoot: dirname(fileURLToPath(configUrl)) })

/**
 * The HFS view of the be side of an in-memory app declaration, for rule tests: no file is read except the shipped manifest.
 *
 * @param declaration - An app `hfs.json` object.
 * @param repoRoot - The absolute be side folder the linted filenames live under.
 * @returns The frozen HFS view.
 */
export const hfsFromDeclaration = (declaration: object, repoRoot: string): HfsView => declaredHfsView({ runtimeRoot: RUNTIME, declaration, repoRoot, side: "be" })

/** Whether a settings value is an HFS view (it answers `slotOf`). */
const isHfsView = (value: unknown): value is HfsView =>
    typeof value === "object" && value !== null && "slotOf" in value && typeof value.slotOf === "function"

/** The `settings.starci.hfs` value of a rule context, if any. */
const settingsHfs = (context: Context): unknown => {
    const starci: unknown = context.settings?.["starci"]
    return typeof starci === "object" && starci !== null && "hfs" in starci ? starci.hfs : undefined
}

/**
 * The HFS view a rule runs under; a rule that needs it and gets none refuses to guess.
 *
 * @param context - The ESLint rule context.
 * @returns The HFS view from `settings.starci.hfs`.
 */
export const hfsOf = (context: Context): HfsView => {
    const hfs = settingsHfs(context)
    if (!isHfsView(hfs)) {
        throw new Error(`${context.id ?? "a starci-be rule"} needs settings.starci.hfs: lint through starciBeConfig({ hfs: loadHfs(import.meta.url) })`)
    }
    return hfs
}

/**
 * Whether a file belongs to the test world: the slot `be.tests.world` or one of its sub-slots (`be.tests.world.kit`, the world's
 * inlined helpers). The world and its helpers form one test composition root.
 *
 * @param hfs - The HFS view of the repository.
 * @param file - A file path.
 * @returns True for a file of the test world family.
 */
export const inTestWorld = (hfs: HfsView, file: string): boolean => {
    const slot = hfs.slotOf(file)
    return slot === "be.tests.world" || (typeof slot === "string" && slot.startsWith("be.tests.world."))
}
