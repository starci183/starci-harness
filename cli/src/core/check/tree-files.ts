import { existsSync, openSync, closeSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import { git } from "../../shared/git.js"

/** The text of one file as a repository gate sees it, or why it was not read. */
export type FileText = { readonly text: string } | { readonly unread: "missing" | "binary" | "too-large" }

/** Third-party code vendored by a package manager is not the project's; build output is ignored by git already. */
const VENDORED = /(?:^|\/)node_modules\//

/** Every file of the tree as it stands: tracked plus untracked, never what .gitignore ignores, forward slashes, sorted. */
export const treeFiles = async (root: string): Promise<string[]> => {
    const listed = await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--full-name"])
    const files = listed.split("\n").map((file) => file.trim()).filter((file) => file !== "" && !VENDORED.test(file))
    return [...new Set(files)].sort((left, right) => Number(left > right) - Number(left < right))
}

const SNIFF_BYTES = 8000

/** Reads a repository file as utf8 text when it exists, is no larger than `maxBytes` and holds no NUL byte in its head. */
export const readTreeFile = (root: string, file: string, maxBytes: number): FileText => {
    const path = join(root, file)
    if (!existsSync(path)) return { unread: "missing" }
    const stat = statSync(path)
    if (!stat.isFile()) return { unread: "missing" }
    // The head is sniffed before the size is judged: a large image is binary, not a text file too large to read.
    const size = stat.size > maxBytes ? Math.min(stat.size, SNIFF_BYTES) : stat.size
    const buffer = Buffer.alloc(size)
    const handle = openSync(path, "r")
    try {
        readSync(handle, buffer, 0, size, 0)
    } finally {
        closeSync(handle)
    }
    if (buffer.subarray(0, SNIFF_BYTES).includes(0)) return { unread: "binary" }
    if (stat.size > maxBytes) return { unread: "too-large" }
    return { text: buffer.toString("utf8") }
}
