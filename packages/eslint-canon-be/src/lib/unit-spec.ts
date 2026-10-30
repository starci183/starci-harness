/**
 * What is a unit spec, decided by the slot manifest and the file's role suffix, never by a path pattern.
 *
 * A unit spec is a `*.spec.ts` outside the folders that own the other test kinds (`src/tests/{e2e,integration,contract,world}`)
 * only. Only a `<name>.<role>.spec.ts` beside `<name>.<role>.ts` is a legitimate unit spec (R47): of a spec-required unit role
 * (`ruleParams.be.unitRoles`: a service, a cli command) anywhere its slot admits, and of any other LOGIC role (`ruleParams.be.logicRoles`: a policy,
 * a client, a guard, a mapper, ...) inside a slot whose `coverage` is required, where the spec is optional (the file owes 100 per file, not a spec of
 * its own), and so is `<file>.spec.ts` beside a logic file its slot declares (`logic`), measured like a logic role. So is the spec of a door of a
 * feature kind that has no service of its own
 * (`<provider>.webhook.spec.ts`, `<channel>.gateway.spec.ts`, `<channel>.subscription.spec.ts` beside its door, in the kind's slot);
 * the quality rules of R48 judge the service specs.
 */
import { basename } from "node:path"
import type { HfsClassification, HfsUnitRole, HfsView } from "./hfs.ts"

/** A unit-tested role, or an optional logic role whose spec the coverage slot asks for. */
export interface SpecRole {
    readonly role: string
    readonly spec: string
    readonly slot?: string
    readonly exempt?: readonly string[]
    readonly optional?: boolean
}

/** The slots whose `*.spec.ts` files are not unit specs: the other test kinds and world infrastructure. */
const OTHER_KIND_SLOTS = new Set(["be.tests.e2e", "be.tests.integration", "be.tests.contract", "be.tests.world", "be.tests.world.kit"])

/** The file name of a linted path. */
export const baseOf = (filename: string): string => basename(String(filename || "").replace(/\\/g, "/"))

/**
 * Whether a file is a unit spec.
 *
 * @param {object} hfs - The HFS view.
 * @param {string} filename - The linted file.
 * @returns {boolean} True for a `*.spec.ts` that is not a spec of another test kind.
 */
export const isUnitSpecFile = (hfs: HfsView, filename: string): boolean => {
    if (!/\.spec\.[cm]?ts$/.test(baseOf(filename))) return false
    const found = hfs.classify(filename)
    return !OTHER_KIND_SLOTS.has(found.slot ?? "") && !OTHER_KIND_SLOTS.has(found.nearest?.slot ?? "")
}

/** Whether a file is a `<name>.service.spec.ts` unit spec. */
export const isServiceSpecFile = (hfs: HfsView, filename: string): boolean => /\.service\.spec\.ts$/.test(baseOf(filename)) && isUnitSpecFile(hfs, filename)

/**
 * The unit-tested roles of the back end: `ruleParams.be.unitRoles` of the slot manifest, the ONE list (`[{ role, spec, slot? }]`).
 *
 * @param {object} hfs - The HFS view.
 * @returns {ReadonlyArray<{ role: string, spec: string, slot?: string }>} The roles.
 */
export const unitRoles = (hfs: HfsView): readonly HfsUnitRole[] => hfs.ruleParams.unitRoles ?? []

/** Whether the slot that owns a file is measured at 100 per file (`coverage: required`): the home of the optional specs of the logic roles. */
const inCoverageSlot = (hfs: HfsView, filename: string): boolean => {
    const slot = hfs.slotOf(filename)
    return slot !== null && hfs.slot(slot)?.coverage === "required"
}

/** The roles whose spec is legal but not required: every logic role that is not a spec-required unit role. */
const optionalRoles = (hfs: HfsView): SpecRole[] => (hfs.ruleParams.logicRoles ?? []).filter((role) => !unitRoles(hfs).some((unit) => unit.role === role)).map((role) => ({ role, spec: `${role}.spec`, optional: true }))

