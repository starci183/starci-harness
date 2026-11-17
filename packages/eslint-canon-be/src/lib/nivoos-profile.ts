/**
 * The SDK authoring lint profile: what the canon judges differently in a nivoos package, a business package authored with the nivoos SDK (agents, workflows,
 * cells, steps, brain, accounts, seed). The project declares the package in `hfs.json` `sides.nivoos.packages`; its folder is then the slot `app.nivoos-package`,
 * and the slot's `lintProfile: nivoos` is what puts its source under this profile: the profile is applied by the slot, never by a disable in the file.
 *
 * The profile keeps the whole canon and relaxes exactly what an SDK package cannot satisfy, each for a reason the real findings of a package showed (the
 * `nivo-web` package: 508 findings, of which these relaxations account for 412 and 96 are source to fix). Two rules narrow inside their own file
 * (`no-non-ascii-source` for string literals, `no-default-export` for the package entry); the rest is a rule the profile does not enable, in `NIVOOS_RELAXED`.
 */
import { normalizePath } from "./path.ts"
import type { HfsView } from "./hfs-view.ts"
import type { Context } from "./rule.ts"
import { hfsOf } from "./hfs.ts"

/** The slot of a declared nivoos package folder. */
export const NIVOOS_SLOT = "app.nivoos-package"
/** The profile name the slot's `lintProfile` carries. */
export const NIVOOS_PROFILE = "nivoos"

/**
 * Whether `filename` is source of a declared nivoos package: the slot owns it and hands it the SDK authoring profile.
 *
 * @param hfs - The HFS view of the root packages.
 * @param filename - The linted file.
 * @returns True when the profile applies.
 */
export const isNivoosAuthored = (hfs: HfsView, filename: string): boolean => hfs.slotOf(filename) === NIVOOS_SLOT && hfs.slot(NIVOOS_SLOT)?.lintProfile === NIVOOS_PROFILE

/**
 * The same question from inside a rule: is the file being linted source of a declared nivoos package.
 *
 * @param context - The rule context.
 * @returns True when the profile applies.
 */
export const nivoosAuthored = (context: Context): boolean => isNivoosAuthored(hfsOf(context), context.filename)

/**
 * The package entry the SDK loads by its default export: `packages/<name>/src/<name>.package.ts` (`export default { package, cells, workspaces } satisfies Package`).
 *
 * @param filename - The linted file.
 * @returns True for an entry file.
 */
export const isNivoosEntry = (filename: string): boolean => /\/packages\/[^/]+\/src\/[^/]+\.package\.ts$/.test(`/${normalizePath(filename).replace(/^\//, "")}`)

/**
 * The rules a nivoos package is not judged by, each with the reason. A rule is dropped for the slot's files only (the same rule stays on everywhere else), and the
 * reason is the finding: what the real package showed and why the rule's own purpose does not hold for SDK code.
 */
export const NIVOOS_RELAXED: Readonly<Record<string, string>> = Object.freeze({
    "starci-be/explicit-export-surface":
        "Its purpose is that importers read a file's declared types without inferring them and are not re-linted when it changes. Nothing imports a business package's source: the nivoos CLI loads the entry and writes the seed document, and the SDK's own interfaces (Node, NodeIf, NodeRun, Workspace, Package) type every member. The SDK idioms it refuses cannot be annotated at all: `export class X extends NodeRun(Cell)<typeof State>` (an extends clause with a call), an exported `z.strictObject(...)` schema the next line's `typeof` reads, `export default {...} satisfies Package`. 186 of 508 findings.",
    "starci-be/require-public-member-jsdoc":
        "The public members of a cell, step, agent or workspace class are the fields of the SDK interface it implements (key, version, title, input, output, reads, mutation, run, when, yes, no, next, into, label): the SDK documents them, and the class JSDoc (`require-export-jsdoc`, kept) says what this node is for. A sentence on each restates the interface. 152 of 508 findings.",
    "starci-be/job-shape":
        "The canon's `<step>.step.ts` is the jobs capability's file kind (`features/jobs/<job>/steps/`); the SDK's `.step.ts` is a workflow step (NodeRun, NodeIf) of the same suffix, and an SDK package has no jobs capability. 17 of 508 findings, all false positives of the shared suffix.",
    "starci-be/throw-domain-error":
        "The failure contract of an SDK node is a thrown Error whose message starts with a snake_case code (`front_door_cannot_answer: ...`) that the platform records on the run; `DomainError` of @starci/common is not a dependency of an SDK package, which authors against the SDK alone. 10 of 508 findings.",
})

/**
 * The rule levels of a nivoos package: the recommendation less the relaxed rules.
 *
 * @param recommended - The canon levels of the root packages.
 * @returns The same levels without the rules of `NIVOOS_RELAXED`.
 */
export const withoutRelaxed = <Level>(recommended: Readonly<Record<string, Level>>): Record<string, Level> =>
    Object.fromEntries(Object.entries(recommended).filter(([name]) => !(name in NIVOOS_RELAXED)))
