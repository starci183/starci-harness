import { z } from "zod"
import { hostAgeIdentity, lookupSecret, secretHome } from "../../harness/secret-env.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, NUMBER, QUIET_FLAG, runHfs } from "./hfs.js"

/** The flags @starci/hfs takes: everything but `--from-host`, which the CLI resolves itself. */
const HFS_FLAGS = {
    action: { kind: "string", summary: "init, set, get, unset, rename, remove, materialize, list, verify, recipients, migrate, split or audit", required: true, positional: true },
    env: { kind: "string", summary: "the environment of .starcistacks", positional: true },
    slug: { kind: "string", summary: "the sealed member: one per provider or service, <member>.enc.yaml", positional: true },
    keys: { kind: "rest", summary: "the keys inside the member: set seals one or more in one write; get and unset take one; rename takes OLD NEW" },
    generate: { kind: "string", summary: "generate this many random bytes per key for set instead of prompting or reading stdin" },
    "to-file": { kind: "boolean", summary: "write one private file per KEY outside the repository" },
    reveal: { kind: "boolean", summary: "explicitly print decrypted values for get" },
    execute: { kind: "boolean", summary: "apply the edit instead of only reporting what unset, rename, remove, migrate or split would do" },
    "from-file": { kind: "list", summary: "set: KEY=path, the key's value read byte for byte from the file (a multi-line key, its trailing newline kept), once per key" },
    to: { kind: "string", summary: "migrate: the member's new name (a legacy member named otherwise than its provider, or an existing member with --into-existing)" },
    group: { kind: "list", summary: "split: KEY=member, the member this key goes to instead of its first word's, once per key" },
    "group-file": { kind: "string", summary: "split: a YAML map of KEY: member, read as one --group per entry" },
    "into-existing": { kind: "boolean", summary: "migrate and split: merge into a member that already exists; a key it holds with another value refuses the move, naming the key" },
    add: { kind: "list", summary: "recipients: a public age recipient (age1...) or owner, added to the environment's rule, once per recipient" },
    remove: { kind: "list", summary: "recipients: a public age recipient or owner, removed from the environment's rule, once per recipient" },
    "force-nonempty": { kind: "boolean", summary: "let remove delete a member that still holds keys" },
    ...QUIET_FLAG,
} as const satisfies Readonly<Record<string, FlagSpec>>

const FLAGS = {
    ...HFS_FLAGS,
    "from-host": { kind: "string", summary: "set: seal the value of this host key (policy/security.yaml secretKeys, read from secret.env) instead of prompting or reading stdin" },
} as const satisfies Readonly<Record<string, FlagSpec>>

const CHOICES = {
    action: z.enum(["init", "set", "get", "unset", "rename", "remove", "materialize", "list", "verify", "recipients", "migrate", "split", "audit"]),
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
 * `set` on a terminal prompts for each key with masked input; redirected stdin gives one key's value, or one `KEY=value` line per
 * key; every key of one `set` is sealed in one write. The age identity is the environment's, else the app's `.claude/secret.env`,
 * else the harness secret.env's SOPS_AGE_KEY. `set --from-host <HOST_KEY>` copies a host key into the app's sealed member: the
 * CLI reads it through the secret loader and hands it to @starci/hfs as the stdin `set` would read, so the value never reaches
 * the shell, an argument, output or evidence.
 */
export const appSecretVerb = defineVerb({
    path: ["app", "secret"],
    summary: "initialize, seal, edit, materialize, verify, migrate, split and audit app secrets: one <member>.enc.yaml per provider or owner group, set prompts masked and seals several keys in one write, recipients manages .sops.yaml",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-secret@1",
    flags: FLAGS,
    run: (context, flags) => {
        const { "from-host": fromHost, ...rest } = flags
        const argv = hfsArgv(HFS_FLAGS, rest, CHOICES)
        const extra = { hostIdentity: hostAgeIdentity() }
        if (fromHost === undefined) return runHfs(context, "secret", argv, false, undefined, extra)
        if (rest.action !== "set") throw new UsageError("--from-host is only valid for set")
        if (rest.generate !== undefined) throw new UsageError("--from-host and --generate each give set its value; pass one")
        if (rest.keys.length !== 1) throw new UsageError("--from-host seals one key; name exactly one")
        const value = hostValue(fromHost)
        return runHfs(context, "secret", argv, false, () => value, extra)
    },
})
