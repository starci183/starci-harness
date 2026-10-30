/**
 * The file-system recorder behind the `crossFileInputs` audit (contexts/project/check-cache.md, ESLint, kind 3).
 *
 * A canon declares in `crossFileInputs` every file its rules read that ESLint's import graph does not carry. This module proves the list
 * complete: it is preloaded into every spec process of a canon (`node --import ./fixtures/fs-audit-preload.ts --test ...`), patches
 * `RuleTester.prototype.run` so each rule of the canon runs under a recorder, and fails the spec that ran a rule when the rule read, with
 * `node:fs`, a file that is none of
 *
 * - the linted file itself, a package manifest, a tsconfig or `hfs.json` (the fingerprint holds those), an installed package or a TypeScript lib;
 * - a file the linted file reaches through imports (the import graph carries it);
 * - a file a declaration of `crossFileInputs` names for this rule and this linted file, read the way the declaration's kind allows.
 *
 * Reads through TypeScript's own `ts.sys` are module resolution, which the import graph covers by definition; the static half of the audit
 * (cross-file-inputs.spec.ts) names every source file that uses them. A rule that is not in the canon's `rules` is not audited.
 */
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type TypeScript from "typescript"

/** One declaration, as the audit reads it (the shape of every canon's `CrossFileInput`). */
export interface AuditInput {
    readonly rule: string
    readonly kind: "content" | "exists" | "git"
    readonly relativeTo: "file" | "side"
    readonly globs: readonly string[]
    readonly appliesTo: readonly string[]
}

/** What a canon hands the audit. `RuleTester` and `ts` are the canon's own instances (the ones its rules and specs load). */
export interface AuditedCanon {
    readonly name: string
    readonly rules: Readonly<Record<string, unknown>>
    readonly inputs: readonly AuditInput[]
    /** Rules whose reads the cache covers another way: the project-graph rules, whose whole-side inputs are compared as graph findings. */
    readonly exempt?: readonly string[]
    /** The import alias of an app (`@/x` is `<app>/src/x`): its tsconfig maps it in a real app, a fixture's does not. Answers the base path of a specifier, or null. */
    readonly alias?: (specifier: string, file: string) => string | null
    readonly packageRoot: string
    readonly RuleTester: RuleTesterClass | readonly RuleTesterClass[]
    readonly ts: typeof TypeScript | readonly (typeof TypeScript)[]
}

/** ESLint's RuleTester as far as the audit needs it. A package may load more than one copy of ESLint; each copy is passed. */
export interface RuleTesterClass { prototype: { run: (this: unknown, name: string, rule: unknown, tests: unknown) => void } }

const listed = <T>(value: T | readonly T[]): readonly T[] => (Array.isArray(value) ? value : [value as T])

type Op = "read" | "exists" | "list"
interface Read { readonly op: Op; readonly target: string }
/** The rule being evaluated and the file it is linting, while a rule callback runs. */
interface Scope { readonly rule: string; readonly file: string; readonly root: string; readonly text: string; readonly reads: Read[] }

const posix = (value: string): string => value.replace(/\\/g, "/")
const fold = (value: string): string => (process.platform === "win32" ? posix(value).toLowerCase() : posix(value))

/** `value` as a posix glob over absolute paths: `**` spans folders, `*` and `?` stay inside one segment. */
const globExpression = (glob: string): RegExp => {
    let source = ""
    for (let i = 0; i < glob.length; i += 1) {
        const c = glob.charAt(i)
        if (c === "*" && glob[i + 1] === "*") {
            i += 1
            if (glob[i + 1] === "/") { i += 1; source += "(?:.*/)?" } else source += ".*"
        } else if (c === "*") source += "[^/]*"
        else if (c === "?") source += "[^/]"
        else source += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
    }
    return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "")
}

const braces = (glob: string): string[] => {
    const match = /\{([^{}]+)\}/.exec(glob)
    return match ? (match[1] as string).split(",").flatMap((part) => braces(`${glob.slice(0, match.index)}${part}${glob.slice(match.index + match[0].length)}`)) : [glob]
}

const expressionsOf = (base: string, globs: readonly string[]): RegExp[] =>
    globs.flatMap((glob) => braces(glob)).map((glob) => globExpression(posix(path.resolve(base, glob))))

