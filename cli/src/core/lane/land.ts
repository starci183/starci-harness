import { join, resolve } from "node:path"
import { mainCheckout } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import { holdLander, landPaths, lanesDir, releaseLockFile, touchLander } from "../../harness/land-queue.js"
import { runBatch } from "../../harness/land-batch.js"
import type { BatchRecord } from "../../harness/land-batch.js"
import { loadSlotRules, slotKind } from "../../harness/slots.js"

/** How long an idle lander waits before it reads the ready set again. */
const POLL_MS = 30_000

/**
 * `starci lane land`: the one lander of an app's dev (contexts/project/branches.md PROJECT-BRANCH-2). Each loop takes every ready
 * lane, merges them in its own worktree, runs one `app check --env prod` and pushes dev through `app push`; a red batch drops the
 * lanes its findings name and runs once more, never bisecting. `--once` runs one batch; `--dry-run` merges only.
 */
export const laneLandVerb = defineVerb({
    path: ["lane", "land"],
    summary: "run the batch lander of dev: merge every ready lane in its own worktree, one app check --env prod, push dev; red drops the lanes its findings name and re-gates once, never bisects",
    effect: "remote",
    roles: ["owner", "coordinator", "lead", "release"],
    schema: "starci/lane-land@1",
    flags: {
        dir: { kind: "string", summary: "the lanes folder (default: STARCI_LANES_DIR)" },
        worktree: { kind: "string", summary: "the lander's own worktree (default: <lanes>/_batch-lander)" },
        migrations: { kind: "string", summary: "the folder whose added files a landed lane is told to apply (default: db/migrations/)" },
        once: { kind: "boolean", summary: "run one batch and stop" },
        "dry-run": { kind: "boolean", summary: "merge the ready lanes and report conflicts; no gate, no push, no status written" },
    },
    run: async (context, flags) => {
        const dir = lanesDir(flags.dir)
        const dryRun = flags["dry-run"]
        // The gate and npm slots of the lanes folder the lander may take: the counts of ops/slots.yaml, never its burst.
        const rules = loadSlotRules()
        const options = {
            dir, dryRun, say: context.progress, gateSlots: slotKind(rules, "gate").count, npmSlots: slotKind(rules, "npm").count,
            repo: await mainCheckout(context.cwd),
            worktree: resolve(flags.worktree ?? join(dir, dryRun ? "_batch-lander-dry" : "_batch-lander")),
            migrations: flags.migrations ?? "db/migrations/",
        }
        if (!dryRun) holdLander(dir)
        // The heartbeat: the lock's mtime moves every poll, through long gates too (the batch steps are async), so `lane status` tells a
        // live lander from a hung or killed one.
        const heartbeat = dryRun ? undefined : setInterval(() => {
            touchLander(landPaths(dir).lander)
        }, POLL_MS)
        heartbeat?.unref()
        const batches: BatchRecord[] = []
        try {
            for (;;) {
                const record = await runBatch(options)
                if (record !== undefined) batches.push(record)
                if (flags.once || dryRun) break
                await new Promise((settle) => setTimeout(settle, record === undefined ? POLL_MS : 1000))
            }
        } finally {
            clearInterval(heartbeat)
            if (!dryRun) releaseLockFile(landPaths(dir).lander, process.pid)
        }
        const message = batches.length === 0 ? "no lane is ready" : batches.map((batch) => `batch ${batch.batch}: ${batch.outcome}`).join("\n")
        return { data: { batches }, message }
    },
})
