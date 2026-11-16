import { existsSync, lstatSync, realpathSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { captureGitSync } from "../shared/git.js"

/**
 * The install guard (contexts/harness/host.md "Dependencies through a link"): a package manager command that writes a `node_modules`
 * never runs through a link. npm, pnpm and yarn rewrite the folder they install into, and through a junction or a symlink that folder is
 * another checkout's install or the harness install cache: an `npm ci` there empties the install every other checkout linked to it. The
 * guard reads a whole shell command line, every command of it (chained with `&&`, `||`, `;` or `|`, sent to the background with `&` or
 * `start /b`, wrapped in `cmd /c`, `sh -c` or `powershell -Command`), follows each `cd`, and refuses a writing command whose target
 * `node_modules` is a link, or is a real folder another worktree of the same repository links to.
 */

/** One refused command: what ran, the folder it installs into, and why it may not. */
export interface InstallRefusal {
    readonly command: string
    readonly target: string
    readonly reason: "linked" | "shared"
    readonly holder?: string
    readonly message: string
}

/** The subcommands of each manager that write `node_modules` (install, remove, update, prune, dedupe, rebuild, link and their aliases). */
const WRITERS: Readonly<Record<string, ReadonlySet<string>>> = {
    npm: new Set(["ci", "clean-install", "install-clean", "ic", "install", "i", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal", "isntall", "add", "install-test", "it", "install-ci-test", "cit", "uninstall", "un", "unlink", "remove", "rm", "r", "update", "up", "upgrade", "udpate", "prune", "dedupe", "ddp", "find-dupes", "rebuild", "rb", "link", "ln"]),
    pnpm: new Set(["install", "i", "add", "remove", "rm", "uninstall", "un", "update", "up", "upgrade", "prune", "dedupe", "rebuild", "rb", "link", "ln", "unlink", "import", "install-test", "it", "fetch"]),
    yarn: new Set(["install", "add", "remove", "upgrade", "up", "upgrade-interactive", "dedupe", "link", "unlink", "rebuild", "import", "autoclean"]),
}

/** The options of each manager that take a value as the next word, and the ones of them that name the folder it installs into. */
const VALUE_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
    npm: new Set(["--prefix", "--loglevel", "--registry", "--cache", "--userconfig", "--globalconfig", "--workspace", "-w", "--omit", "--include", "--location"]),
    pnpm: new Set(["-C", "--dir", "--filter", "-F", "--reporter", "--registry", "--store-dir", "--virtual-store-dir", "--modules-dir"]),
    yarn: new Set(["--cwd", "--registry", "--modules-folder", "--cache-folder"]),
}
const DIR_OPTIONS = new Set(["--prefix", "-C", "--dir", "--cwd"])

/** Splits a command line into its simple commands at `&&`, `||`, `;`, `|`, `&` and line breaks outside quotes. */
export const shellCommands = (line: string): string[] => {
    const commands: string[] = []
    let current = ""
    let quote: string | null = null
    for (let index = 0; index < line.length; index += 1) {
        const char = line.charAt(index)
        if (quote !== null) {
            current += char
            if (char === quote) quote = null
        } else if (char === "'" || char === "\"") {
            quote = char
            current += char
        } else if (char === "&" || char === "|" || char === ";" || char === "\n" || char === "\r") {
            if (current.trim() !== "") commands.push(current.trim())
            current = ""
            if ((char === "&" || char === "|") && line.charAt(index + 1) === char) index += 1
        } else current += char
    }
    if (current.trim() !== "") commands.push(current.trim())
    return commands
}

/** The words of one simple command, quotes removed. */
export const shellWords = (command: string): string[] => {
    const words: string[] = []
    let current = ""
    let quote: string | null = null
    let open = false
    for (const char of command) {
        if (quote !== null) {
            if (char === quote) quote = null
            else current += char
        } else if (char === "'" || char === "\"") {
            quote = char
            open = true
        } else if (/\s/.test(char)) {
            if (open || current !== "") words.push(current)
            current = ""
            open = false
        } else current += char
    }
    if (open || current !== "") words.push(current)
    return words
}

/** The name of a program word: its last path segment, lower case, without a Windows launcher extension. */
const programName = (word: string): string => basename(word.replaceAll("\\", "/")).toLowerCase().replace(/\.(?:cmd|exe|ps1|bat|js|cjs|mjs)$/, "")

/** A wrapper whose argument is a whole command line of its own: `cmd /c "<line>"`, `sh -c "<line>"`, `powershell -Command "<line>"`. */
const innerLine = (words: readonly string[]): string | undefined => {
    const name = programName(words[0] ?? "")
    const flagAt = words.findIndex((word, index) => index > 0 && (["cmd"].includes(name) ? /^\/[ck]$/i.test(word) : ["sh", "bash", "zsh", "dash"].includes(name) ? /^-[a-z]*c[a-z]*$/.test(word) : ["powershell", "pwsh"].includes(name) ? /^-(?:c|command)$/i.test(word) : false))
    return flagAt > 0 ? words.slice(flagAt + 1).join(" ") : undefined
}

/** Strips the launchers that only start the command after them: `start [/b] ["title"]`, `call`, `nohup`, `setsid`, `env`, `time`, `VAR=value`. */
const unwrap = (words: readonly string[]): string[] => {
    let rest = [...words]
    for (;;) {
        const name = programName(rest[0] ?? "")
        if (name === "start") {
            rest = rest.slice(1)
            while (rest[0] !== undefined && (/^\/[a-z]+$/i.test(rest[0]) || rest[0] === "")) rest = rest.slice(1)
        } else if (["call", "nohup", "setsid", "time", "exec", "sudo"].includes(name)) rest = rest.slice(1)
        else if (name === "env") {
            rest = rest.slice(1)
            while (rest[0] !== undefined && (rest[0].startsWith("-") || rest[0].includes("="))) rest = rest.slice(1)
        } else if (rest[0] !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) rest = rest.slice(1)
        else if (name === "corepack" && ["pnpm", "yarn", "npm"].includes(programName(rest[1] ?? ""))) rest = rest.slice(1)
        else if (name === "node" && rest[1]?.replaceAll("\\", "/").endsWith("npm-cli.js") === true) rest = ["npm", ...rest.slice(2)]
        else return rest
    }
}

/** The manager, subcommand and target folder of a writing package manager command, or undefined when the words are none. */
export const installTarget = (words: readonly string[], cwd: string): { readonly tool: string; readonly subcommand: string; readonly dir: string } | undefined => {
    const tool = programName(words[0] ?? "")
    const writers = WRITERS[tool]
    const values = VALUE_OPTIONS[tool]
    if (writers === undefined || values === undefined) return undefined
    let dir = cwd
    let subcommand: string | undefined
    let global = false
    for (let index = 1; index < words.length; index += 1) {
        const word = words[index] ?? ""
        const [flag, inline] = word.startsWith("-") && word.includes("=") ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)] : [word, undefined]
        if (flag === "-g" || flag === "--global" || (flag === "--location" && (inline ?? words[index + 1]) === "global")) global = true
        if (values.has(flag)) {
            const value = inline ?? words[index + 1] ?? ""
            if (DIR_OPTIONS.has(flag)) dir = resolve(cwd, value)
            if (inline === undefined) index += 1
        } else if (!word.startsWith("-") && subcommand === undefined) subcommand = word
    }
    if (tool === "yarn" && subcommand === "global") return undefined
    const effective = subcommand ?? (tool === "yarn" ? "install" : undefined)
    if (global || effective === undefined || !writers.has(effective)) return undefined
    return { tool, subcommand: effective, dir }
}

