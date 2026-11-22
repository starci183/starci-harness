import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const entries = ["common", "core", "offset-pop"]

for (const entry of entries) { const dir = resolve(packageRoot, "src", entry); const main = resolve(dir, "styles.css"); const s = await stat(main).catch(() => null); if (s === null || !s.isFile()) throw new Error(`Missing required CSS entry: src/${entry}/styles.css`); await mkdir(resolve(packageRoot, "dist", entry), { recursive: true }); for (const f of (await readdir(dir)).filter((n) => n.endsWith(".css") || n === "theme-hooks.json")) await copyFile(resolve(dir, f), resolve(packageRoot, "dist", entry, f)) }

// The core's ext stylesheets (src/core/ext/<name>/**/*.css), in their folders: each ext's styles.css @imports its parts by path.
const extRoot = resolve(packageRoot, "src", "core", "ext")
for (const file of (await readdir(extRoot, { recursive: true })).filter((name) => name.endsWith(".css"))) {
    const target = resolve(packageRoot, "dist", "core", "ext", file)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(extRoot, file), target)
}
