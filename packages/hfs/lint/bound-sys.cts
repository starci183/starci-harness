// bound-sys.cts - the typed ESLint run never reads types from above the app root.
//
// `starci app lint` starts ESLint with `node --require <bound-sys.cjs>` (this file, built in place) and STARCI_LINT_BOUND set to the
// app root. typescript-eslint's projectService builds its server host from `tsserver.sys` (typescript/lib/tsserverlibrary) and
// exposes no host through parserOptions, so without a bound a typed rule reads types from an enclosing repository's node_modules
// and judges the app greener than its own install allows. Here `sys` of the app's own TypeScript is patched, in place and before
// ESLint loads the parser, to answer only for paths inside the app root and TypeScript's own lib directory (the same bound a typed
// tsc program of the app keeps). realpath is the identity, so an install junctioned inside the app stays inside it. Nothing is
// patched when STARCI_LINT_BOUND is unset or TypeScript is not installed (nothing typed runs). It stays CommonJS: a `--require`
// preload runs synchronously before ESLint loads the parser.
import type { System } from 'typescript'

const path: typeof import('node:path') = require('node:path')
const { createRequire }: typeof import('node:module') = require('node:module')

const key = (p: string): string => path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Patch `sys` (the TypeScript system object) so it answers only for paths inside `bound` and `libDir`. Returns `sys`. */
function bindSys(sys: System, bound: string, libDir: string): System {
    const roots = [key(bound), key(libDir)]
    const inside = (p: string): boolean => {
        const k = key(p)
        return roots.some((root) => k === root || k.startsWith(`${root}/`))
    }
    const base: System = { ...sys }
    return Object.assign(sys, {
        fileExists: (p: string) => inside(p) && base.fileExists(p),
        directoryExists: (p: string) => inside(p) && base.directoryExists(p),
        readFile: (p: string, encoding?: string) => (inside(p) ? base.readFile(p, encoding) : undefined),
        getDirectories: (p: string) => (inside(p) ? base.getDirectories(p) : []),
        readDirectory: (dir: string, ext?: readonly string[], exclude?: readonly string[], include?: readonly string[], depth?: number) =>
            (inside(dir) ? base.readDirectory(dir, ext, exclude, include, depth).filter(inside) : []),
        realpath: (p: string) => p,
    })
}

/** Bind the `sys` of every TypeScript entry the typed lint loads, resolved from `from` (a side folder of the app). */
function bindTypeScript(bound: string, from: string): number {
    const require_ = createRequire(path.join(from, 'package.json'))
    const bound_: System[] = []
    for (const entry of ['typescript/lib/tsserverlibrary', 'typescript']) {
        let ts: typeof import('typescript') | undefined
        try { ts = require_(entry) } catch { continue }
        if (!ts?.sys || bound_.includes(ts.sys)) continue
        bindSys(ts.sys, bound, path.dirname(ts.getDefaultLibFilePath({})))
        bound_.push(ts.sys)
    }
    return bound_.length
}

if (process.env['STARCI_LINT_BOUND']) bindTypeScript(process.env['STARCI_LINT_BOUND'], process.cwd())

module.exports = { bindSys, bindTypeScript }