/** Whether a role admits a file by its slot (a role with no slot admits any slot; an optional logic role only a coverage-required slot). */
const inRoleSlot = (hfs: HfsView, role: SpecRole, filename: string): boolean => (role.optional === true ? inCoverageSlot(hfs, filename) : role.slot === undefined || hfs.slotOf(filename) === role.slot)

/** The path of a classified file below the instance root of its slot. */
const slotRelative = (found: HfsClassification): string => (found.root !== undefined && found.path.startsWith(`${found.root}/`) ? found.path.slice(found.root.length + 1) : baseOf(found.path))

/**
 * The optional spec role of a spec beside a logic file its slot declares (`logic`): `passport.tokens.spec.ts` beside the declared
 * `passport.tokens.ts` gives `{ role: "tokens", spec: "tokens.spec" }`, so the subject resolves as a logic role's does. It holds for that
 * one declared file only, never for another `*.tokens.ts`, and adds no role name to the manifest.
 */
const declaredLogicRole = (hfs: HfsView, filename: string): SpecRole | null => {
    const found = hfs.classify(filename)
    const logic = found.slot === undefined ? undefined : hfs.slot(found.slot)?.logic
    const subject = slotRelative(found).replace(/\.spec\.ts$/, ".ts")
    if (logic?.includes(subject) !== true) return null
    const role = subject.slice(0, -".ts".length).split(".").pop() ?? ""
    return { role, spec: `${role}.spec`, optional: true }
}

/**
 * The unit-tested role whose spec a file is (`<name>.<role>.spec.ts`, in the role's slot, or the spec beside a declared logic file), or null.
 *
 * @param {object} hfs - The HFS view.
 * @param {string} filename - The linted file.
 * @returns {object | null} The role entry.
 */
export const unitRoleOfSpec = (hfs: HfsView, filename: string): SpecRole | null => {
    if (!isUnitSpecFile(hfs, filename)) return null
    const name = baseOf(filename)
    return [...unitRoles(hfs), ...optionalRoles(hfs)].find((role: SpecRole) => name.endsWith(`.${role.spec}.ts`) && inRoleSlot(hfs, role, filename)) ?? declaredLogicRole(hfs, filename)
}

/** Whether a file is the spec of a value role (`ruleParams.be.valueRoles`: a zod schema): its subject is a declared value, so the spec parses it and builds no testing module. */
export const isValueRoleSpec = (hfs: HfsView, filename: string): boolean => {
    const role = unitRoleOfSpec(hfs, filename)?.role
    return role !== undefined && (hfs.ruleParams.valueRoles ?? []).includes(role)
}

/**
 * The unit-tested role whose subject a file is (`<name>.<role>.ts`, in the role's slot, outside the test tree), or null.
 *
 * @param {object} hfs - The HFS view.
 * @param {string} filename - The linted file.
 * @returns {object | null} The role entry.
 */
export const unitRoleOfSubject = (hfs: HfsView, filename: string): HfsUnitRole | null => {
    const name = baseOf(filename)
    const slot = hfs.slotOf(filename)
    if (!slot || slot.startsWith("be.tests.")) return null
    return unitRoles(hfs).find((role) => name.endsWith(`.${role.role}.ts`) && !name.endsWith(`.${role.spec}.ts`) && inRoleSlot(hfs, role, filename)) ?? null
}

/** The slots of the feature kinds whose door carries its own unit spec beside it. */
const DOOR_SPEC_SLOTS = new Set(["be.feature.webhooks.http", "be.feature.realtime.graphql", "be.feature.realtime.websocket", "be.feature.realtime.sse"])

/** The door a `<name>.<role>.spec.ts` of a feature kind tests, or null: `payment.webhook.spec.ts` gives `payment.webhook.ts`. */
export const doorOfSpec = (hfs: HfsView, filename: string): string | null => {
    if (!isUnitSpecFile(hfs, filename) || !DOOR_SPEC_SLOTS.has(hfs.slotOf(filename) ?? "")) return null
    const match = /^(.+.(?:webhook|gateway|subscription|controller)).spec.ts$/.exec(baseOf(filename))
    return match ? `${match[1]}.ts` : null
}
