import { recoverProvider } from "../../harness/circuit.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

/**
 * `starci provider recover <provider>`: the Supervisor's recorded close of a circuit after a probe it ran itself passed. A circuit
 * recovers on its own through its half-open probe and an ok usage reading; this verb is never part of normal operation.
 */
export const providerRecoverVerb = defineVerb({
    path: ["provider", "recover"],
    summary: "record the Supervisor's close of a provider's circuit after a probe it ran passed; circuits otherwise recover by their own half-open probe",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["supervisor"],
    schema: "starci/provider-recover@2",
    flags: {
        provider: { kind: "string", summary: "the provider (claude, codex, devin, ...)", required: true, positional: true },
        reason: { kind: "string", summary: "the probe that passed", required: true },
    },
    run: (_context, flags) => {
        if (flags.reason.trim() === "") throw new Refusal("CLI_USAGE", "--reason names the probe that passed", EXIT_USAGE)
        const changed = recoverProvider(flags.provider, "supervisor", flags.reason)
        const was = changed.before.open ? `open (${changed.before.failureKind ?? "?"}) until ${changed.before.openUntil ?? "?"}` : changed.before.status
        return Promise.resolve({ data: changed, message: `provider ${flags.provider}: ${was} -> ${changed.after.status}` })
    },
})
