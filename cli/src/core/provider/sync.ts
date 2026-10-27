import { readFileSync } from "node:fs"
import { recordMemberOutcomes } from "../../harness/outcomes.js"
import { loadRouting } from "../../harness/routing.js"
import { refreshUsage } from "../../harness/usage.js"
import { EXIT_USAGE, Refusal } from "../../shared/errors.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

// A reply saved by Windows PowerShell starts with a byte order mark, which JSON.parse refuses.
const BOM = String.fromCharCode(0xfeff)

/**
 * `starci provider sync`: reads each provider's usage now from Orca (`orca account list --json`, read-only), or from a saved
 * reply of it with --file, and records every window, each pool's binding quota and the auth evidence it carries; then records the
 * ended attempts of every registered ledger per member. A recorded pick does both on its own (usage once the last reading is
 * older than routing.yaml usage.refreshMinutes).
 */
export const providerSyncVerb = defineVerb({
    path: ["provider", "sync"],
    summary: "read provider usage from Orca's account list now (or a saved reply) into each pool's quota windows, and the ledgers' ended attempts into member outcomes",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor"],
    schema: "starci/provider-sync@1",
    flags: {
        file: { kind: "string", summary: "a saved `orca account list --json` reply to read instead of calling Orca" },
    },
    run: (_context, flags) => {
        let reply: unknown
        if (flags.file !== undefined) {
            try {
                reply = JSON.parse(readFileSync(flags.file, "utf8").replace(BOM, ""))
            } catch (error: unknown) {
                throw new Refusal("CLI_USAGE", `--file is not a readable json reply: ${error instanceof Error ? error.message : String(error)}`, EXIT_USAGE)
            }
        }
        const lines = refreshUsage({ force: true, reply }) ?? []
        const outcomes = recordMemberOutcomes(loadRouting())
        const message = [...(lines.length === 0 ? ["no provider of ops/routing.yaml is in the reply"] : lines), `member outcomes: ${String(outcomes)} ended attempt(s) of the registered ledgers recorded`]
        return Promise.resolve({ data: { lines, outcomes }, message: message.join("\n") })
    },
})
