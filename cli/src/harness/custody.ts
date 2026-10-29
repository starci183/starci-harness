import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import type * as ts from "typescript"
import { Refusal } from "../shared/errors.js"
import { evidenceTail } from "../shared/output.js"
import { VERIFY_INFRA } from "./clean-verify.js"
import { inTransaction } from "./ledger.js"
import { loadTypeScript } from "./shapes-parse.js"
import { recordEvent, setStatus } from "./tasks.js"
import type { TaskStatus } from "./tasks.js"
import { openTicket } from "./tickets.js"
import { projectOf } from "./work.js"

/**
 * Custody into a live suite: when a task's own spec is an opt-in live suite (`useSandbox`, harness/coverage-scope.ts) whose world
 * declares the keys it needs (`keys: ["OPENROUTER_API_KEY"]`, or a `const` holding them), the harness reads those keys from the
 * app's custody, the sealed members of `.starcistacks/<env>/secrets`, with the same @starci/hfs code `starci app secret
 * materialize` decrypts with, and hands them to that one test run's child environment: a command check's run, or a worker's own
 * through `starci test live` (core/test/live.ts); a worker's report of a run custody stopped is judged by the harness's own run
 * (CUSTODY_RECHECK). Never a file, an argument, a log line or
 * evidence: the run's output has every handed value scrubbed. A key the suite needs that no member of the environment holds (or
 * holds empty or blank) is CUSTODY_KEY_MISSING, an owner-gated block that spends no try (core/task/verify.ts, harness/wave.ts),
 * whether its declaration names it before the run or the run reports it as not declared; a declaration the harness cannot read
 * is CUSTODY_KEYS_UNRESOLVED, the same block filed as the harness's defect; a run that still reports a key custody holds as not
 * declared is the harness's failure too, VERIFY_INFRA with no verdict.
 */

/** A key a live suite needs that no sealed member of the environment holds, or holds empty or blank: the owner seals it, the verify spends no try meanwhile. */
export const CUSTODY_KEY_MISSING = "CUSTODY_KEY_MISSING"

/** The environment's custody holds the key but cannot be opened here (no age identity, sops refused): the owner's to fix too. */
export const CUSTODY_UNREADABLE = "CUSTODY_UNREADABLE"

/** A live spec's `useSandbox` declares keys the harness cannot reduce to string literals: the suite is not run blind, the harness is fixed. */
export const CUSTODY_KEYS_UNRESOLVED = "CUSTODY_KEYS_UNRESOLVED"

/** The code of the one harness-defect ticket a run reporting a key custody holds as not declared opens; every repeat lands on it. */
export const CUSTODY_KEY_NOT_HANDED = "CUSTODY_KEY_NOT_HANDED"

/** The refusals that end a verify awaiting the owner instead of red. */
export const CUSTODY_CODES: ReadonlySet<string> = new Set([CUSTODY_KEY_MISSING, CUSTODY_UNREADABLE, CUSTODY_KEYS_UNRESOLVED])

/** The module a custody block the harness owns is filed against (its ticket's fingerprint, harness/tickets.ts). */
const CUSTODY_MODULE = "cli/src/harness/custody.ts"

/** The environment a test world boots from (`@starci/test-world`'s default stack, `.starcistacks/dev`), whose custody a live suite reads first. */
export const TEST_ENVIRONMENT = "dev"

/** The TypeScript compiler module, loaded at run time from the app or the CLI's own install. */
type TypeScript = typeof ts

/** The function a live spec's world is declared by; only its option objects' `keys` are custody names. */
const SANDBOX_CALL = "useSandbox"

/** How many identifiers and relative imports a `keys` declaration may go through before the reader gives up on it. */
const MAX_HOPS = 8

/** One source file parsed, and the path it was read from. */
interface Parsed {
    readonly ts: TypeScript
    readonly file: string
    readonly source: ts.SourceFile
}

