// proves: HFS_SLOT_UNDECLARED@lite
// proves: HFS_SLOT_UNDECLARED@full
// proves: HFS_SLOT_AMBIGUOUS@lite
// proves: HFS_SLOT_AMBIGUOUS@full
// proves: HFS_SLOT_NOT_ENABLED@lite
// proves: HFS_SLOT_NOT_ENABLED@full
/**
 * RuleTester proofs of the registered front-end rule `slot-undeclared` (R01) for the three codes it reports, in lite and in full: a TypeScript
 * file is owned by exactly one enabled slot of the repository.
 *
 *   HFS_SLOT_UNDECLARED   no slot owns the path
 *   HFS_SLOT_NOT_ENABLED  an opt-in slot owns it and hfs.json neither lists nor implies that slot
 *   HFS_SLOT_AMBIGUOUS    two slots of equal specificity own it: a gap of the slot manifest, reported and never guessed
 *
 * The shipped manifest has no such gap (tests/hfs/hfs-slots.spec.mjs proves that every slot owns its own sample), so the ambiguous case runs the
 * same registered rule over a hermetic manifest: the shipped text plus two slots whose patterns differ only in the name of a variable, which the
 * manifest loader's literal duplicate-pattern check does not see. The rule reads that manifest through the fixtures-only `injectedRuntimeRoot` setting.
 *
 *   node --test src/slot-ownership.spec.ts
 */
import test from "node:test"
import type { RuleTester } from "eslint"
import fs from "node:fs"
import path from "node:path"
import { parseYaml } from "#runtime/engine/yaml.mjs"
import { projectFixture } from "../../eslint-canon-be/fixtures/project/tester.ts"
import { rules } from "./project-graph.ts"
import { canonTester } from "../fixtures/typed/tester.ts"
import type { Rule } from "./lib/rule.ts"

/** The rule project-graph publishes as `name`; a missing one fails the run. */
const ruleOf = (name: string): Rule => {
  const rule = rules[name]
  if (rule === undefined) throw new Error(`project-graph publishes no ${name}`)
  return rule
}
import { RUNTIME_ROOT } from "./lib/package-root.ts"

const EXPORT = "export const value = 1;\n"
/** A slot row of the manifest, read as data. */
type SlotRow = Readonly<Record<string, unknown>>

/** The slot manifest, read as data: its slots and every other key it carries. */
interface Manifest {
    readonly slots: readonly SlotRow[]
    readonly [key: string]: unknown
}

/** True for an object (a manifest or a slot row). */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The manifest a YAML text spells; one with no slot list is no manifest. */
const manifestOf = (document: unknown): Manifest => {
    if (!isRecord(document)) throw new Error("the shipped slot manifest is not a mapping")
    const slots = document["slots"]
    if (!Array.isArray(slots) || !slots.every(isRecord)) throw new Error("the shipped slot manifest has no slot list")
    return { ...document, slots }
}

const SHIPPED = manifestOf(parseYaml(fs.readFileSync(path.join(RUNTIME_ROOT, "knowledge", "hfs", "slots.yaml"), "utf8")))
const TEMPLATE = SHIPPED.slots.find((slot) => slot["id"] === "repo.build-output")
const OWNED = "apps/web/src/modules/hooks/x.ts"

/** The shipped manifest with two fe slots of the same specificity over `apps/<app>/src/twin/<name>/`. */
const twinManifest = () => {
    const twin = (id: string, name: string) => ({ ...TEMPLATE, id, profiles: ["fe"], path: `apps/<app>/src/twin/<${name}>/` })
    return JSON.stringify({ ...SHIPPED, slots: [...SHIPPED.slots, twin("fe.twin.left", "left"), twin("fe.twin.right", "right")] })
}

/** The one finding the rule reports on the visited file: its code and the machine's own sentence. */
const finding = (code: string, sentence: string): RuleTester.TestCaseError => ({ message: `[${code}] ${sentence}` })
const at = (f: ReturnType<typeof projectFixture>, rel: string) => ({ filename: f.at(rel), code: EXPORT })
const fe = (input: Omit<NonNullable<Parameters<typeof projectFixture>[0]>, "profile">) => projectFixture({ profile: "fe", ...input })

for (const edition of ["lite", "full"] as const) {
    test(`${edition}: a TypeScript file of a front end that no slot owns is HFS_SLOT_UNDECLARED, one a slot owns is not`, (t) => {
        const stray = "apps/web/src/x.ts"
        const f = fe({ edition, files: { [stray]: EXPORT, [OWNED]: EXPORT } })
        t.after(f.cleanup)
        canonTester(f.tester).run("slot-undeclared", ruleOf("slot-undeclared"), {
            valid: [at(f, OWNED)],
            invalid: [{ ...at(f, stray), errors: [finding("HFS_SLOT_UNDECLARED", `${stray} matches no slot; nearest slot fe.route (apps/<app>/src/app/), matched apps/web/src then expected app`)] }],
        })
    })

    test(`${edition}: a TypeScript file of an opt-in front-end slot nobody declared is HFS_SLOT_NOT_ENABLED, once the slot is declared it is not`, (t) => {
        const shared = "packages/shared/index.ts"
        const rejected = fe({ edition, files: { [shared]: EXPORT, [OWNED]: EXPORT } })
        t.after(rejected.cleanup)
        canonTester(rejected.tester).run("slot-undeclared", ruleOf("slot-undeclared"), {
            valid: [at(rejected, OWNED)],
            invalid: [{ ...at(rejected, shared), errors: [finding("HFS_SLOT_NOT_ENABLED", `${shared} belongs to repo.packages, an opt-in slot hfs.json neither lists in optionalSlots nor implies through an app kind`)] }],
        })
        const accepted = fe({ edition, files: { [shared]: EXPORT, [OWNED]: EXPORT }, declaration: { optionalSlots: ["repo.packages"] } })
        t.after(accepted.cleanup)
        canonTester(accepted.tester).run("slot-undeclared", ruleOf("slot-undeclared"), {
            valid: [at(accepted, shared)],
            invalid: [],
        })
    })

    test(`${edition}: a TypeScript file of a front end that two slots own equally is HFS_SLOT_AMBIGUOUS, the shipped manifest does not own it at all`, (t) => {
        const twin = "apps/web/src/twin/one/a.ts"
        const gap = fe({ edition, files: { [twin]: EXPORT, [OWNED]: EXPORT }, manifestText: twinManifest() })
        t.after(gap.cleanup)
        canonTester(gap.tester).run("slot-undeclared", ruleOf("slot-undeclared"), {
            valid: [at(gap, OWNED)],
            invalid: [{ ...at(gap, twin), errors: [finding("HFS_SLOT_AMBIGUOUS", `${twin} is owned equally by fe.twin.left, fe.twin.right`)] }],
        })
        const shipped = fe({ edition, files: { [twin]: EXPORT, [OWNED]: EXPORT } })
        t.after(shipped.cleanup)
        canonTester(shipped.tester).run("slot-undeclared", ruleOf("slot-undeclared"), {
            valid: [at(shipped, OWNED)],
            invalid: [{ ...at(shipped, twin), errors: [finding("HFS_SLOT_UNDECLARED", `${twin} matches no slot; nearest slot fe.hooks.zustand (apps/<app>/src/hooks/zustand/<store>/), matched apps/web/src then expected hooks`)] }],
        })
    })
}
