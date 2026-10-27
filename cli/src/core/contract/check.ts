import { resolve } from "node:path"
import { contextTokens, contractHash, contractProblems, readContract, resolveChecks, resolveContract } from "../../harness/contract.js"
import { loadOps } from "../../harness/ops.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

interface ContractCheckData {
    readonly file: string
    readonly hash: string
    readonly label: string
    readonly fit: boolean
    readonly problems: readonly string[]
    readonly checks: readonly { readonly name: string; readonly kind: string; readonly tier: string; readonly behavioural: boolean }[]
    readonly context: readonly { readonly entry: string; readonly source: string; readonly shared: boolean }[]
    readonly contextTokens: { readonly tokens: number; readonly budget: number | null; readonly unmeasured: readonly string[] } | null
    readonly output: readonly { readonly key: string; readonly type: string; readonly source: string }[]
}

/**
 * `starci contract check <file>`: is this contract fit to send: schema, known label and presets, concrete allowPaths, every item
 * of its op's base kept and none loosened, its harness context files present and within the op's token budget, and a
 * behavioural (harness-observed, T0 or T1) check where the op needs one.
 */
export const contractCheckVerb = defineVerb({
    path: ["contract", "check"],
    summary: "judge whether a contract is fit to send: schema, label, presets, concrete allowPaths, its op's base kept, the context budget, a harness-observed behavioural check",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/contract-check@1",
    flags: {
        file: { kind: "string", summary: "the contract json file", required: true, positional: true },
    },
    run: (context, flags) => {
        const file = resolve(context.cwd, flags.file)
        const ops = loadOps()
        const contract = readContract(file)
        const problems = contractProblems(contract, ops)
        const checks = problems.length === 0 ? resolveChecks(contract, ops).map((check) => ({ name: check.name, kind: check.check.kind, tier: check.tier, behavioural: check.behavioural })) : []
        const resolved = problems.length === 0 ? resolveContract(contract, ops) : undefined
        const files = (resolved?.context ?? []).map((item) => ({ entry: item.entry, source: item.source, shared: item.shared }))
        const measured = resolved === undefined ? undefined : contextTokens(resolved, ops, context.cwd)
        const tokens = resolved === undefined || measured === undefined ? null : { tokens: measured.tokens, budget: resolved.op.context.budget ?? null, unmeasured: measured.unmeasured }
        const output = (resolved?.output ?? []).map((item) => ({ key: item.key, type: item.spec.type, source: item.source }))
        const data: ContractCheckData = { file, hash: contractHash(contract), label: contract.label, fit: problems.length === 0, problems, checks, context: files, contextTokens: tokens, output }
        const problemLines = problems.map((problem) => `- ${problem}`).join("\n")
        const limit = tokens?.budget ?? null
        const budget = limit === null ? "" : ` of ${String(limit)}`
        const weight = tokens === null ? "" : ` (~${String(tokens.tokens)} tokens${budget})`
        const message = data.fit
            ? `fit: ${String(files.length)} context file(s)${weight}, ${String(output.length)} output key(s), ${String(checks.length)} check(s), ${String(checks.filter((check) => check.behavioural).length)} behavioural; hash ${data.hash.slice(0, 12)}`
            : `unfit:\n${problemLines}`
        return Promise.resolve({ data, message, exitCode: data.fit ? 0 : 1 })
    },
})