/** A `const` initializer and the file it sits in. */
interface Bound {
    readonly at: Parsed
    readonly init: ts.Expression
}

const parse = (compiler: TypeScript, file: string): Parsed | undefined => {
    try {
        return { ts: compiler, file, source: compiler.createSourceFile(file, readFileSync(file, "utf8"), compiler.ScriptTarget.Latest, true, compiler.ScriptKind.TS) }
    } catch {
        return undefined
    }
}

/** An expression with its type-only wrappers taken off (`as const`, `satisfies`, `<T>`, `!`, parentheses). */
const bare = (compiler: TypeScript, node: ts.Expression): ts.Expression =>
    compiler.isAsExpression(node) || compiler.isSatisfiesExpression(node) || compiler.isTypeAssertionExpression(node) || compiler.isNonNullExpression(node) || compiler.isParenthesizedExpression(node)
        ? bare(compiler, node.expression)
        : node

/** The module file a relative import names (`./keys`, `./keys.js`, `./keys/index.ts`), or undefined. */
const moduleFile = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith(".")) return undefined
    const base = resolve(dirname(from), specifier)
    const stem = base.replace(/\.[cm]?js$/, "")
    return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, join(base, "index.ts")].find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

/** The initializer of the top-level `const <name>` of a file (an exported one when `exported`). */
const constOf = (at: Parsed, name: string, exported: boolean): Bound | undefined => {
    const compiler = at.ts
    for (const statement of at.source.statements) {
        if (!compiler.isVariableStatement(statement) || statement.declarationList.getFirstToken(at.source)?.kind !== compiler.SyntaxKind.ConstKeyword) continue
        if (exported && !(statement.modifiers ?? []).some((modifier) => modifier.kind === compiler.SyntaxKind.ExportKeyword)) continue
        for (const declaration of statement.declarationList.declarations) {
            if (compiler.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer !== undefined) return { at, init: declaration.initializer }
        }
    }
    return undefined
}

/**
 * What an identifier of a file stands for: its own top-level `const`, else the exported `const` of the relative module a named
 * import brings it from (`import { KEYS as CUSTODY_KEYS } from "./keys"`). Undefined for anything else.
 */
const boundTo = (at: Parsed, name: string): Bound | undefined => {
    const own = constOf(at, name, false)
    if (own !== undefined) return own
    const compiler = at.ts
    for (const statement of at.source.statements) {
        if (!compiler.isImportDeclaration(statement) || !compiler.isStringLiteral(statement.moduleSpecifier)) continue
        const bindings = statement.importClause?.namedBindings
        if (bindings === undefined || !compiler.isNamedImports(bindings)) continue
        const element = bindings.elements.find((each) => each.name.text === name)
        if (element === undefined) continue
        const file = moduleFile(at.file, statement.moduleSpecifier.text)
        const other = file === undefined ? undefined : parse(compiler, file)
        return other === undefined ? undefined : constOf(other, (element.propertyName ?? element.name).text, true)
    }
    return undefined
}

/**
 * The custody key names a `keys` value reduces to: a string literal, an array of them, an identifier bound to one, a spread of
 * one. An object element (`{ alias, resolve }`, a pool key the spec resolves itself) is no custody name and is passed over.
 * Undefined when the value is anything else, so the caller knows the declaration could not be read.
 */
const keyNames = (at: Parsed, value: ts.Expression, hops: number): string[] | undefined => {
    const compiler = at.ts
    const node = bare(compiler, value)
    if (compiler.isStringLiteral(node) || compiler.isNoSubstitutionTemplateLiteral(node)) return [node.text]
    if (compiler.isIdentifier(node)) {
        const bound = hops < MAX_HOPS ? boundTo(at, node.text) : undefined
        return bound === undefined ? undefined : keyNames(bound.at, bound.init, hops + 1)
    }
    if (!compiler.isArrayLiteralExpression(node)) return undefined
    const names: string[] = []
    for (const element of node.elements) {
        if (compiler.isObjectLiteralExpression(bare(compiler, element))) continue
        const read = keyNames(at, compiler.isSpreadElement(element) ? element.expression : element, hops)
        if (read === undefined) return undefined
        names.push(...read)
    }
    return names
}