/** Whether listing `directory` can be part of finding a match of one of `globs` (resolved against `base`): the directory lies on the way to one. */
const onTheWayTo = (base: string, globs: readonly string[], directory: string): boolean => {
    const folders = posix(path.resolve(directory)).split("/").filter(Boolean)
    return globs.flatMap((glob) => braces(glob)).some((glob) => {
        const segments = posix(path.resolve(base, glob)).split("/").filter(Boolean)
        for (let at = 0; at < folders.length; at += 1) {
            const segment = segments[at]
            if (segment === undefined) return false
            if (segment === "**") return true
            if (!globExpression(segment).test(folders[at] as string)) return false
        }
        return segments.length > folders.length
    })
}

/** Paths no declaration is needed for: the fingerprint's files, installed packages, the compiler's libraries, this canon's own shipped files. */
const exempt = (target: string, packageRoot: string): boolean => {
    const name = path.basename(target)
    // a path with a quote in it names no file (a rule that built it from source text could never find one)
    if (target.includes('"')) return true
    if (/[\\/]node_modules[\\/]/.test(target) || /^lib\..*\.d\.ts$/.test(name)) return true
    if (name === "package.json" || name === "hfs.json" || /^tsconfig.*\.json$/.test(name)) return true
    // the catalogs a canon ships in its runtime/ (its own version fixes them; a sibling canon's too)
    if (/[\\/]runtime[\\/](?:knowledge|modules)[\\/]/.test(target)) return true
    const inside = (folder: string): boolean => fold(target).startsWith(`${fold(path.join(packageRoot, folder))}/`)
    return inside("runtime") || inside("dist") || (inside("src") && !/\.spec\.ts$/.test(name))
}

/**
 * The local files `file` reaches through imports (static, type-only, dynamic, re-exports, `require`, triple-slash), resolved under the nearest
 * tsconfig the way the cache's import graph resolves them. An independent implementation on purpose: the audit must not share a bug with the
 * graph it checks.
 */
const closureOf = (ts: typeof TypeScript, file: string, text: string, alias?: AuditedCanon["alias"]): Set<string> => {
    const configPath = ts.findConfigFile(path.dirname(file), ts.sys.fileExists)
    const options: TypeScript.CompilerOptions = configPath
        ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config ?? {}, ts.sys, path.dirname(configPath)).options
        : { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }
    const reached = new Set<string>()
    // every path the resolver probes for an import is part of the import graph: adding the file it looks for re-resolves the importer
    const probing: TypeScript.ModuleResolutionHost = {
        ...ts.sys,
        trace: (message) => {
            const probed = /^(?:File|Directory) '(.+?)' (?:does not exist|exist)|candidate module location '(.+?)'/.exec(message)
            const named = probed?.[1] ?? probed?.[2]
            if (named === undefined) return
            // the module path itself and its directory are probed by rules that follow an import by hand, as they are by the resolver
            const stem = fold(named).replace(/\.d\.[cm]?ts$|\.[cm]?[jt]sx?$|\.json$/, "")
            const module = stem.replace(/\/index$/, "")
            for (const key of [fold(named), stem, module, `${module}.ts`, `${module}.tsx`, `${module}/index.ts`, `${module}/index.tsx`]) reached.add(key)
        },
    }
    const queue: [string, string | null][] = [[file, text]]
    const queued = new Set<string>([fold(file)])
    while (queue.length > 0) {
        const [current, known] = queue.pop() as [string, string | null]
        const body = known ?? ts.sys.readFile(current)
        if (body === undefined) continue
        const info = ts.preProcessFile(body, true, true)
        const names = [...info.importedFiles.map((entry) => entry.fileName), ...info.typeReferenceDirectives.map((entry) => entry.fileName)]
        // what the preprocessor misses and the compiler's program does not: a dynamic import of a plain template literal, an import type
        const visit = (node: TypeScript.Node): void => {
            const isImportCall = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
            const argument = ts.isCallExpression(node) ? node.arguments[0] : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined
            if ((isImportCall || ts.isImportTypeNode(node)) && argument !== undefined && ts.isStringLiteralLike(argument)) names.push(argument.text)
            ts.forEachChild(node, visit)
        }
        visit(ts.createSourceFile(current, body, ts.ScriptTarget.Latest, false))
        const targets = names.map((name) => ts.resolveModuleName(name, current, { ...options, traceResolution: true }, probing).resolvedModule?.resolvedFileName)
            .concat(info.referencedFiles.map((entry) => path.resolve(path.dirname(current), entry.fileName)))
        for (const name of names) {
            const base = alias?.(name, current)
            if (base === null || base === undefined) continue
            for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
                reached.add(fold(candidate))
                if (ts.sys.fileExists(candidate)) targets.push(candidate)
            }
        }
        for (const target of targets) {
            if (target === undefined) continue
            const key = fold(target)
            if (queued.has(key)) continue
            queued.add(key)
            reached.add(key)
            queue.push([path.normalize(target), null])
        }
    }
    return reached
}

