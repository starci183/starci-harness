import { WRITERS, defineVerb } from "../../shared/verb.js"
import type { VerbResult } from "../../shared/verb.js"
import { repositoryRoot } from "../../shared/git.js"
import { lanesDir } from "../../harness/lane-state.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import { watchDevCi } from "../../harness/dev-ci-watch.js"

/** `starci lane ci-watch <sha>`: follow the GitHub CI of a dev commit a landing pushed and write its verdict; a landing starts it detached. */
export const laneCiWatchVerb = defineVerb({
    path: ["lane", "ci-watch"],
    summary: "follow the GitHub CI runs of a dev commit a landing pushed (gh run list --commit) until they settle or ciWatch.minutes (45) passes, then write the verdict (green, red, superseded, pending, none, unreadable) into <lanes>/_land-status/_dev-ci/<sha>.json and the ci of each landed lane's status; a red one is printed loudly and sent to ciWatch.notifySession of the local settings (claude -p --resume) when set. Never reverts, blocks or pushes dev. lane gate --land starts it detached after each landing",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/lane-ci-watch@1",
    flags: {
        sha: { kind: "string", summary: "the dev commit to follow", positional: true },
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR)" },
        lanes: { kind: "string", summary: "the lanes the commit landed, comma-separated (their status files get the verdict)" },
        minutes: { kind: "string", summary: "the time limit in minutes (default ciWatch.minutes)" },
    },
    run: async (context, flags): Promise<VerbResult<unknown>> => {
        const sha = flags.sha ?? ""
        if (!/^[0-9a-f]{7,40}$/u.test(sha)) return { data: null, message: "name the dev commit: starci lane ci-watch <sha>", exitCode: 2 }
        const settings = loadLocalSettings().ciWatch
        const limit = flags.minutes === undefined ? settings.minutes : Number(flags.minutes)
        if (!Number.isFinite(limit) || limit <= 0) return { data: null, message: `--minutes ${flags.minutes ?? ""} is no positive number`, exitCode: 2 }
        const lanes = (flags.lanes ?? "").split(",").map((lane) => lane.trim()).filter((lane) => lane !== "")
        const verdict = await watchDevCi({ root: await repositoryRoot(context.cwd), dir: lanesDir(flags.dir), sha, lanes, limitMs: limit * 60_000, ...(settings.notifySession === undefined ? {} : { notifySession: settings.notifySession }), say: context.progress })
        return { data: verdict, message: `dev CI of ${sha.slice(0, 10)}: ${verdict.state} (${verdict.reason})`, ...(verdict.state === "red" ? { exitCode: 1 } : {}) }
    },
})