/** The option object a `useSandbox(...)` call is given: the literal itself, or the `const` an identifier names. */
const optionsOf = (at: Parsed, argument: ts.Expression | undefined, hops: number): { readonly at: Parsed; readonly object: ts.ObjectLiteralExpression } | undefined => {
    const compiler = at.ts
    if (argument === undefined) return undefined
    const node = bare(compiler, argument)
    if (compiler.isObjectLiteralExpression(node)) return { at, object: node }
    const bound = compiler.isIdentifier(node) && hops < MAX_HOPS ? boundTo(at, node.text) : undefined
    return bound === undefined ? undefined : optionsOf(bound.at, bound.init, hops + 1)
}

/** The custody keys one `useSandbox` call declares, or undefined when its declaration cannot be reduced to string literals. */
const callKeys = (at: Parsed, call: ts.CallExpression): string[] | undefined => {
    const compiler = at.ts
    const options = optionsOf(at, call.arguments[0], 0)
    if (options === undefined) return undefined
    const keys = options.object.properties.find((property) => property.name !== undefined && (compiler.isIdentifier(property.name) || compiler.isStringLiteral(property.name)) && property.name.text === "keys")
    // No `keys` of its own: none, unless a spread may bring some in.
    if (keys === undefined) return options.object.properties.some((property) => compiler.isSpreadAssignment(property)) ? undefined : []
    if (compiler.isPropertyAssignment(keys)) return keyNames(options.at, keys.initializer, 0)
    if (compiler.isShorthandPropertyAssignment(keys)) return keyNames(options.at, keys.name, 0)
    return undefined
}

const isSandboxCall = (compiler: TypeScript, node: ts.Node): node is ts.CallExpression =>
    compiler.isCallExpression(node) &&
    ((compiler.isIdentifier(node.expression) && node.expression.text === SANDBOX_CALL) || (compiler.isPropertyAccessExpression(node.expression) && node.expression.name.text === SANDBOX_CALL))

/** What the live specs' worlds declare: the custody key names, sorted and once each, and each `useSandbox` call (`spec:line`) whose keys could not be read. */
export interface DeclaredKeys {
    readonly keys: readonly string[]
    readonly unresolved: readonly string[]
}

/**
 * The key names the live specs' worlds declare in their `useSandbox({ keys })` options, read with the TypeScript compiler (the
 * app's own, else the CLI's, harness/shapes-parse.ts `loadTypeScript`): a literal array, a `const` of the spec or of a relative
 * module it imports it from (with `as const`, a type annotation or `ReadonlyArray` alike), a spread of one. A call whose keys
 * reduce to anything but string literals is listed unresolved by `spec:line` (relative to `root`), never guessed at.
 */
export const declaredKeys = (files: readonly string[], root: string): DeclaredKeys => {
    const keys = new Set<string>()
    const unresolved: string[] = []
    for (const file of files) {
        const shown = relative(root, file).replaceAll("\\", "/")
        let text: string
        try {
            text = readFileSync(file, "utf8")
        } catch {
            continue
        }
        if (!text.includes(SANDBOX_CALL)) continue
        let compiler: TypeScript
        try {
            compiler = loadTypeScript(dirname(file))
        } catch {
            unresolved.push(`${shown} (no typescript resolves to read it)`)
            continue
        }
        const at = parse(compiler, file)
        if (at === undefined) continue
        const visit = (node: ts.Node): void => {
            if (isSandboxCall(compiler, node)) {
                const names = callKeys(at, node)
                if (names === undefined) unresolved.push(`${shown}:${String(at.source.getLineAndCharacterOfPosition(node.getStart(at.source)).line + 1)}`)
                else for (const name of names) keys.add(name)
            }
            compiler.forEachChild(node, visit)
        }
        visit(at.source)
    }
    return { keys: [...keys].sort((left, right) => left.localeCompare(right)), unresolved }
}

