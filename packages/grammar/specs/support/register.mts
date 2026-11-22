/**
 * Lets a spec import Grammar's own source (`.tsx` and the `.js` specifiers the source writes) and render it on the server, with no bundler and no DOM:
 * a synchronous module hook that maps `./x.js` to `./x.tsx` or `./x.ts` and transpiles TSX with the package's own TypeScript.
 *
 *   node --import ./specs/support/register.mts --test "specs/*.spec.mts"
 */
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import ts from "typescript"

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (/^\.{1,2}\//.test(specifier) && specifier.endsWith(".js") && context.parentURL?.startsWith("file:") === true) {
            for (const extension of [".tsx", ".ts"]) {
                const candidate = new URL(specifier.slice(0, -3) + extension, context.parentURL)
                if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
            }
        }
        return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
        if (!url.startsWith("file:") || !/\.(tsx|ts)$/.test(url) || url.includes("/node_modules/")) return nextLoad(url, context)
        const source = readFileSync(fileURLToPath(url), "utf8")
        const { outputText } = ts.transpileModule(source, {
            fileName: fileURLToPath(url),
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true },
        })
        return { format: "module", shortCircuit: true, source: outputText }
    },
})
