import { existsSync, readFileSync } from "node:fs"
import { Refusal } from "../../shared/errors.js"
import { runtimeRoot } from "../ledger.js"
import { hostAgeIdentity } from "../secret-env.js"

/**
 * The sealed files of the managed fleet: a server's `<id>.enc.yaml` and the owner's `cloudflare.enc.yaml`, sops YAML sealed to the
 * owner key alone (SOPS_AGE_KEY, the harness secret.env), through the same sops seam `starci app secret` seals an app member with
 * (@starci/hfs secret-store `writeSecret`, secret-sops `defaultSops`). Values are opened in memory and handed to the caller only.
 */

/** The keys a server's sealed file holds; the login names are those of PROJECT-STACKS-5 (SEALED_SSH_KEYS of @starci/hfs stack/remote). */
export const SERVER_KEYS = { user: "VPS_USER", privateKey: "privateKey", knownHosts: "knownHosts", tunnelId: "tunnelId", tunnelToken: "tunnelToken" } as const

/** The keys of the owner's Cloudflare file. */
export const CLOUDFLARE_KEYS = { token: "apiToken", account: "accountId" } as const

/** The sealed store: opens a file into its key map, and writes named keys into one (merging what it holds). */
export interface SealedStore {
    readonly open: (file: string) => Readonly<Record<string, string>>
    readonly write: (file: string, values: Readonly<Record<string, string>>) => void
}

interface Sops {
    readonly decrypt: (file: string, format: string) => Record<string, string>
}

const reason = (error: unknown): string => (error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : "sops refused")

/** The owner-key store of this harness checkout (the sops binary on PATH, the owner identity found as `app secret` finds it). */
export const ownerStore = async (): Promise<SealedStore> => {
    const root = runtimeRoot()
    const identity = hostAgeIdentity(root)
    const { defaultSops } = await import("@starci/hfs/runtime/scripts/hfs/secret-sops.mjs")
    const { writeSecret } = await import("@starci/hfs/runtime/scripts/hfs/secret-store.mjs")
    const { ownerRecipient } = await import("@starci/hfs/runtime/scripts/hfs/secret-init.mjs")
    const sops = (): Sops => defaultSops(process.env, root, process.platform, undefined, identity) as Sops
    return {
        open: (file) => {
            if (!existsSync(file)) throw new Refusal("VPS_SEALED_MISSING", `${file} does not exist`)
            try {
                return sops().decrypt(file, "yaml")
            } catch (error: unknown) {
                throw new Refusal("VPS_SEALED_UNREADABLE", `${file} cannot be opened with the owner key (${identity.label}): ${reason(error)}`)
            }
        },
        write: (file, values) => {
            let recipient: string
            try {
                recipient = ownerRecipient(root, process.env, { platform: process.platform, host: identity })
            } catch (error: unknown) {
                throw new Refusal("VPS_OWNER_KEY_MISSING", `the owner key is needed to seal ${file}: ${reason(error)}`)
            }
            try {
                writeSecret({ file, values: { ...values }, age: [recipient], sops: sops() })
            } catch (error: unknown) {
                throw new Refusal("VPS_SEAL_FAILED", `${file} could not be sealed: ${reason(error)}`)
            }
            if (!readFileSync(file, "utf8").includes("ENC[AES256_GCM,")) throw new Refusal("VPS_SEAL_FAILED", `${file} holds no sops envelope after the seal`)
        },
    }
}

/** A value of an opened sealed map, refused by name (never by value) when it is missing or empty. */
export const requireKey = (map: Readonly<Record<string, string>>, key: string, file: string): string => {
    const value = map[key]
    if (value === undefined || value.trim() === "") throw new Refusal("VPS_SEALED_KEY_MISSING", `${file} holds no ${key}`)
    return value
}