/**
 * The main checkout of a work tree: an Op worktree or a clean checkout reads the age identity custody opens with (kept in the
 * main checkout's git-ignored `.claude/`) from the repository it was cut from. The sealed members are tracked files, read in
 * the work tree itself (`holdersOf`).
 */
const mainCheckout = (root: string): string => {
    const dotGit = join(root, ".git")
    if (!existsSync(dotGit) || statSync(dotGit).isDirectory()) return root
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim().replaceAll("\\", "/")
    const main = gitdir === undefined ? undefined : /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir)?.[1]
    return main !== undefined && existsSync(main) ? main : root
}

/** The environment whose custody a test run reads: `dev` when it has sealed members, else the one environment that has any. */
const custodyEnvironment = (tree: string): string => {
    const stacks = join(tree, ".starcistacks")
    if (existsSync(join(stacks, TEST_ENVIRONMENT, "secrets")) || !existsSync(stacks)) return TEST_ENVIRONMENT
    const withSecrets = readdirSync(stacks, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(stacks, entry.name, "secrets")))
    return withSecrets.length === 1 && withSecrets[0] !== undefined ? withSecrets[0].name : TEST_ENVIRONMENT
}

/**
 * Where the custody of the work tree a run executes lives, and which sealed member holds each of `keys` (read from the
 * envelopes: names only, nothing decrypted). The members are read in `tree` itself, the checkout of the branch head or
 * candidate the suite runs from, so a member sealed on a workflow's branch and not yet on main is found; `app` is the main
 * checkout whose age identity opens them.
 */
const holdersOf = async (tree: string, keys: readonly string[]): Promise<{ readonly app: string; readonly environment: string; readonly directory: string; readonly holder: ReadonlyMap<string, string> }> => {
    const app = mainCheckout(tree)
    const environment = custodyEnvironment(tree)
    const directory = join(tree, ".starcistacks", environment, "secrets")
    const holder = new Map<string, string>()
    if (!existsSync(directory)) return { app, environment, directory, holder }
    const store = await import("@starci/hfs/runtime/scripts/hfs/secret-store.mjs")
    const document = await import("@starci/hfs/runtime/scripts/hfs/secret-document.mjs")
    for (const name of store.sealedFiles(directory)) {
        let names: readonly string[]
        try {
            names = document.envelopeOf(readFileSync(join(directory, name), "utf8")).keys
        } catch {
            continue
        }
        for (const key of names) if (keys.includes(key) && !holder.has(key)) holder.set(key, name)
    }
    return { app, environment, directory, holder }
}

/** The owner's block on keys custody of `environment` lacks (CUSTODY_KEY_MISSING), naming each one. */
const lacking = (missing: readonly string[], environment: string): Refusal => {
    const them = missing.length === 1 ? "it" : "them"
    return new Refusal(CUSTODY_KEY_MISSING, `custody lacks ${missing.join(", ")} in ${environment}: the live suite needs ${them}, and no sealed member of .starcistacks/${environment}/secrets holds ${them} with a value`)
}

/** The keys handed to one run: the child environment, the values to scrub from its output, and the line the check's detail names. */
export interface Custody {
    readonly env: Readonly<Record<string, string>>
    readonly values: readonly string[]
    readonly detail: string
}

/**
 * The declared keys of the live spec files of the checkout `checkout` a run executes, read from that checkout's custody for one
 * run. A declaration the reader cannot reduce to key names refuses CUSTODY_KEYS_UNRESOLVED before anything runs, naming each
 * `spec:line`. Each key is looked up by name in the sealed members' envelopes, then only the members holding one are decrypted
 * and only the named keys kept. A key no member holds, or one held empty or blank, refuses CUSTODY_KEY_MISSING ("custody lacks
 * OPENROUTER_API_KEY in dev"); a member that cannot be opened refuses CUSTODY_UNREADABLE. Undefined when the specs declare no key.
 */
