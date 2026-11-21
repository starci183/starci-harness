import { createHash } from "node:crypto"
import { shellQuote } from "./ssh.js"

/**
 * The config drift of a deployed service, read-only: the files a deployer writes on a server before it redeploys (`vps monitor up`, `vps service
 * up`, `vps ui up`, `vps edge up`, a host-compose adapter) compared with what it would write now. Each deployer already redeploys "only when a file
 * changed" (its `cmp -s` of the rendered file against the one on the server); this asks the same question without writing: one sha256 per file.
 * `host up|status|doctor --host` use it (contexts/harness/host.md "Roles").
 */

/** One file a deployer writes on a server: its absolute path, a short label for a report (its path under the deployer's folder), its content. */
export interface DesiredFile {
    readonly path: string
    readonly label: string
    readonly content: string
}

/**
 * The digest of a file's content as the drift script reads it back: the deployers write `content.trimEnd()` and a newline through a heredoc, and the
 * script hashes the file without its trailing newlines, so both sides hash the content without its trailing whitespace.
 */
export const contentDigest = (content: string): string => createHash("sha256").update(content.trimEnd()).digest("hex").slice(0, 16)

/** The read-only script: one line per file, `file <index> <digest>` or `file <index> absent`; nothing is written. */
export const configDriftScript = (files: readonly DesiredFile[]): string =>
    files
        .map((file, index) => {
            const path = shellQuote(file.path)
            return `if [ -f ${path} ]; then printf 'file ${String(index)} %s\\n' "$(printf '%s' "$(cat ${path})" | sha256sum | cut -c1-16)"; else echo 'file ${String(index)} absent'; fi`
        })
        .join("\n")

/**
 * Reads the script's lines: `drift` holds each file that differs from its rendered content or is not on the server, by its label (none when all are
 * equal); `unread` the files the answer holds no line for (the comparison is then incomplete, never a drift).
 */
export const readConfigDrift = (files: readonly DesiredFile[], stdout: string): { readonly drift: string[]; readonly unread: string[] } => {
    const seen = new Map<number, string>()
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^file (\d+) (\S+)$/.exec(line.trim())
        if (match !== null) seen.set(Number(match[1]), match[2] ?? "")
    }
    const drift: string[] = []
    const unread: string[] = []
    files.forEach((file, index) => {
        const have = seen.get(index)
        if (have === undefined) unread.push(file.label)
        else if (have === "absent") drift.push(`${file.label} is not on the server`)
        else if (have !== contentDigest(file.content)) drift.push(`${file.label} differs`)
    })
    return { drift, unread }
}
