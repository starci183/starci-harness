import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { parse } from "yaml"
import { jsoncToJson } from "./code-text.js"

/** What a config's `extends` chain holds: every file read, every specifier named, and each specifier that resolves to no file. */
export interface ExtendsChain {
    readonly texts: readonly string[]
    readonly specifiers: readonly string[]
    readonly missing: readonly string[]
}

/** Config files whose format carries an `extends` key the walk follows: tsconfig (JSONC) and a JSON or YAML stylelintrc. */
const WALKED = /(?:^|[\\/])(?:tsconfig[^\\/]*\.json|\.stylelintrc(?:\.json|\.ya?ml)?)$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The `extends` specifiers of a config text, or none when it cannot be parsed as JSONC or YAML. */
const extendsOf = (file: string, text: string): string[] => {
    let parsed: unknown
    try {
        parsed = /\.ya?ml$|\.stylelintrc$/.test(file) ? parse(text) : JSON.parse(jsoncToJson(text))
    } catch {
        return []
    }
    if (!isRecord(parsed)) return []
    const value = parsed.extends
    if (typeof value === "string") return [value]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/** The npm package a specifier names (`@scope/name/x.json` gives `@scope/name`), or undefined for a path. */
export const packageOf = (specifier: string): string | undefined => {
    if (specifier.startsWith(".") || isAbsolute(specifier)) return undefined
    const parts = specifier.split("/")
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

/** The candidate files a specifier resolves to from `dir`: the path itself, with `.json`, or a directory's tsconfig.json. */
const candidates = (base: string): string[] => [base, `${base}.json`, join(base, "tsconfig.json")]

/** The file a specifier resolves to from the config in `dir`: a relative path, else a package looked up in node_modules upward. */
const resolveSpecifier = (dir: string, specifier: string): { readonly file?: string | undefined; readonly looked: string } => {
    if (packageOf(specifier) === undefined) {
        const base = resolve(dir, specifier)
        return { file: candidates(base).find(isFile), looked: base }
    }
    let at = dir
    for (;;) {
        const base = join(at, "node_modules", specifier)
        const found = candidates(base).find(isFile)
        if (found !== undefined) return { file: found, looked: base }
        const parent = dirname(at)
        if (parent === at) return { looked: join(dir, "node_modules", specifier) }
        at = parent
    }
}

/**
 * Follows the `extends` chain of a config file: relative paths and package specifiers (resolved from node_modules upward),
 * arrays of extends, each file once. A specifier naming a package of `stop` ends that branch unresolved, since naming the
 * canon package is what the canon gate asks; any other specifier that resolves to no file is missing, with the path tried.
 */
export const walkExtends = (start: string, root: string, stop: readonly string[]): ExtendsChain => {
    const texts: string[] = []
    const specifiers: string[] = []
    const missing: string[] = []
    const seen = new Set<string>()
    const visit = (file: string): void => {
        const key = process.platform === "win32" ? resolve(file).toLowerCase() : resolve(file)
        if (seen.has(key)) return
        seen.add(key)
        const text = readFileSync(file, "utf8")
        texts.push(text)
        if (!WALKED.test(file)) return
        for (const specifier of extendsOf(file, text)) {
            specifiers.push(specifier)
            const name = packageOf(specifier)
            if (name !== undefined && stop.includes(name)) continue
            const resolved = resolveSpecifier(dirname(file), specifier)
            if (resolved.file === undefined) missing.push(`${relative(root, file).replaceAll("\\", "/")} extends "${specifier}", which resolves to no file (${relative(root, resolved.looked).replaceAll("\\", "/")})`)
            else visit(resolved.file)
        }
    }
    visit(start)
    return { texts, specifiers, missing }
}
