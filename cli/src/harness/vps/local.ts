import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Refusal } from "../../shared/errors.js"
import { captureTool, headline } from "../../shared/exec.js"

/**
 * The owner-machine side of `starci vps`: the masked prompt, the confirmation, and the ssh-keygen and ssh-keyscan calls. Key
 * material only passes through a private temp folder that is removed at once; nothing here prints a value.
 */

/** Runs `body` with a private temp folder, removed after. */
export const withPrivateDir = async <T>(body: (dir: string) => Promise<T>): Promise<T> => {
    const dir = mkdtempSync(join(tmpdir(), "starci-vps-key-"))
    try {
        return await body(dir)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const writePrivate = (file: string, text: string): void => {
    writeFileSync(file, text, { mode: 0o600 })
    chmodSync(file, 0o600)
}

/**
 * Reads a value with nothing echoed: on a terminal a masked prompt (a multi-line PEM key ends at its `-----END ... KEY-----` line
 * or an empty line), otherwise the whole redirected stdin. A password-looking single line is never asked for here.
 */
export const promptHidden = async (label: string, multiline: boolean): Promise<string> => {
    const input = process.stdin
    if (!input.isTTY) {
        const text = readFileSync(0, "utf8")
        return multiline ? text : text.replace(/\r?\n$/, "")
    }
    process.stderr.write(`${label}${multiline ? " (paste it; it ends at its END line)" : ""}: `)
    input.setRawMode(true)
    input.resume()
    input.setEncoding("utf8")
    return new Promise<string>((resolve, reject) => {
        let value = ""
        const done = (error?: Error): void => {
            input.setRawMode(false)
            input.pause()
            input.removeListener("data", onData)
            process.stderr.write("\n")
            if (error === undefined) resolve(value)
            else reject(error)
        }
        /** Takes one typed character; true when the value is complete. */
        const take = (char: string): boolean => {
            if (char === "\u0004") return true
            if (char === "\r" || char === "\n") {
                if (!multiline) return true
                const ends = value.endsWith("\n") || /-----END [A-Z ]*PRIVATE KEY-----$/.test(value)
                value += "\n"
                return ends
            }
            if (char === "\u007f" || char === "\b") value = value.slice(0, -1)
            else value += char
            return false
        }
        const onData = (chunk: string): void => {
            for (const char of chunk) {
                if (char === "\u0003") {
                    done(new Refusal("VPS_PROMPT_CANCELLED", "cancelled; nothing was sealed"))
                    return
                }
                if (take(char)) {
                    done()
                    return
                }
            }
        }
        input.on("data", onData)
    })
}

/** Asks a yes/no question on the terminal; anything but y or yes is no. Refused without a terminal (pass the flag that answers it). */
export const confirm = async (question: string, flag: string): Promise<boolean> => {
    if (!process.stdin.isTTY) throw new Refusal("VPS_CONFIRM_NEEDED", `${question}: no terminal to ask on; pass ${flag}`)
    process.stderr.write(`${question} [y/N] `)
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
    const answer = await new Promise<string>((resolve) => {
        process.stdin.once("data", (chunk) => {
            resolve(String(chunk))
        })
    })
    process.stdin.pause()
    return /^y(es)?$/i.test(answer.trim())
}

/** The public half of a private key; a key with a passphrase or no key at all is refused (a batch login needs neither). */
export const publicKeyOf = async (privateKey: string): Promise<string> =>
    withPrivateDir(async (dir) => {
        const file = join(dir, "id")
        writePrivate(file, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`)
        const run = await captureTool("ssh-keygen", ["-y", "-P", "", "-f", file], dir)
        if (run.exitCode !== 0) throw new Refusal("VPS_KEY_INVALID", `the key is not a private key ssh-keygen opens without a passphrase (${headline(run.stderr) || "refused"}); a managed server takes a passphrase-less key, sealed`)
        return run.stdout.trim()
    })

/** A new ed25519 key pair for a deploy user, made here; the private half goes to the caller alone. */
export const generateKey = async (comment: string): Promise<{ readonly privateKey: string; readonly publicKey: string }> =>
    withPrivateDir(async (dir) => {
        const file = join(dir, "id")
        const run = await captureTool("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", file], dir)
        if (run.exitCode !== 0) throw new Refusal("VPS_KEYGEN_FAILED", `ssh-keygen could not make a key: ${headline(run.stderr) || "refused"}`)
        const privateKey = readFileSync(file, "utf8")
        writeFileSync(file, "0".repeat(privateKey.length))
        return { privateKey, publicKey: readFileSync(`${file}.pub`, "utf8").trim() }
    })

/** The host keys a server offers, as known_hosts lines (`[host]:port` for a port other than 22). */
export const keyscan = async (host: string, port: number, types: readonly string[], timeoutSeconds: number): Promise<string> => {
    const run = await captureTool("ssh-keyscan", ["-T", String(timeoutSeconds), "-p", String(port), "-t", types.join(","), host], tmpdir(), { timeoutMs: (timeoutSeconds + 5) * 1000 })
    const lines = run.stdout.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith("#"))
    if (lines.length === 0) throw new Refusal("VPS_KEYSCAN_EMPTY", `${host}:${String(port)} offered no host key (${headline(run.stderr) || "no answer"})`)
    return `${lines.join("\n")}\n`
}

/** The SHA256 fingerprints of known_hosts lines, one `type fingerprint` per key, to confirm against the provider's console. */
export const fingerprints = async (knownHosts: string): Promise<string[]> =>
    withPrivateDir(async (dir) => {
        const file = join(dir, "known_hosts")
        writePrivate(file, knownHosts)
        const run = await captureTool("ssh-keygen", ["-l", "-E", "sha256", "-f", file], dir)
        if (run.exitCode !== 0) throw new Refusal("VPS_KEYSCAN_INVALID", `ssh-keygen cannot read the scanned keys: ${headline(run.stderr)}`)
        return run.stdout
            .split(/\r?\n/)
            .filter((line) => line.trim() !== "")
            .map((line) => {
                const parts = line.trim().split(/\s+/)
                return `${(parts.at(-1) ?? "").replace(/[()]/g, "")} ${parts[1] ?? ""}`
            })
    })
