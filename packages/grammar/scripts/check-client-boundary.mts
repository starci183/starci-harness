import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Contract check (U2-G7): a Grammar module that calls a React hook, `createContext`, or one of the region wrappers
 * (`withRegionLoading`, `withRegionInert`, `withRegionGeometry`) at module level or in its render needs `"use client"`, or a server
 * component that imports it fails with "Attempted to call withRegionLoading() from the server". The directive must be the first
 * statement of the file. Fails on a module that needs it and does not carry it. Frames that only call `createElement` are server safe.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src")
const CLIENT_CALLS = /(?<![\w.])(use[A-Z]\w*|withRegionLoading|withRegionInert|withRegionGeometry|createContext)\s*(<[^>(]*>)?\(/g
const DIRECTIVE = /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*(["'])use client\1/
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = resolve(dir, name)
        if (statSync(path).isDirectory()) return name === "stories" ? [] : walk(path)
        return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") && !/\.(test|spec)\./.test(name) ? [path] : []
    })
const problems: string[] = []
let checked = 0
for (const dir of ["core", "common", "offset-pop"]) {
    for (const file of walk(resolve(root, dir))) {
        checked += 1
        const source = readFileSync(file, "utf8")
        if (DIRECTIVE.test(source)) continue
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
        const calls = new Set<string>()
        for (const match of code.matchAll(CLIENT_CALLS)) {
            const before = code.slice(Math.max(0, (match.index ?? 0) - 9), match.index)
            if (/function\s*$/.test(before) || /\bconst\s*$/.test(before)) continue
            calls.add(match[1] ?? "")
        }
        if (calls.size > 0) problems.push(`${relative(root, file).replaceAll("\\", "/")}: calls ${[...calls].join(", ")} without "use client" as its first statement`)
    }
}
if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
}
console.log(`client boundary: ${checked} modules, every one that calls a hook, createContext or a region wrapper is "use client"`)
