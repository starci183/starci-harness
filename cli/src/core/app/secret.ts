import { z } from "zod"
import { lookupSecret, secretHome } from "../../harness/secret-env.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, NUMBER, QUIET_FLAG, runHfs } from "./hfs.js"

/** The flags @starci/hfs takes: everything but `--from-host`, which the CLI resolves itself. */
const HFS_FLAGS = {
    action: { kind: "string", summary: "init, set, get, unset, rename, remove, materialize, list or verify", required: true, positional: true },
    env: { kind: "string", summary: "the environment of .starcistacks", positional: true },
    slug: { kind: "string", summary: "the sealed member", positional: true },
    key: { kind: "string", summary: "the key inside the member", positional: true },
    "new-key": { kind: "string", summary: "rename: the key's new name", positional: true },
    generate: { kind: "string", summary: "generate this many random bytes for set instead of reading stdin" },
    "to-file": { kind: "boolean", summary: "write one private file per KEY outside the repository" },
    reveal: { kind: "boolean", summary: "explicitly print decrypted values for get" },
    execute: { kind: "boolean", summary: "apply the edit instead of only reporting what unset or rename or remove would do" },
    "force-nonempty": { kind: "boolean", summary: "let remove delete a member that still holds keys" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const FLAGS = {
    ...HFS_FLAGS,
    "from-host": { kind: "string", summary: "set: seal the value of this host key (policy/security.yaml secretKeys, read from secret.env) instead of reading stdin" },
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["init", "set", "get", "unset", "rename", "remove", "materialize", "list", "verify"]),
    generate: NUMBER,
} as const

/**
 * The value of `hostKey` from the harness's secret loader, which refuses a key `secretKeys` does not list; a listed key the
 * host has not set is refused HOST_SECRET_MISSING, naming where the owner sets it. The value is returned to the caller alone.
 */
const hostValue = (hostKey: string): string => {
    const secret = lookupSecret(hostKey)
    if (secret === undefined) throw new Refusal("HOST_SECRET_MISSING", `the host has no ${hostKey}: ${secretHome(hostKey)}, then run this again`)
    return secret.value
}

/**
 * `starci app secret`: initialize, seal, edit, materialize and verify app secrets; @starci/hfs runs it in-process in the app.
 * `set --from-host <HOST_KEY>` copies a host key into the app's sealed member: the CLI reads it through the secret loader and
 * hands it to @starci/hfs as the stdin `set` would read, so the value never reaches the shell, an argument, output or evidence.
 */
export const appSecretVerb = defineVerb({
    path: ["app", "secret"],
    summary: "initialize, seal, edit, materialize and verify app secrets; set --from-host seals a host key from secret.env",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-secret@1",
    flags: FLAGS,
    run: (context, flags) => {
        const { "from-host": fromHost, ...rest } = flags
        const argv = hfsArgv(HFS_FLAGS, rest, CHOICES)
        if (fromHost === undefined) return runHfs(context, "secret", argv, false)
        if (rest.action !== "set") throw new UsageError("--from-host is only valid for set")
        if (rest.generate !== undefined) throw new UsageError("--from-host and --generate each give set its value; pass one")
        const value = hostValue(fromHost)
        return runHfs(context, "secret", argv, false, () => value)
    },
})
