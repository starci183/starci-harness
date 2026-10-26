import { existsSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Contract } from "../../harness/contract.js"
import { loadOps } from "../../harness/ops.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot, resolveSha } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb } from "../../shared/verb.js"

const DEFAULT_MINUTES = 60

const DEFAULT_TRIES = 3

/** `starci contract new`: writes a contract with the label's default checks; the writer adds the behavioural checks the task needs. */
export const contractNewVerb = defineVerb({
    path: ["contract", "new"],
    summary: "write a contract for one task with its label's default checks; add the behavioural checks before sending it",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: ["owner", "kernel", "supervisor", "agent"],
    schema: "starci/contract-new@1",
    flags: {
        label: { kind: "string", summary: "the worker label (code, test, ui, verify, uat, docs, deliver)", required: true },
        summary: { kind: "string", summary: "what the task must do, in one sentence", required: true },
        allow: { kind: "string", summary: "comma-separated repository paths the task may write", required: true },
        base: { kind: "string", summary: "the base revision (default: HEAD)" },
        out: { kind: "string", summary: "the file to write (default: contract.json)" },
        force: { kind: "boolean", summary: "overwrite an existing file" },
    },
    run: async (context, flags) => {
        const ops = loadOps()
        const label = ops.labels[flags.label]
        if (label === undefined) throw new Refusal("CONTRACT_UNKNOWN_LABEL", `unknown label ${flags.label}; labels: ${Object.keys(ops.labels).join(", ")}`)
        const root = await repositoryRoot(context.cwd)
        const out = resolve(context.cwd, flags.out ?? "contract.json")
        if (existsSync(out) && !flags.force) throw new Refusal("CONTRACT_EXISTS", `${out} exists; pass --force to overwrite`)
        const contract: Contract = {
            schema: "starci/contract@1",
            label: flags.label,
            context: { base: await resolveSha(root, flags.base ?? "HEAD"), allowPaths: flags.allow.split(",").map((path) => path.trim()).filter((path) => path !== "") },
            input: { summary: flags.summary },
            expectedOutput: { checks: label.defaultChecks.map((preset) => ({ preset })) },
            budget: { minutes: DEFAULT_MINUTES, tries: DEFAULT_TRIES },
        }
        writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`)
        const note = label.requireBehavioural ? `; label ${flags.label} needs a behavioural check (tests-pass, json-required, probe or a command) before it is fit` : ""
        return { data: { file: out, contract }, message: `wrote ${out} with ${String(label.defaultChecks.length)} default check(s)${note}` }
    },
})
