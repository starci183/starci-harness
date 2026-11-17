// The step after tsc: the stylesheet the app entry imports sits beside its compiled module, and a declaration names `.js`, never the `.ts` a source keeps.
import fs from "node:fs"

fs.copyFileSync("src/app/app.css", "dist/app/app.css")
const specifier = /((?:from |import\()['"]\.\.?\/[^'"]+)\.ts(['"])/g
for (const name of fs.readdirSync("dist", { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".d.ts")) continue
    const file = `dist/${name}`
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(specifier, (_all, head: string, quote: string) => `${head}.js${quote}`))
}