/** Whether a declaration of `inputs` for `scope.rule` covers `read` of the file `scope.file`. */
const declared = (inputs: readonly AuditInput[], scope: Scope, read: Read): boolean => {
    const relative = posix(path.relative(scope.root, scope.file))
    return inputs.some((input) => {
        if (input.rule !== scope.rule) return false
        if (!expressionsOf(scope.root, input.appliesTo).some((pattern) => pattern.test(posix(path.resolve(scope.root, relative))))) return false
        if (input.kind === "git") {
            // history is read with git; the only file-system reads of that are `exists` probes of the folders above the linted file
            const folder = fold(read.target)
            return read.op === "exists" && (fold(path.dirname(scope.file)) + "/").startsWith(`${folder}/`)
        }
        if (read.op === "read" && input.kind !== "content") return false
        const patterns = expressionsOf(input.relativeTo === "file" ? path.dirname(scope.file) : scope.root, input.globs)
        const probes = read.op === "list" ? ["ts", "tsx", "css", "json", "txt", ""].map((ext) => posix(path.join(read.target, ext === "" ? "__probe__" : `__probe__.${ext}`))) : [posix(read.target)]
        if (probes.some((probe) => patterns.some((pattern) => pattern.test(probe)))) return true
        return read.op === "list" && onTheWayTo(input.relativeTo === "file" ? path.dirname(scope.file) : scope.root, input.globs, read.target)
    })
}

/** A readable list of the reads nothing covers, or an empty list. */
const violations = (canon: Pick<AuditedCanon, "inputs" | "packageRoot"> & { readonly ts?: AuditedCanon["ts"]; readonly alias?: AuditedCanon["alias"] }, scope: Scope): string[] => {
    const seen = new Set<string>()
    let closure: Set<string> | null = null
    const out: string[] = []
    // a file outside the side root belongs to no cached lint (the cache lints the files of the side's scope)
    const outside = path.relative(scope.root, scope.file)
    if (outside.startsWith("..") || path.isAbsolute(outside)) return out
    for (const read of scope.reads) {
        const key = `${read.op}\0${fold(read.target)}`
        if (seen.has(key) || exempt(read.target, canon.packageRoot) || fold(read.target) === fold(scope.file)) continue
        seen.add(key)
        if (declared(canon.inputs, scope, read)) continue
        const compiler = canon.ts === undefined ? undefined : listed(canon.ts)[0]
        closure ??= compiler === undefined ? new Set<string>() : closureOf(compiler, scope.file, scope.text, canon.alias)
        if (closure.has(fold(read.target))) continue
        out.push(`${scope.rule} linting ${posix(path.relative(scope.root, scope.file))} did a ${read.op} of ${posix(path.relative(scope.root, read.target))}`)
    }
    return out
}

let installed: AuditedCanon | null = null
let active: Scope | null = null
let suspended = 0
const failures: string[] = []

const record = (op: Op, target: unknown): void => {
    if (active === null || suspended > 0 || typeof target !== "string") return
    active.reads.push({ op, target: path.resolve(target) })
}

/** Runs `body` with recording off (the audit's own reads). */
const unrecorded = <T>(body: () => T): T => {
    suspended += 1
    try { return body() } finally { suspended -= 1 }
}

let patched = false
const patchFs = (): void => {
    if (patched) return
    patched = true
    const table: [keyof typeof fs, Op][] = [["readFileSync", "read"], ["existsSync", "exists"], ["statSync", "exists"], ["lstatSync", "exists"], ["accessSync", "exists"], ["readdirSync", "list"], ["opendirSync", "list"]]
    for (const [name, op] of table) {
        const original = fs[name] as (...args: unknown[]) => unknown
        Object.defineProperty(fs, name, { configurable: true, writable: true, value: function patched(this: unknown, ...args: unknown[]) { record(op, args[0]); return original.apply(this, args) } })
    }
    syncBuiltinESMExports()
}

