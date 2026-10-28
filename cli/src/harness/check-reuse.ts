import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { git, nulPaths } from "../shared/git.js"
import type { WorkspacePackage } from "../shared/workspace.js"
import { now, openLedger } from "./ledger.js"

/** The green rows of the project's checks, keyed by the digest of their inputs (`checkDigest`); additive, created when missing. */
const TABLE = "CREATE TABLE IF NOT EXISTS check_rows (digest TEXT PRIMARY KEY, gate TEXT NOT NULL, package TEXT NOT NULL, command TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL)"

/** The tools a gate runs, whose installed version is an input of its row. */
const TOOLS: Readonly<Record<string, string>> = { typecheck: "typescript", lint: "eslint" }

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex")

/** The installed version of a tool as the package resolves it (its folder, then the repository root); "none" when absent. */
const toolVersion = (root: string, pkg: WorkspacePackage, tool: string): string => {
    const manifest = [pkg.dir, root].map((dir) => join(dir, "node_modules", tool, "package.json")).find((file) => existsSync(file))
    if (manifest === undefined) return "none"
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"))
    return typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string" ? parsed.version : "unknown"
}

/** The workspace packages a package depends on, directly or through another, by name; itself first. */
const reach = (packages: readonly WorkspacePackage[], pkg: WorkspacePackage): WorkspacePackage[] => {
    const seen = new Map<string, WorkspacePackage>([[pkg.name, pkg]])
    const queue = [pkg]
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        for (const name of next.dependsOn) {
            const found = packages.find((each) => each.name === name)
            if (found !== undefined && !seen.has(name)) {
                seen.set(name, found)
                queue.push(found)
            }
        }
    }
    return [...seen.values()]
}

/**
 * The digest of one package step's inputs: the gate and its command, the files it judges, the content of every file under the
 * package and the workspace packages it reaches plus the repository's root files (its lockfile and shared configuration), as git
 * holds them with every dirty or untracked one hashed as it stands, and the versions of Node and of the gate's tool.
 */
export const checkDigest = async (root: string, packages: readonly WorkspacePackage[], pkg: WorkspacePackage, gate: string, command: string, judged: readonly string[], all: boolean): Promise<string> => {
    // A package at the repository root holds the whole tree; any other its own folder.
    const dirs = reach(packages, pkg).map((each) => (each.relativeDir === "." ? ":(top)" : `:(top,literal)${each.relativeDir}`))
    const specs = [...new Set([":(top,glob)*", ...dirs])]
    const staged = await git(root, ["ls-files", "-s", "-z", "--", ...specs])
    const dirty = nulPaths(await git(root, ["ls-files", "-m", "-o", "--exclude-standard", "-z", "--", ...specs])).sort((left, right) => left.localeCompare(right))
    const contents = dirty.map((file) => `${file}\0${existsSync(join(root, file)) ? sha256(readFileSync(join(root, file))) : "deleted"}`)
    const tool = TOOLS[gate]
    return sha256(
        JSON.stringify({ gate, command, package: pkg.relativeDir, all, judged: [...judged].sort((left, right) => left.localeCompare(right)), staged: sha256(staged), dirty: contents, node: process.version, tool: tool === undefined ? null : `${tool}@${toolVersion(root, pkg, tool)}` }),
    )
}

/** The green row recorded for this digest, if any: when it was green and what it said. */
export const greenRow = (root: string, digest: string): { readonly at: string; readonly reason: string; readonly command: string } | undefined => {
    const db = openLedger(root)
    try {
        db.exec(TABLE)
        const row = db.prepare("SELECT at, reason, command FROM check_rows WHERE digest = ?").get(digest)
        return row === undefined ? undefined : { at: String(row.at), reason: String(row.reason), command: String(row.command) }
    } finally {
        db.close()
    }
}

/** Records a green step under its digest (a red one is never kept: it is rerun until it turns green). */
export const recordGreen = (root: string, digest: string, gate: string, pkg: string, command: string, reason: string): void => {
    const db = openLedger(root)
    try {
        db.exec(TABLE)
        db.prepare("INSERT INTO check_rows (digest, gate, package, command, reason, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (digest) DO UPDATE SET at = excluded.at").run(digest, gate, pkg, command, reason, now())
    } finally {
        db.close()
    }
}
