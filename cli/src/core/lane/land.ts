import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { mainCheckout } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import { holdLander, landPaths, lanesDir, releaseLockFile, touchLander } from "../../harness/land-queue.js"
import { runBatch } from "../../harness/land-batch.js"
import type { BatchRecord } from "../../harness/land-batch.js"
import { loadSlotRules, slotKind } from "../../harness/slots.js"
import { landAutoSync } from "../../harness/land-dev-sync.js"
import { loadLocalSettings } from "../../harness/local-settings.js"
import { LANDER_OWN_INSTALL_ENV, landerHome, runningCliRoot } from "../../harness/lander-install.js"
import { listWorktrees } from "../../harness/worktree-remove.js"
import { cliPackageName, packageVersion } from "../version.js"

/** How long an idle lander waits before it reads the ready set again. */
const POLL_MS = 30_000

/**
 * `starci lane land`: the one lander of an app's dev (contexts/project/branches.md PROJECT-BRANCH-2). Each loop takes every ready
 * lane, merges them in its own worktree, runs one `app check --env prod --level dev` (the fast level; a newer registration of a lane cancels it and re-forms the batch), squashes the batch into ONE commit listing the lanes and their shas and pushes dev through `app push`; a red batch drops the
 * lanes its findings name and runs once more, never bisecting. `--once` runs one batch; `--dry-run` merges only. When this machine's local
 * settings turn on `devSync.afterLand` (harness/local-settings.ts, git-ignored, default off), a landed batch is followed by `starci dev sync
 * --execute` on the app's main dev checkout, debounced over consecutive batches, which restarts only the changed api or web of the running dev stack.
 * A lander started from inside a worktree of the app (`npx starci lane land` in its checkout) runs itself again from its own install of the
 * same version (harness/lander-install.ts), so no install of a checkout, a dev sync included, can wipe the files under it.
 */
export const laneLandVerb = defineVerb({
    path: ["lane", "land"],
    summary: "run the batch lander of dev: merge every ready lane in its own worktree, one app check --env prod --level dev (the fast level; a lane registered again with a new sha cancels the running gate and re-forms the batch, its status says superseded by <sha>), squash the batch into ONE commit (its message lists the lanes and their shas), push dev; red drops the lanes its findings name and re-gates once, never bisects",
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
        if (!dryRun) {
            const own = await landerHome({ cliRoot: runningCliRoot(), worktrees: (await listWorktrees(options.repo)).map((tree) => tree.path), dir, name: cliPackageName(), version: packageVersion(), env: process.env, say: context.progress })
            if (own !== undefined) {
                // The same argv from the lander's own install; this process only waits for it, and exits with its code.
                const run = spawnSync(process.execPath, [own, ...process.argv.slice(2)], { stdio: "inherit", cwd: process.cwd(), env: { ...process.env, [LANDER_OWN_INSTALL_ENV]: "1" } })
                process.exit(run.status ?? 1)
            }
            holdLander(dir)
        }
        // The heartbeat: the lock's mtime moves every poll, through long gates too (the batch steps are async), so `lane status` tells a
        // live lander from a hung or killed one.
        const heartbeat = dryRun ? undefined : setInterval(() => {
            touchLander(landPaths(dir).lander)
        }, POLL_MS)
        heartbeat?.unref()
        const batches: BatchRecord[] = []
        const autoSync = landAutoSync(loadLocalSettings().devSync, options.repo, dryRun, context.progress)
        try {
            for (;;) {
                const record = await runBatch(options)
                if (record !== undefined) batches.push(record)
                if (record?.landed !== undefined) autoSync?.debounce.landed(Date.now())
                if (autoSync !== undefined && (autoSync.debounce.due(Date.now()) || ((flags.once || dryRun) && autoSync.debounce.pending))) await autoSync.run()
                if (flags.once || dryRun) break
                const wait = autoSync?.debounce.waitMs(Date.now())
                await new Promise((settle) => setTimeout(settle, record === undefined ? Math.min(POLL_MS, wait ?? POLL_MS) : 1000))
            }
        } finally {
            clearInterval(heartbeat)
            if (!dryRun) releaseLockFile(landPaths(dir).lander, process.pid)
        }
        const message = batches.length === 0 ? "no lane is ready" : batches.map((batch) => `batch ${batch.batch}: ${batch.outcome}`).join("\n")
        return { data: { batches }, message }
    },
})
