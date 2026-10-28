import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { Refusal } from "../shared/errors.js"
import { inTransaction } from "./ledger.js"
import { recordEvent, setStatus } from "./tasks.js"
import type { TaskStatus } from "./tasks.js"

/**
 * Custody into a live suite: when a task's own spec is an opt-in live suite (`useSandbox`, harness/coverage-scope.ts) whose world
 * declares the keys it needs (`keys: ["OPENROUTER_API_KEY"]`), the harness reads those keys from the app's custody, the sealed
 * members of `.starcistacks/<env>/secrets`, with the same @starci/hfs code `starci app secret materialize` decrypts with, and
 * hands them to that one test run's child environment. Never a file, an argument, a log line or evidence: the run's output has
 * every handed value scrubbed. A declared key no member of the environment holds is CUSTODY_KEY_MISSING, an owner-gated block
 * that spends no try (core/task/verify.ts).
 */

/** A declared key no sealed member of the environment holds: the owner seals it, the verify spends no try meanwhile. */
export const CUSTODY_KEY_MISSING = "CUSTODY_KEY_MISSING"

/** The environment's custody holds the key but cannot be opened here (no age identity, sops refused): the owner's to fix too. */
export const CUSTODY_UNREADABLE = "CUSTODY_UNREADABLE"

/** The refusals that end a verify awaiting the owner instead of red. */
export const CUSTODY_CODES: ReadonlySet<string> = new Set([CUSTODY_KEY_MISSING, CUSTODY_UNREADABLE])

/** The environment a test world boots from (`@starci/test-world`'s default stack, `.starcistacks/dev`), whose custody a live suite reads first. */
export const TEST_ENVIRONMENT = "dev"

const KEY_LIST = /\bkeys\s*:\s*\[([^\]]*)\]/g
const KEY_NAME = /["'`]([A-Z][A-Z0-9_]*)["'`]/g

/** The key names the live specs' worlds declare (`useSandbox({ keys: [...] })`), sorted and once each. */
export const declaredKeys = (files: readonly string[]): string[] => {
    const keys = new Set<string>()
    for (const file of files) {
        let text: string
        try {
            text = readFileSync(file, "utf8")
        } catch {
            continue
        }
        for (const list of text.matchAll(KEY_LIST)) for (const name of (list[1] ?? "").matchAll(KEY_NAME)) if (name[1] !== undefined) keys.add(name[1])
    }
    return [...keys].sort((left, right) => left.localeCompare(right))
}

/**
 * The main checkout of a work tree: an Op worktree or a clean checkout reads the app's custody, and its age identity (kept in
 * the main checkout's git-ignored `.claude/`), from the repository it was cut from.
 */
const mainCheckout = (root: string): string => {
    const dotGit = join(root, ".git")
    if (!existsSync(dotGit) || statSync(dotGit).isDirectory()) return root
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim().replaceAll("\\", "/")
    const main = gitdir === undefined ? undefined : /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir)?.[1]
    return main !== undefined && existsSync(main) ? main : root
}

/** The environment whose custody a test run reads: `dev` when it has sealed members, else the one environment that has any. */
const custodyEnvironment = (app: string): string => {
    const stacks = join(app, ".starcistacks")
    if (existsSync(join(stacks, TEST_ENVIRONMENT, "secrets")) || !existsSync(stacks)) return TEST_ENVIRONMENT
    const withSecrets = readdirSync(stacks, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(stacks, entry.name, "secrets")))
    return withSecrets.length === 1 && withSecrets[0] !== undefined ? withSecrets[0].name : TEST_ENVIRONMENT
}

/** The keys handed to one run: the child environment, the values to scrub from its output, and the line the check's detail names. */
export interface Custody {
    readonly env: Readonly<Record<string, string>>
    readonly values: readonly string[]
    readonly detail: string
}

