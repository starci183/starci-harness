import { relative } from "node:path"
import { runsJest } from "../../harness/coverage-scope.js"
import { heavyCommand, prepareSuite } from "../../harness/run-checks.js"
import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { evidenceTail } from "../../shared/output.js"
import { redactSecrets } from "../../shared/secrets.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"

/** The suite a live spec runs under when `--run` names none: the e2e project, which boots the test world. */
const DEFAULT_RUN = "npm run test:e2e"

interface LiveData {
    readonly argv: readonly string[]
    readonly cwd: string
    /** What the run was made of: the spec files it runs by path and where each custody key came from (names only). */
    readonly lead: readonly string[]
    /** The live-provider spec files the run holds (`useSandbox`), relative to the checkout. */
    readonly live: readonly string[]
    /** The custody key names handed to the run's environment; never a value. */
    readonly keys: readonly string[]
    readonly exitCode: number | null
    readonly timedOut: boolean
    readonly verdict: "passed" | "failed"
    /** The tail of what the run printed, every handed value scrubbed. */
    readonly output: string
}

/**
 * `starci test live <spec...>`: a worker's run of a live-provider suite, made exactly as the harness's command check makes it
 * (harness/run-checks.ts `prepareSuite`): the suite command (`--run`, default `npm run test:e2e`) runs the named spec files by
 * path, and when they hold a `useSandbox` spec the keys its world declares are read from the app's custody and handed to that one
 * child process, under a heavy-command slot, with every value scrubbed from its output. The worker never sees a value. Refuses
 * CUSTODY_KEY_MISSING (a declared key no sealed member holds, or holds empty), CUSTODY_UNREADABLE and CUSTODY_KEYS_UNRESOLVED
 * before anything runs, and VERIFY_INFRA when the run still reports a key custody holds as not declared; red (exit 1) when the
 * suite fails.
 */
export const testLiveVerb = defineVerb({
    path: ["test", "live"],
    summary: "run a live-provider suite (useSandbox specs) the way the harness verifies it: the declared keys come from the app's custody into that one run's environment, never shown; its output is scrubbed; red when the suite fails",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/test-live@1",
    flags: {
        spec: { kind: "rest", summary: "the spec files or folders to run, relative to the folder the suite's jest runs in or to the working directory", required: true },
        run: { kind: "string", summary: `the suite command that runs jest, split at blanks with no shell (default "${DEFAULT_RUN}")` },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const command = (flags.run ?? DEFAULT_RUN).split(/\s+/).filter((part) => part !== "")
        if (!runsJest(command, context.cwd)) throw new Refusal("TEST_LIVE_NOT_JEST", `${command.join(" ")} does not run jest from ${context.cwd}; name the suite command that does with --run`)
        const named = [...command, ...(command.includes("--") ? [] : ["--"]), ...flags.spec]
        const prepared = await prepareSuite(named, { root, cwd: context.cwd }, [], {})
        if ("problem" in prepared) throw new Refusal("TEST_LIVE_NO_SPEC", prepared.problem)
        const run = await heavyCommand(prepared.argv, context.cwd, prepared.given)
        const verdict = run.exitCode === 0 ? "passed" : "failed"
        const output = redactSecrets(evidenceTail(run.stdout, run.stderr))
        const keys = Object.keys(prepared.given.custody?.env ?? {}).sort((left, right) => left.localeCompare(right))
        const custody = keys.length === 0 ? ["no live-provider spec in the run: no custody key handed"] : []
        const data: LiveData = {
            argv: prepared.argv,
            cwd: context.cwd,
            lead: [...prepared.lead, ...custody],
            live: prepared.live.map((file) => relative(root, file).replaceAll("\\", "/")),
            keys,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            verdict,
            output,
        }
        const ran = `${prepared.argv.join(" ")} exited ${String(run.exitCode)} (${verdict})${run.timedOut ? ", killed at the deadline" : ""}`
        return { data, message: [...data.lead, ran, output].join("\n"), exitCode: verdict === "passed" ? 0 : 1 }
    },
})
