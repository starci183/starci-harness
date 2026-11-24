import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { Refusal } from "./errors.js"

/**
 * The POSIX `sh` a gate's specs and scripts spawn, as PATH resolves it: the first PATH entry holding `sh` (on Windows `sh.exe` or a
 * PATHEXT name, which Git for Windows ships in its usr/bin); undefined when no entry has one. A PowerShell session whose PATH holds
 * only Git's cmd/ (and WSL's bash in System32) has none, so a spec that spawns `sh` fails in the middle of a gate.
 */
export const posixShOnPath = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, isFile: (path: string) => boolean = (path) => existsSync(path) && statSync(path).isFile()): string | undefined => {
    const path = env.PATH ?? env.Path ?? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? ""
    const sep = platform === "win32" ? ";" : ":"
    const names = platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((ext) => ext !== "").map((ext) => `sh${ext.toLowerCase()}`) : ["sh"]
    for (const entry of path.split(sep).map((one) => one.trim().replace(/^"(.*)"$/u, "$1")).filter((one) => one !== "")) {
        for (const name of names) {
            const candidate = join(entry, name)
            if (isFile(candidate)) return candidate
        }
    }
    return undefined
}

/** The fix a missing `sh` needs, per platform. */
const shFix = (platform: NodeJS.Platform): string =>
    platform === "win32"
        ? String.raw`put Git for Windows' usr\bin first on PATH (PowerShell: $env:Path = "C:\Program Files\Git\usr\bin;" + $env:Path; Git Bash has it already) and run it again`
        : "install a POSIX sh (/bin/sh) and put its folder on PATH, then run it again"

/**
 * Refuses HOST_POSIX_SH_MISSING before a gate starts when no `sh` resolves on PATH: the gate's specs spawn `sh`, and a gate
 * that finds none fails half way and is read as a red gate of the lane instead of a host to fix.
 */
export const assertPosixSh = (what: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, isFile?: (path: string) => boolean): string => {
    const found = posixShOnPath(env, platform, isFile)
    if (found === undefined) throw new Refusal("HOST_POSIX_SH_MISSING", `${what} needs a POSIX sh on PATH and none resolves: ${shFix(platform)}`)
    return found
}