/**
 * The declared keys of the live spec files, read from the app's custody for one run. Each key is looked up by name in the sealed
 * members' envelopes (names only, nothing decrypted), then only the members holding one are decrypted and only the named keys
 * kept. A key no member holds refuses CUSTODY_KEY_MISSING ("custody lacks OPENROUTER_API_KEY in dev"); a member that cannot be
 * opened refuses CUSTODY_UNREADABLE. Undefined when the specs declare no key.
 */
export const custodyFor = async (liveSpecs: readonly string[], root: string): Promise<Custody | undefined> => {
    const keys = declaredKeys(liveSpecs)
    if (keys.length === 0) return undefined
    const app = mainCheckout(root)
    const environment = custodyEnvironment(app)
    const directory = join(app, ".starcistacks", environment, "secrets")
    const store = await import("@starci/hfs/runtime/scripts/hfs/secret-store.mjs")
    const document = await import("@starci/hfs/runtime/scripts/hfs/secret-document.mjs")
    const holder = new Map<string, string>()
    for (const name of store.sealedFiles(directory)) {
        let names: readonly string[]
        try {
            names = document.envelopeOf(readFileSync(join(directory, name), "utf8")).keys
        } catch {
            continue
        }
        for (const key of names) if (keys.includes(key) && !holder.has(key)) holder.set(key, name)
    }
    const missing = keys.filter((key) => !holder.has(key))
    if (missing.length > 0) throw new Refusal(CUSTODY_KEY_MISSING, `custody lacks ${missing.join(", ")} in ${environment}: the live suite declares ${missing.length === 1 ? "it" : "them"}, and no sealed member of .starcistacks/${environment}/secrets holds ${missing.length === 1 ? "it" : "them"}`)
    const { defaultSops } = await import("@starci/hfs/runtime/scripts/hfs/secret-sops.mjs")
    const env: Record<string, string> = {}
    for (const member of new Set(holder.values())) {
        let map: Readonly<Record<string, string>>
        try {
            map = store.readMap(join(directory, member), defaultSops(process.env, app))
        } catch (error: unknown) {
            // The message of a sops or identity failure names the file and the cause, never a value.
            throw new Refusal(CUSTODY_UNREADABLE, `custody of ${environment} holds ${[...holder].filter(([, file]) => file === member).map(([key]) => key).join(", ")} in ${member} but it cannot be opened here: ${error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : "sops refused"}`)
        }
        for (const [key, file] of holder) if (file === member && typeof map[key] === "string") env[key] = map[key]
    }
    const values = Object.values(env).filter((value) => value !== "")
    const members = [...new Set(holder.values())].map((file) => file.replace(/\.enc$/, "")).join(", ")
    return { env, values, detail: `custody: ${keys.join(", ")} from ${environment}/${members}, handed to this run's environment only` }
}

/** Text with every handed value replaced by `[redacted:custody]`, so a run that echoes one leaves it in no output or evidence. */
export const scrubbed = (text: string, values: readonly string[]): string => values.reduce((out, value) => (value.length < 4 ? out : out.split(value).join("[redacted:custody]")), text)

/**
 * Ends a task a live suite's custody stopped as the owner's block, not its red: it goes awaiting_owner from `from` (`verifying` in
 * its own verify, `done` in the wave that runs its deferred tests) with a `verify-stuck` event marked `owner`, which the tick files
 * as the owner's question on credentials; its attempt takes no red verdict and no try is spent (an awaiting_owner task is never
 * a failed one a retry counts from). Returns the refusal the caller reports.
 */
export const blockOnCustody = (db: DatabaseSync, taskId: string, from: TaskStatus, error: Refusal): Refusal => {
    inTransaction(db, () => {
        setStatus(db, taskId, "awaiting_owner", from)
        recordEvent(db, "verify-stuck", taskId, { ends: 0, code: error.code, reason: error.message, owner: true })
    })
    return new Refusal(error.code, `${error.message}\ntask ${taskId} is awaiting_owner, blocked on custody: no try is spent and its work stays where it is; seal the key (starci app secret set <env> <member> <KEY> --from-host <KEY>), then retry it`)
}
