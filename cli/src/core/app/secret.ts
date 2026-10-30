import { lookupSecret, secretHome } from "../../harness/secret-env.js"
import { Refusal, UsageError } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"
import { argValue, FORWARDED, leadingOperands, runHfs, withoutArg } from "./hfs.js"

/** The one flag the CLI takes out of `app secret set` and resolves itself, so @starci/hfs never sees it. */
const FROM_HOST = "from-host"

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
 * else the harness secret.env's SOPS_AGE_KEY. `set --env <env> <slug> <KEY> --from-host <HOST_KEY>` copies a host key into the app's
 * sealed member: the CLI takes the flag out, reads the key through the secret loader and hands it to @starci/hfs as the stdin `set`
 * would read, so the value never reaches the shell, an argument, output or evidence. `server-key --env <env>` makes the deploy server's
 * own age identity on the server, through the deploy's ssh transport, and seals the environment to it beside the owner key
 * (@starci/hfs `stack/server-key.mjs`).
 */
export const appSecretVerb = defineVerb({
    path: ["app", "secret"],
    summary: "initialize, seal, edit, materialize, verify, migrate, split and audit app secrets: one <member>.enc.yaml per provider or owner group, set prompts masked and seals several keys in one write, recipients manages .sops.yaml, server-key makes the deploy server's identity on the server and seals the environment to it",
    editions: BOTH_EDITIONS,
    effect: "remote",
    roles: ["owner", "supervisor"],
    schema: "starci/app-secret@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => {
        const fromHost = argValue(flags.args, FROM_HOST)
        if (fromHost === undefined) return runHfs(context, "secret", flags.args, false)
        const args = withoutArg(flags.args, FROM_HOST)
        const [action, , ...keys] = leadingOperands(withoutArg(args, "env"))
        if (action !== "set") throw new UsageError("--from-host is only valid for set")
        if (argValue(args, "generate") !== undefined) throw new UsageError("--from-host and --generate each give set its value; pass one")
        if (keys.length !== 1) throw new UsageError("--from-host seals one key; name exactly one (set --env <env> <slug> <KEY> --from-host <HOST_KEY>)")
        const value = hostValue(fromHost)
        return runHfs(context, "secret", args, false, () => value)
    },
})