/** The directory a `cd`, `pushd`, `Set-Location` or `sl` moves to, or undefined when the words are none. */
const changedDirectory = (words: readonly string[], cwd: string): string | undefined => {
    const name = programName(words[0] ?? "")
    if (!["cd", "chdir", "pushd", "set-location", "sl"].includes(name)) return undefined
    const target = words.slice(1).find((word) => !/^(?:\/d|-path|-literalpath)$/i.test(word))
    return target === undefined ? cwd : isAbsolute(target) || /^[A-Za-z]:/.test(target) ? resolve(target) : resolve(cwd, target)
}

const isLink = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true
const real = (path: string): string | undefined => {
    try {
        return realpathSync.native(path)
    } catch {
        return undefined
    }
}
const sameFolder = (left: string | undefined, right: string | undefined): boolean => left !== undefined && right !== undefined && (process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right)

/** The worktrees of the repository that holds `dir` (main checkout included), from `git worktree list`; none outside a repository. */
const worktreesOf = (dir: string): string[] => {
    const listing = captureGitSync(["worktree", "list", "--porcelain"], dir)
    if (listing.exitCode !== 0) return []
    return listing.stdout.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => resolve(line.slice("worktree ".length).trim()))
}

/** The other worktree whose `node_modules` at the same place links to `dir`'s real `node_modules`, or undefined. */
export const sharedInstallHolder = (dir: string): string | undefined => {
    const modules = join(dir, "node_modules")
    if (!existsSync(modules) || isLink(modules)) return undefined
    const target = real(modules)
    const trees = worktreesOf(dir)
    const own = trees.filter((tree) => {
        const rel = relative(real(tree) ?? tree, real(dir) ?? dir)
        return !rel.startsWith("..") && !isAbsolute(rel)
    }).sort((left, right) => right.length - left.length)[0]
    const inside = own === undefined ? "" : relative(real(own) ?? own, real(dir) ?? dir)
    for (const tree of trees) {
        if (own !== undefined && sameFolder(real(tree), real(own))) continue
        const candidate = join(tree, inside, "node_modules")
        if (isLink(candidate) && sameFolder(real(candidate), target)) return candidate
    }
    return undefined
}

