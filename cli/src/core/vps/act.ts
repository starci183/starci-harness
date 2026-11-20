import { runPlan, runSteps, sessionFor } from "../../harness/vps/fleet.js"
import type { StepOutcome } from "../../harness/vps/fleet.js"
import { publicKeyOf } from "../../harness/vps/local.js"
import { bootstrapPlan, swarmInitPlan, uiUpPlan } from "../../harness/vps/plan.js"
import { ownerStore, requireKey, SERVER_KEYS } from "../../harness/vps/sealed.js"
import { headline } from "../../shared/exec.js"
import { defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { EXECUTE, OWNER, pinsOf, planResult, requireAction, scopeOf, SERVER_ID } from "./shared.js"
import type { VpsData } from "./shared.js"

/**
 * `starci vps bootstrap <id> [--execute]`: brings a server to ops/vps.yaml. After the ops user exists, the CLI logs in again as
 * that user with the sealed key and checks `sudo -n`; only then sshd turns password login off and the sealed login becomes the
 * ops user. Every step is idempotent: a second run changes nothing.
 */
export const vpsBootstrapVerb = defineVerb({
    path: ["vps", "bootstrap"],
    summary: "bring a managed server to ops/vps.yaml: ops user (key only, sudo), sshd hardening, firewall with only 80/443/ssh open, fail2ban or CSF lfd, automatic security updates, Docker at its pin; a dry run until --execute, idempotent",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-bootstrap@1",
    flags: { id: SERVER_ID, execute: EXECUTE },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        const scope = scopeOf(flags.id)
        const plan = bootstrapPlan(scope.policy, scope.server, pinsOf(scope))
        if (!flags.execute) return planResult(plan, undefined)
        const store = await ownerStore()
        const sealed = store.open(scope.server.sealedFile)
        const secrets = { OPS_PUBLIC_KEY: await publicKeyOf(requireKey(sealed, SERVER_KEYS.privateKey, scope.server.sealedFile)) }
        const split = plan.steps.findIndex((step) => step.id === "ops-user") + 1
        const first = await runPlan(scope.policy, scope.server, store, { ...plan, steps: plan.steps.slice(0, split) }, secrets, context.progress)
        if (first.some((outcome) => outcome.outcome === "failed")) return planResult(plan, first)
        // The ops user must log in with the sealed key and use sudo before password login is turned off.
        const opsUser = scope.policy.bootstrap.opsUser
        const check = await sessionFor(scope.policy, scope.server, store, opsUser)
        let rest: StepOutcome[]
        try {
            const probe = await check.run({ script: "sudo -n true && echo unchanged", root: false, timeoutMs: scope.policy.ssh.connectTimeoutSeconds * 3000 })
            if (probe.exitCode !== 0) return planResult(plan, [...first, { id: "ops-login", outcome: "failed", detail: `${opsUser} cannot log in with the sealed key or use sudo: ${headline(probe.stderr) || `exit ${String(probe.exitCode)}`}` }])
            context.progress(`ops-login: ${opsUser} logs in with the sealed key and uses sudo`)
            rest = await runSteps(scope.policy, check, plan.steps.slice(split), secrets, context.progress)
        } finally {
            check.close()
        }
        const outcomes = [...first, { id: "ops-login", outcome: "unchanged" as const, detail: "" }, ...rest]
        if (!rest.some((outcome) => outcome.outcome === "failed") && sealed[SERVER_KEYS.user] !== opsUser) {
            store.write(scope.server.sealedFile, { [SERVER_KEYS.user]: opsUser })
            return planResult(plan, outcomes, [`  the sealed login of ${scope.server.id} is now ${opsUser}`])
        }
        return planResult(plan, outcomes)
    },
})

/** `starci vps swarm init <id> [--execute]`: a one-manager swarm and the shared overlay network. */
export const vpsSwarmVerb = defineVerb({
    path: ["vps", "swarm"],
    summary: "`swarm init <id>`: make a managed server a one-manager Docker swarm advertised on its address, with the shared overlay network of ops/vps.yaml; a dry run until --execute, idempotent",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-swarm@1",
    flags: { action: { kind: "string", summary: "init", required: true, positional: true }, id: SERVER_ID, execute: EXECUTE },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        requireAction(flags.action, ["init"], "swarm")
        const scope = scopeOf(flags.id)
        const plan = swarmInitPlan(scope.policy, scope.server)
        if (!flags.execute) return planResult(plan, undefined)
        return planResult(plan, await runPlan(scope.policy, scope.server, await ownerStore(), plan, {}, context.progress))
    },
})

/** `starci vps ui up <id> [--execute]`: the Portainer stack, published on no port. */
export const vpsUiVerb = defineVerb({
    path: ["vps", "ui"],
    summary: "`ui up <id>`: deploy the Swarm UI (Portainer CE and its agent, digests pinned in contexts/stack/pins.yaml) on a managed server, published on no port; `vps domain add <id> <sub> --to ui` opens it through the tunnel; a dry run until --execute",
    effect: "remote",
    roles: OWNER,
    schema: "starci/vps-ui@1",
    flags: { action: { kind: "string", summary: "up", required: true, positional: true }, id: SERVER_ID, execute: EXECUTE },
    run: async (context, flags): Promise<VerbResult<VpsData>> => {
        requireAction(flags.action, ["up"], "ui")
        const scope = scopeOf(flags.id)
        const plan = uiUpPlan(scope.policy, scope.server, pinsOf(scope))
        if (!flags.execute) return planResult(plan, undefined)
        return planResult(plan, await runPlan(scope.policy, scope.server, await ownerStore(), plan, {}, context.progress))
    },
})