const patchSys = (ts: typeof TypeScript): void => {
    const sys: Record<string, unknown> = ts.sys as unknown as Record<string, unknown>
    for (const name of ["fileExists", "readFile", "directoryExists", "getDirectories", "readDirectory", "realpath", "getModifiedTime", "getFileSize"]) {
        const original = sys[name]
        if (typeof original !== "function") continue
        sys[name] = function patched(this: unknown, ...args: unknown[]) {
            suspended += 1
            try { return (original as (...inner: unknown[]) => unknown).apply(this, args) } finally { suspended -= 1 }
        }
    }
}

type Listener = (...args: unknown[]) => unknown
interface RuleLike { readonly create: (context: { readonly filename: string; readonly sourceCode: { readonly text: string }; readonly settings?: Record<string, unknown> }) => Record<string, unknown> }

const withScope = <T>(scope: Scope, body: () => T): T => {
    const outer = active
    active = scope
    try { return body() } finally { active = outer }
}

const wrap = (rule: RuleLike, published: string, sink: Scope[]): RuleLike => ({
    ...rule,
    create(context) {
        const starci = context.settings?.["starci"] as { hfs?: { repoRoot?: string } } | undefined
        const scope: Scope = { rule: published, file: context.filename, root: starci?.hfs?.repoRoot ?? path.dirname(context.filename), text: context.sourceCode.text, reads: [] }
        sink.push(scope)
        const listeners = withScope(scope, () => rule.create(context))
        return Object.fromEntries(Object.entries(listeners).map(([key, value]) => [key, typeof value === "function" ? (...args: unknown[]) => withScope(scope, () => (value as Listener)(...args)) : value]))
    },
})

/** Installs the recorder on the canon's RuleTester and TypeScript; call it once per spec process, before the specs run. */
export function installFsAudit(canon: AuditedCanon): void {
    if (installed !== null) return
    installed = canon
    patchFs()
    for (const ts of listed(canon.ts)) patchSys(ts)
    for (const tester of listed(canon.RuleTester)) {
        const original = tester.prototype.run
        tester.prototype.run = function run(this: unknown, name: string, rule: unknown, tests: unknown): void {
            const published = Object.entries(canon.rules).find(([, candidate]) => candidate === rule)?.[0]
            if (published === undefined || canon.exempt?.includes(published) === true) return original.call(this, name, rule, tests)
            const scopes: Scope[] = []
            original.call(this, name, wrap(rule as RuleLike, published, scopes), tests)
            const found = scopes.flatMap((scope) => unrecorded(() => violations(canon, scope)))
            if (found.length > 0) {
                const lines = [...new Set(found)].map((line) => `  ${line}`)
                const message = [`${canon.name}: ${found.length} file read(s) of a rule that crossFileInputs and the import graph do not cover (declare them in src/cross-file-inputs.ts):`, ...lines].join("\n")
                failures.push(message)
                throw new Error(message)
            }
        }
    }
}

/** Every violation the audit raised in this process (the preload's exit hook prints them; a spec may assert none). */
export const auditFailures = (): readonly string[] => failures

/** The folder of a canon's package from a file inside its `fixtures/`. */
export const packageRootOf = (metaUrl: string): string => path.resolve(path.dirname(fileURLToPath(metaUrl)), "..")

/** Runs `body` under the recorder with no rule installed (a config-time reader such as the stylelint app tokens) and answers what it read. */
export function recordFsReads<T>(body: () => T): { value: T; reads: readonly { op: Op; target: string }[] } {
    patchFs()
    const scope: Scope = { rule: "", file: "", root: "", text: "", reads: [] }
    const value = withScope(scope, body)
    return { value, reads: scope.reads }
}

/** The same for a body that finishes later (a stylelint run): nothing else may run while it is pending. */
export async function recordFsReadsAsync<T>(body: () => Promise<T>): Promise<{ value: T; reads: readonly { op: Op; target: string }[] }> {
    patchFs()
    const scope: Scope = { rule: "", file: "", root: "", text: "", reads: [] }
    const outer = active
    active = scope
    try { return { value: await body(), reads: scope.reads } } finally { active = outer }
}

/** The reads of `reads` that no declaration of `canon.inputs` for `rule` covers when it lints `file` below `root`, and the import graph of `text` does not carry. */
export function uncoveredReads(canon: Pick<AuditedCanon, "inputs" | "packageRoot"> & { readonly ts?: AuditedCanon["ts"]; readonly alias?: AuditedCanon["alias"] }, scope: { rule: string; file: string; root: string; text: string }, reads: readonly { op: Op; target: string }[]): string[] {
    return unrecorded(() => violations(canon, { ...scope, reads: [...reads] }))
}
