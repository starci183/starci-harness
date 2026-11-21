import { hostUp, loadHost, selectServices } from "../../harness/host.js"
import { UsageError } from "../../shared/errors.js"
import type { VerbResult } from "../../shared/verb.js"
import { defineVerb } from "../../shared/verb.js"
import { machineUp } from "./machine.js"
import type { MachineUp } from "./machine.js"

const describeUp = (up: MachineUp): string => {
    const head = `host up ${up.machine} (${up.status.roles.join(", ")})${up.execute ? "" : ": dry run (add --execute to apply)"}`
    const engine = up.status.engine === null ? [] : [`  ${up.status.engine}`]
    const unreached = up.status.reached ? [] : [`  NOT REACHED: ${up.status.error ?? "no answer"}`]
    const lines = up.plan.map((step, index) => {
        const outcome = up.outcomes[index]
        const done = up.execute && outcome !== undefined ? ` -> ${outcome.outcome}${outcome.detail === step.detail ? "" : `: ${outcome.detail}`}` : ""
        return `  ${step.id}: ${step.action} (${step.detail})${step.rollback === null || up.execute ? "" : `\n      rollback: ${step.rollback}`}${done}`
    })
    return [head, ...engine, ...unreached, ...lines].join("\n")
}

/**
 * `starci host up [ids] [--stack <name>]`: starts every named service, or every service of the stack (and what it requires), that is down, in
 * requires order; idempotent. `starci host up --host <name> [--execute]`: the role-driven verb (contexts/harness/host.md "Roles"): plans the
 * union of the services the machine's roles turn on (config.yaml) and, with --execute, adopts what runs under another name, deploys what is
 * missing and updates an owned service its deployer would render otherwise, each with its rollback, under one writer per host.
 */
export const hostUpVerb = defineVerb({
    path: ["host", "up"],
    summary: "start the host services of ops/host.yaml that are down, each after what it requires; one already up is left alone. With --host <name>: plan the union of the services that machine's roles turn on (ops/host-roles.yaml, config.yaml) and with --execute bring each missing one up through its deployer, and update an owned running one whose deployer would render it otherwise (config drift) or whose pinned images moved through the same deployer; wait for its health and roll it back when it never turns healthy; a service running under another name is adopted, never redeployed or restarted, its drift only reported; no app stack is touched; one writer per host (HOST_BUSY)",
    effect: "host",
    roles: ["owner"],
    schema: "starci/host-up@1",
    flags: {
        ids: { kind: "rest", summary: "the services to bring up, with what they require (default every service)" },
        stack: { kind: "string", summary: "only the services of this stack of ops/host.yaml (starci: the shared SonarQube, its tunnel, the local npm registry and the embeddings gate and tunnel)" },
        host: { kind: "string", summary: "a machine of config.yaml (local, or one `starci vps add` registered): bring up the services its roles turn on" },
        execute: { kind: "boolean", summary: "with --host: apply the plan (default: a dry run that observes the machine and prints the plan)" },
        "no-rollback": { kind: "boolean", summary: "with --host --execute: keep a deployed service that never turned healthy, for inspection, instead of rolling it back" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        if (flags.host !== undefined) {
            if (flags.ids.length > 0 || flags.stack !== undefined) throw new UsageError("host up --host <name> brings up the machine's role services; it takes no service ids or --stack")
            const up = await machineUp(flags.host, context, { execute: flags.execute, rollback: !flags["no-rollback"] })
            const red = up.outcomes.some((outcome) => outcome.outcome === "failed" || outcome.outcome === "rolled back") || (up.execute && !up.status.reached)
            return { data: up, message: describeUp(up), ...(red ? { exitCode: 1 } : {}) }
        }
        if (flags.execute || flags["no-rollback"]) throw new UsageError("--execute and --no-rollback belong to host up --host <name>; host up of ops/host.yaml services runs as it always did")
        const config = loadHost()
        const outcomes = await hostUp(config, selectServices(config, flags.ids, flags.stack), context.cwd, context.progress)
        const red = outcomes.some((outcome) => outcome.outcome === "still down" || outcome.outcome === "blocked")
        return { data: { outcomes }, message: outcomes.map((outcome) => `${outcome.id}: ${outcome.outcome} (${outcome.evidence})`).join("\n"), ...(red ? { exitCode: 1 } : {}) }
    },
})