/** Why an install into `dir` may not run: its `node_modules` is a link, or another worktree links to it; undefined when it may. */
export const installHazard = (dir: string): Omit<InstallRefusal, "command"> | undefined => {
    const modules = join(dir, "node_modules")
    if (isLink(modules)) {
        return {
            target: dir,
            reason: "linked",
            message: `${modules} is a junction or symlink to ${real(modules) ?? "a missing folder"}: an install through it rewrites the shared install every checkout linked to it uses. Remove only the link (never a recursive delete through it), then install this checkout's own node_modules`,
        }
    }
    const holder = sharedInstallHolder(dir)
    if (holder !== undefined) {
        return {
            target: dir,
            reason: "shared",
            holder,
            message: `${modules} is the install ${holder} links to: an install here rewrites it under that worktree too. Install in a checkout of your own, or unlink ${holder} first`,
        }
    }
    return undefined
}

/**
 * Every refused command of a shell command line run in `cwd`: each simple command is unwrapped from its launchers, a `cd` moves the
 * folder the later ones run in, a wrapper's own command line is judged as a line, and a writing package manager command is refused when
 * its target's `node_modules` is a link or is linked to by another worktree.
 */
export const installRefusals = (line: string, cwd: string, depth = 0): InstallRefusal[] => {
    const refusals: InstallRefusal[] = []
    let here = resolve(cwd)
    for (const command of shellCommands(line)) {
        const words = unwrap(shellWords(command))
        const moved = changedDirectory(words, here)
        if (moved !== undefined) {
            here = moved
            continue
        }
        const inner = depth < 4 ? innerLine(words) : undefined
        if (inner !== undefined) {
            refusals.push(...installRefusals(inner, here, depth + 1))
            continue
        }
        const target = installTarget(words, here)
        if (target === undefined) continue
        const hazard = installHazard(target.dir)
        if (hazard !== undefined) refusals.push({ command, ...hazard })
    }
    return refusals
}
