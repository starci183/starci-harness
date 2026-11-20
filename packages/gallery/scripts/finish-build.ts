// The step after tsc: the stylesheets the app entry and the board frame import sit beside its compiled module, and a declaration names `.js`, never the `.ts` a source keeps.
import fs from "node:fs"

for (const sheet of ["app.css", "board-frame.css"]) fs.copyFileSync(`src/app/${sheet}`, `dist/app/${sheet}`)
const specifier = /((?:from |import\()['"]\.\.?\/[^'"]+)\.ts(['"])/g
for (const name of fs.readdirSync("dist", { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".d.ts")) continue
    const file = `dist/${name}`
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(specifier, (_all, head: string, quote: string) => `${head}.js${quote}`))
}
