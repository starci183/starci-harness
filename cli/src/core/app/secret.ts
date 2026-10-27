import { z } from "zod"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import type { FlagSpec } from "../../shared/verb.js"
import { hfsArgv, NUMBER, QUIET_FLAG, runHfs } from "./hfs.js"

const FLAGS = {
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

const CHOICES = {
    action: z.enum(["init", "set", "get", "unset", "rename", "remove", "materialize", "list", "verify"]),
    generate: NUMBER,
} as const

/** `starci app secret`: initialize, seal, edit, materialize and verify app secrets; @starci/hfs runs it in-process in the app. */
export const appSecretVerb = defineVerb({
    path: ["app", "secret"],
    summary: "initialize, seal, edit, materialize and verify app secrets",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/app-secret@1",
    flags: FLAGS,
    run: (context, flags) => runHfs(context, "secret", hfsArgv(FLAGS, flags, CHOICES), false),
})
