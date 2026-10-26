import { join, resolve } from "node:path"
import { contractHash, contractProblems, readContract, resolveChecks } from "../../harness/contract.js"
import { now, openLedger } from "../../harness/ledger.js"
import { loadOps } from "../../harness/ops.js"
import { runCheck } from "../../harness/run-checks.js"
import type { CheckOutcome } from "../../harness/run-checks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { formatTable } from "../../shared/output.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

interface VerifyData {
    readonly contract: string
    readonly hash: string
    readonly verdict: "green" | "red"
    readonly checks: readonly CheckOutcome[]
    readonly recorded: boolean
}

/** `starci task verify`: replays every expectedOutput check of a contract; only an all-green replay settles a task. */
export const taskVerifyVerb = defineVerb({
    path: ["task", "verify"],
    summary: "replay every expectedOutput check of a contract and give the verdict; --record files the runs in the ledger",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/task-verify@1",
    flags: {
        task: { kind: "string", summary: "a task id of the ledger (P1); use --contract until tasks are sent", positional: true },
        contract: { kind: "string", summary: "the contract json file to verify" },
        record: { kind: "boolean", summary: "file every check run in the ledger (.starciwork/runtime.sqlite)" },
    },
    run: async (context, flags) => {
        if (flags.contract === undefined) {
            throw new Refusal("TASK_NOT_SENT", flags.task === undefined ? "name the contract: starci task verify --contract <file>" : "tasks are sent from P1; verify a contract file with --contract for now")
        }
        const file = resolve(context.cwd, flags.contract)
        const ops = loadOps()
        const contract = readContract(file)
        const problems = contractProblems(contract, ops)
        if (problems.length > 0) throw new Refusal("CONTRACT_UNFIT", `the contract is not fit to verify:\n${problems.join("\n")}`)
        const root = await repositoryRoot(context.cwd)
        const place = { root, cwd: join(root, contract.context.cwd ?? ".") }
        const checks: CheckOutcome[] = []
        for (const check of resolveChecks(contract, ops)) checks.push(await runCheck(check, contract, place))
        const verdict = checks.every((check) => check.status === "green") ? "green" : "red"
        const hash = contractHash(contract)
        if (flags.record) {
            const db = openLedger(root)
            const insert = db.prepare("INSERT INTO check_runs (task_id, attempt_id, contract_hash, name, runner, status, exit_code, detail, ran_at) VALUES (?, NULL, ?, ?, 'harness', ?, ?, ?, ?)")
            const at = now()
            for (const check of checks) insert.run(flags.task ?? null, hash, check.name, check.status, check.exitCode, check.detail, at)
            db.prepare("INSERT INTO events (at, kind, subject, data_json) VALUES (?, 'task-verified', ?, ?)").run(at, hash, JSON.stringify({ verdict, contract: file }))
            db.close()
        }
        const data: VerifyData = { contract: file, hash, verdict, checks, recorded: flags.record }
        const table = formatTable([["CHECK", "KIND", "STATUS"], ...checks.map((check) => [check.name, check.kind, check.status])])
        const reds = checks.filter((check) => check.status === "red").map((check) => `--- ${check.name}\n${check.detail}`)
        return { data, message: [table, `verdict: ${verdict}`, ...reds].join("\n"), exitCode: verdict === "green" ? 0 : 1 }
    },
})
