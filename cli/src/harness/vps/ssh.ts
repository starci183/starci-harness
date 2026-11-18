import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool, headline } from "../../shared/exec.js"
import type { ToolRun } from "../../shared/exec.js"
import { redactSecrets } from "../../shared/secrets.js"

/**
 * The ssh transport of `starci vps`. It is the pattern of @starci/hfs `stack/remote.mts` (`openSealedSession`): the sealed key and
 * the pinned known_hosts go into a private temp folder (mode 600, and on Windows an ACL with the current user alone, which Windows
 * OpenSSH demands), ssh runs with IdentitiesOnly, StrictHostKeyChecking=yes and BatchMode, and the folder is overwritten and removed
 * when the session closes. That module is bound to an app's DeployConfig and is not exported by the package, so its pattern is
 * repeated here rather than imported. A script reaches the server on ssh's stdin, never in argv; a secret it needs is an
 * `export NAME='value'` line put before it on that stdin, so no value is in argv, a process list, a file or the output.
 */

/** Where and as whom a session logs in, with the sealed key and the pinned host keys. */
export interface SshTarget {
    readonly host: string
    readonly port: number
    readonly user: string
    readonly privateKey: string
    readonly knownHosts: string
    readonly connectTimeoutSeconds: number
}

/** One remote script: its text, whether it runs as root (sudo -n for a non-root login), and the secrets it reads from its environment. */
export interface RemoteScript {
    readonly script: string
    readonly root: boolean
    readonly secrets?: Readonly<Record<string, string>>
    readonly timeoutMs: number
}

/** An open session: runs scripts, then closes (the key file is overwritten and the folder removed). */
export interface SshSession {
    readonly run: (remote: RemoteScript) => Promise<ToolRun>
    readonly close: () => void
}

const ACCOUNT = /^[A-Za-z0-9._@-]+$/
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/

/** POSIX single-quote quoting; a NUL or a line break is refused (a remote argument is one line). */
export const shellQuote = (value: string): string => {
    if (value.includes("\0") || /[\r\n]/.test(value)) throw new Refusal("VPS_REMOTE_ARGUMENT", "a remote argument must not contain NUL or a line break")
    return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/** The stdin a script runs from: the secret exports, then the script, LF only, under `set -euo pipefail`. */
export const remoteInput = (remote: RemoteScript): string => {
    const exports = Object.entries(remote.secrets ?? {}).map(([name, value]) => {
        if (!SECRET_NAME.test(name)) throw new Refusal("VPS_REMOTE_ARGUMENT", `${name} is no environment variable name`)
        // A single-quoted literal keeps every byte of a multi-line value (a key); only a single quote needs escaping.
        return `export ${name}='${value.replaceAll("'", String.raw`'\''`)}'`
    })
    return ["set -euo pipefail", ...exports, remote.script].join("\n").replaceAll("\r", "") + "\n"
}

/** The remote command line: bash reading stdin, as root through `sudo -n` when the login is not root. */
export const remoteCommand = (user: string, root: boolean): string => (root && user !== "root" ? "sudo -n bash -s" : "bash -s")

/** On win32 the inherited ACL of a key file is removed and the current user alone granted, as Windows OpenSSH demands; elsewhere the mode is enough. */
const restrictToUser = async (file: string): Promise<void> => {
    if (process.platform !== "win32") return
    const run = await captureTool("icacls", [file, "/inheritance:r", "/grant:r", `${userInfo().username}:F`], tmpdir())
    if (run.exitCode !== 0) throw new Refusal("VPS_SSH_ACL", `cannot restrict ${file} to the current user with icacls: ${headline(run.stderr) || headline(run.stdout) || "icacls failed"}`)
}

const writePrivate = async (file: string, text: string): Promise<void> => {
    writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 })
    chmodSync(file, 0o600)
    // Full control for the current user alone: Windows OpenSSH accepts it, and close() can overwrite the key before removing it.
    await restrictToUser(file)
}

/** The ssh argv of a session: never a value, only the private files' paths. */
export const sshArgv = (target: Pick<SshTarget, "host" | "port" | "user" | "connectTimeoutSeconds">, keyFile: string, knownFile: string): string[] => [
    "-T",
    "-p",
    String(target.port),
    "-i",
    keyFile,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `UserKnownHostsFile=${knownFile}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    `ConnectTimeout=${String(target.connectTimeoutSeconds)}`,
    `${target.user}@${target.host}`,
]

/** Opens a session over the sealed key and known_hosts; refuses a target with no pinned host key (a server is added first). */
export const openSession = async (target: SshTarget): Promise<SshSession> => {
    if (!ACCOUNT.test(target.user) || !ACCOUNT.test(target.host) || target.host.startsWith("-") || target.user.startsWith("-")) throw new Refusal("VPS_SSH_TARGET", "the login user or host holds characters ssh does not take")
    if (!target.privateKey.includes("PRIVATE KEY")) throw new Refusal("VPS_SSH_KEY", "the sealed privateKey is no PEM or OpenSSH private key")
    if (target.knownHosts.trim() === "") throw new Refusal("VPS_SSH_KNOWN_HOSTS", "the server has no pinned known_hosts; `starci vps add` records them")
    const dir = mkdtempSync(join(tmpdir(), "starci-vps-"))
    const keyFile = join(dir, "id")
    const knownFile = join(dir, "known_hosts")
    const close = (): void => {
        try {
            writeFileSync(keyFile, "0".repeat(target.privateKey.length))
        } catch {
            // the file is removed below either way
        }
        rmSync(dir, { recursive: true, force: true })
    }
    try {
        await writePrivate(keyFile, target.privateKey)
        await writePrivate(knownFile, target.knownHosts)
    } catch (error: unknown) {
        rmSync(dir, { recursive: true, force: true })
        throw error
    }
    const argv = sshArgv(target, keyFile, knownFile)
    const run = async (remote: RemoteScript): Promise<ToolRun> => {
        const result = await captureTool("ssh", [...argv, remoteCommand(target.user, remote.root)], dir, { input: remoteInput(remote), timeoutMs: remote.timeoutMs })
        // Whatever the server answers is redacted once more: a script never prints a secret, and a slip is caught here.
        const values = Object.values(remote.secrets ?? {})
        const scrub = (text: string): string => values.reduce((out, value) => (value.length >= 6 ? out.replaceAll(value, "[redacted]") : out), redactSecrets(text))
        return { ...result, stdout: scrub(result.stdout), stderr: scrub(result.stderr) }
    }
    return { run, close }
}