export const custodyFor = async (liveSpecs: readonly string[], checkout: string): Promise<Custody | undefined> => {
    const declared = declaredKeys(liveSpecs, checkout)
    if (declared.unresolved.length > 0) {
        throw new Refusal(
            CUSTODY_KEYS_UNRESOLVED,
            `the harness cannot read which custody keys useSandbox declares at ${declared.unresolved.join(", ")} (only string literals, a const of them in the spec or a relative module it imports, are read): the live suite is not run without them, and this is the harness's defect, not the task's`,
        )
    }
    const keys = declared.keys
    if (keys.length === 0) return undefined
    const { app, environment, directory, holder } = await holdersOf(checkout, keys)
    const missing = keys.filter((key) => !holder.has(key))
    if (missing.length > 0) throw lacking(missing, environment)
    const store = await import("@starci/hfs/runtime/scripts/hfs/secret-store.mjs")
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
    // A key sealed by name with no value, or only blanks, is no credential: it is the owner's to fill, like one never sealed.
    const empty = keys.filter((key) => (env[key] ?? "").trim() === "")
    if (empty.length > 0) throw lacking(empty, environment)
    const values = Object.values(env)
    const members = [...new Set(holder.values())].map((file) => file.replace(/\.enc$/, "")).join(", ")
    return { env, values, detail: `custody: ${keys.join(", ")} from ${environment}/${members}, handed to this run's environment only` }
}

/** The key names a failed run reports as not declared: every upper-case name on a `TEST_WORLD_NOT_DECLARED` line but the code itself. */
export const undeclaredIn = (output: string): string[] => [
    ...new Set(
        output
            .split("\n")
            .filter((line) => line.includes("TEST_WORLD_NOT_DECLARED"))
            .flatMap((line) => [...line.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)].map((match) => match[0]))
            .filter((name) => !name.startsWith("TEST_WORLD_")),
    ),
]

/**
 * Judges the keys a failed test run (its scrubbed `output`) reports as not declared against the custody of the checkout `tree` it
 * ran from; a run reporting none keeps its own verdict. A run reporting any is never the task's red, since its world never booted. A key custody holds
 * means the harness did not hand over what it had (a declaration it did not read, a spec it did not take for live): it refuses
 * VERIFY_INFRA and opens one harness-defect ticket, deduped by CUSTODY_KEY_NOT_HANDED, and the caller reaches no verdict
 * (core/task/verify.ts returns the task to reported with no try spent; a wave fails and judges no task). Keys custody holds none
 * of refuse CUSTODY_KEY_MISSING naming them, the owner's block as when a declaration names them before the run (`blockOnCustody`).
 */
export const assertKeysHanded = async (output: string, tree: string): Promise<void> => {
    const named = undeclaredIn(output)
    if (named.length === 0) return
    const { environment, holder } = await holdersOf(tree, named)
    if (holder.size === 0) throw lacking([...named].sort((left, right) => left.localeCompare(right)), environment)
    const held = [...holder.keys()].sort((left, right) => left.localeCompare(right))
    const { ticket } = openTicket({
        kind: "harness-defect",
        severity: "blocking",
        title: "a live suite failed TEST_WORLD_NOT_DECLARED for a key the app's custody holds: the harness did not hand it to the run",
        evidence: { tail: evidenceTail(output.split("\n").filter((line) => line.includes("TEST_WORLD_NOT_DECLARED")).join("\n")) },
        tried: "the verify reached no verdict and spent no try; every later step verifies again and goes on once the harness hands the key",
        proposedDefault: null,
        options: [],
        project: await projectOf(tree, false),
        workflow: null,
        by: "verify",
        code: CUSTODY_KEY_NOT_HANDED,
        module: CUSTODY_MODULE,
        waiters: [],
    })
    throw new Refusal(VERIFY_INFRA, `the run reports ${held.join(", ")} as not declared although custody of ${environment} holds ${held.length === 1 ? "it" : "them"} (${held.map((key) => `${key} in ${holder.get(key) ?? ""}`).join(", ")}): the harness did not hand ${held.length === 1 ? "it" : "them"} to the run (${CUSTODY_KEY_NOT_HANDED}: an infrastructure failure, not the task's; harness-defect ticket ${ticket.id})`)
}

