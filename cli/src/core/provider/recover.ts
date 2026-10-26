import { recoverProvider } from "../../harness/circuit.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/** `starci provider recover <provider>`: closes a provider's circuit by hand once a probe passed; who and why are kept. */
export const providerRecoverVerb = defineVerb({
    path: ["provider", "recover"],
    summary: "close a provider's circuit after a passing probe (owner or Supervisor); strikes reset, the reason is kept as an event",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "supervisor"],
    schema: "starci/provider-recover@1",
    flags: {
        provider: { kind: "string", summary: "the provider (claude, codex, devin, ...)", required: true, positional: true },
        by: { kind: "string", summary: "who recovers it: owner or supervisor", required: true },
        reason: { kind: "string", summary: "why: the probe that passed, or the fix", required: true },
    },
    run: (_context, flags) => {
        if (flags.by !== "owner" && flags.by !== "supervisor") throw new Refusal("CLI_USAGE", `--by is owner or supervisor, not "${flags.by}"`, EXIT_USAGE)
        const changed = recoverProvider(flags.provider, flags.by, flags.reason)
        const was = changed.before.open ? `open (${changed.before.failureKind ?? "?"}) until ${changed.before.openUntil ?? "?"}` : changed.before.status
        return Promise.resolve({ data: changed, message: `provider ${flags.provider}: ${was} -> ${changed.after.status}` })
    },
})
