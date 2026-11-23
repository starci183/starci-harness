import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * WSL's memory reclaim on a Windows host (contexts/harness/host.md "WSL memory"). The WSL VM (vmmem) keeps its Linux page cache as committed
 * memory and gives it back only when told: on a host that ran docker builds and dev stacks it held 32 GB of commit while its distro used 2 GB,
 * and the host ran out of commit ("paging file is too small") with RAM still free. `[experimental] autoMemoryReclaim=dropcache` in
 * `%UserProfile%/.wslconfig` makes WSL drop that cache once the VM is idle. `starci host up --host local` merges it in, keeping every other
 * key and section; it takes effect after the next WSL restart (`wsl --shutdown`), which the harness never runs itself.
 */

export const WSL_SECTION = "experimental"
export const WSL_KEY = "autoMemoryReclaim"
export const WSL_VALUE = "dropcache"

/** The .wslconfig of this user. */
export const wslConfigPath = (): string => join(process.env.USERPROFILE ?? homedir(), ".wslconfig")

/**
 * `text` (an ini file, possibly empty) with `[experimental] autoMemoryReclaim=dropcache`: the key set in place when the section has it with
 * another value, added under the section when it lacks it, the section appended when there is none. Every other line stays as it was, the
 * line ending of the file kept. `changed` is false when it already says so. Pure.
 */
export const mergeWslConfig = (text: string): { readonly text: string; readonly changed: boolean; readonly was: string | null } => {
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    const lines = text === "" ? [] : text.split(/\r?\n/)
    const header = (line: string): string | undefined => /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1]?.trim().toLowerCase()
    const start = lines.findIndex((line) => header(line) === WSL_SECTION)
    const wanted = `${WSL_KEY}=${WSL_VALUE}`
    if (start === -1) {
        const body = lines.length > 0 && lines.at(-1) === "" ? lines.slice(0, -1) : lines
        const out = [...body, ...(body.length > 0 ? [""] : []), `[${WSL_SECTION}]`, wanted, ""]
        return { text: out.join(eol), changed: true, was: null }
    }
    let end = lines.length
    for (let at = start + 1; at < lines.length; at += 1) {
        if (header(lines[at] ?? "") !== undefined) {
            end = at
            break
        }
    }
    const keyAt = lines.findIndex((line, at) => at > start && at < end && new RegExp(`^\\s*${WSL_KEY}\\s*=`, "i").test(line))
    if (keyAt !== -1) {
        const was = (lines[keyAt] ?? "").split("=").slice(1).join("=").trim()
        if (was.toLowerCase() === WSL_VALUE) return { text, changed: false, was }
        const out = [...lines]
        out[keyAt] = wanted
        return { text: out.join(eol), changed: true, was }
    }
    const out = [...lines.slice(0, start + 1), wanted, ...lines.slice(start + 1)]
    return { text: out.join(eol), changed: true, was: null }
}

/** What ensuring the reclaim found or did. */
export interface WslReclaim {
    readonly file: string
    readonly state: "set" | "would set" | "already set" | "not windows"
    readonly was: string | null
    readonly note: string
}

/** Ensures the reclaim key in this user's .wslconfig (only with `execute`); off Windows there is nothing to do. */
export const ensureWslReclaim = (execute: boolean): WslReclaim => {
    const file = wslConfigPath()
    if (process.platform !== "win32") return { file, state: "not windows", was: null, note: "no WSL on this host" }
    const current = existsSync(file) ? readFileSync(file, "utf8") : ""
    const merged = mergeWslConfig(current)
    if (!merged.changed) return { file, state: "already set", was: merged.was, note: `${file} has [${WSL_SECTION}] ${WSL_KEY}=${WSL_VALUE}` }
    if (execute) writeFileSync(file, merged.text)
    const what = `[${WSL_SECTION}] ${WSL_KEY}=${WSL_VALUE}${merged.was === null ? "" : ` (was ${merged.was})`}`
    return { file, state: execute ? "set" : "would set", was: merged.was, note: `${execute ? "set" : "would set"} ${what} in ${file}, other keys kept; it takes effect after the next WSL restart (wsl --shutdown, run by the owner, never by the harness)` }
}