/** The event that hands a worker's custody-stopped report to the harness's own run (core/task/result.ts), keyed by the attempt it judges. */
export const CUSTODY_RECHECK = "custody-recheck"

/** What a worker's filed output shows custody stopped: the keys its run reported as not declared, and the custody refusals it met. */
export interface CustodyEvidence {
    readonly keys: readonly string[]
    readonly codes: readonly string[]
}

/**
 * The custody evidence of a worker's filed output (every string in it read as one text): the key names on its
 * `TEST_WORLD_NOT_DECLARED` lines and each custody refusal code it names. Undefined when it shows neither, so its report stands.
 */
export const custodyEvidence = (output: unknown): CustodyEvidence | undefined => {
    const text = JSON.stringify(output).replaceAll("\\n", "\n")
    const codes = [...CUSTODY_CODES, CUSTODY_KEY_NOT_HANDED].filter((code) => text.includes(code))
    return codes.length === 0 && !text.includes("TEST_WORLD_NOT_DECLARED") ? undefined : { keys: undeclaredIn(text), codes }
}

/** Whether the harness took over the judgement of this attempt's report from a custody-stopped worker run (CUSTODY_RECHECK). */
export const isCustodyRecheck = (db: DatabaseSync, taskId: string, attemptId: string): boolean =>
    db.prepare("SELECT 1 FROM events WHERE subject = ? AND kind = ? AND json_extract(data_json, '$.attempt') = ?").get(taskId, CUSTODY_RECHECK, attemptId) !== undefined

/** Text with every handed value replaced by `[redacted:custody]`, so a run that echoes one leaves it in no output or evidence. */
export const scrubbed = (text: string, values: readonly string[]): string => values.reduce((out, value) => (value.length < 4 ? out : out.split(value).join("[redacted:custody]")), text)

/**
 * Ends a task a live suite's custody stopped, not as its red: it goes awaiting_owner from `from` (`verifying` in its own verify,
 * `done` in the wave that runs its deferred tests) with a `verify-stuck` event, which the tick files as a ticket the task waits
 * on: a key to seal (`owner`) is the owner's question on credentials, a declaration the harness cannot read (CUSTODY_KEYS_UNRESOLVED,
 * `module` named) one harness-defect ticket every such task waits on. Its attempt takes no red verdict and no try is spent (an
 * awaiting_owner task is never a failed one a retry counts from). Returns the refusal the caller reports.
 */
export const blockOnCustody = (db: DatabaseSync, taskId: string, from: TaskStatus, error: Refusal): Refusal => {
    const harness = error.code === CUSTODY_KEYS_UNRESOLVED
    inTransaction(db, () => {
        setStatus(db, taskId, "awaiting_owner", from)
        recordEvent(db, "verify-stuck", taskId, { ends: 0, code: error.code, reason: error.message, owner: !harness, ...(harness ? { module: CUSTODY_MODULE } : {}) })
    })
    const next = harness
        ? "once the harness reads the declaration (its harness-defect ticket), retry it"
        : "seal the key (starci app secret set <env> <member> <KEY> --from-host <KEY>), then retry it"
    return new Refusal(error.code, `${error.message}\ntask ${taskId} is awaiting_owner, blocked on custody: no try is spent and its work stays where it is; ${next}`)
}
