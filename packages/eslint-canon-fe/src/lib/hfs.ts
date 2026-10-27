/**
 * The one door between the front-end lint rules and the HFS slot manifest of the repository being linted.
 *
 * A consuming `eslint.config.mjs` is the managed one-liner `export default starciFeConfig({ hfs: loadHfs(import.meta.url) })`.
 * The config lives in the fe/ side folder of an app; `loadHfs` finds the app-root `hfs.json` one level up and gives every file
 * linted under that folder the view of the fe side (paths relative to fe/), with the slot manifest this package ships in
 * `runtime/` (a byte copy of the runtime's `knowledge/hfs/slots.yaml`, `scripts/hfs/slots.mjs` and
 * `scripts/hfs/view.mjs`, refreshed by `scripts/hfs/sync-runtime.mjs`), and returns the view the factory puts
 * in `settings.starci.hfs`.
 *
 * Every path-scoped rule asks `slotOf` / `tierOf` here instead of testing a path with a regular expression. A rule that
 * needs the view and finds none stops the lint run with an error naming the fix: a rule must not guess.
 */
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { declaredHfsView, openHfsView } from "#runtime/scripts/hfs/view.mjs"
import type { HfsClassification, HfsSlot, HfsView } from "./hfs-view.ts"
import { RUNTIME_ROOT } from "./package-root.ts"
import type { AnyContext } from "./rule.ts"

export type { HfsAllowance, HfsApp, HfsClassification, HfsRuleParams, HfsSlot, HfsView } from "./hfs-view.ts"

const RUNTIME = RUNTIME_ROOT

/**
 * The HFS view of the side whose `eslint.config.mjs` (in fe/) calls this.
 *
 * @param configUrl - `import.meta.url` of the repository's `eslint.config.mjs`.
 * @returns The frozen HFS view.
 */
export const loadHfs = (configUrl: string | URL): HfsView => openHfsView({ runtimeRoot: RUNTIME, repoRoot: dirname(fileURLToPath(configUrl)) })

/**
 * The HFS view of the fe side of an in-memory app declaration, for rule tests.
 *
 * @param declaration - An app `hfs.json` object.
 * @param repoRoot - The absolute fe side folder the linted filenames live under.
 * @returns The frozen HFS view.
 */
export const hfsFromDeclaration = (declaration: unknown, repoRoot: string): HfsView =>
  declaredHfsView({ runtimeRoot: RUNTIME, declaration, repoRoot, side: "fe" })

/** True for a value that carries the view's resolver (`slotOf`), the test the canon has always made of `settings.starci.hfs`. */
export const isHfsView = (value: unknown): value is HfsView =>
  typeof value === "object" && value !== null && "slotOf" in value && typeof value.slotOf === "function"

/** The `starci.hfs` entry of a settings object, read without trusting its shape. */
const settingsHfs = (settings: unknown): unknown => {
  if (typeof settings !== "object" || settings === null || !("starci" in settings)) return undefined
  const starci = settings.starci
  if (typeof starci !== "object" || starci === null || !("hfs" in starci)) return undefined
  return starci.hfs
}

/**
 * The HFS view a rule runs under; a rule that needs it and gets none refuses to guess.
 *
 * @param context - The ESLint rule context.
 * @returns The HFS view from `settings.starci.hfs`.
 */
export const hfsOf = (context: AnyContext): HfsView => {
  const hfs = settingsHfs(context.settings)
  if (!isHfsView(hfs)) {
    throw new Error(`${context.id ?? "a starci-fe rule"} needs settings.starci.hfs: lint through starciFeConfig({ hfs: loadHfs(import.meta.url) })`)
  }
  return hfs
}

/**
 * The root of a classification the caller already knows is owned: a rule asks for it only after its scope test placed the
 * file in a slot, so a missing root is a broken manifest and stops the run, as reading it always has.
 */
export const requiredRoot = (found: HfsClassification): string => {
  if (found.root === undefined) throw new TypeError(`no slot root for ${found.path} (${found.status})`)
  return found.root
}

/** A slot the manifest always declares (`fe.app.next`, `fe.package.ui`, ...): a missing one is a broken manifest and stops the run. */
export const requiredSlot = (slot: HfsSlot | null, id: string): HfsSlot => {
  if (slot === null) throw new TypeError(`the slot manifest declares no ${id}`)
  return slot
}
