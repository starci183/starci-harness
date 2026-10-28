import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

if (readFileSync("src/index.ts", "utf8").includes("BUILD_ERROR")) {
    console.error("src/index.ts(1,14): error TS2322: BUILD_ERROR breaks the ui build")
    process.exit(1)
}
mkdirSync("dist", { recursive: true })
writeFileSync("dist/index.js", 'export const greeting = "hello"\n')
writeFileSync("dist/index.d.ts", "export declare const greeting: string\n")
