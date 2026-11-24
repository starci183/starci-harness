import { Refusal } from "../../shared/errors.js"
import { repositoryRoot } from "../../shared/git.js"
import { defineVerb } from "../../shared/verb.js"
import type { Role } from "../../shared/verb.js"
import { lanesDir } from "../../harness/lane-state.js"
import { profileNameFor } from "../../harness/land-profile.js"
import { assertDevCheckout, hotfixAbort, hotfixLand, hotfixStatus } from "./land.js"
import { loadHotfixRules } from "./rules.js"

/** A hotfix is the coordinator's: subagents and workers land through lanes. */
const COORDINATOR: readonly Role[] = ["owner", "coordinator"]

const ONLY = { only: { kind: "list", summary: "a path of the hotfix (repeat it; a folder ends with a slash). A new file is landed only when named here, tracked changes outside the list stop the hotfix (HOTFIX_FOREIGN), and the harness checkout, which holds other work, requires it" } } as const

const COMMON = {
    dir: { kind: "string", summary: "the lanes folder holding the dev lock (default: STARCI_LANES_DIR, else slots.root of ops/slots.yaml)" },
    profile: { kind: "string", summary: "app or harness (default: harness in the harness checkout, else app)" },
} as const

/** `starci hotfix land`: lands the dev checkout's uncommitted edit as one `Hotfix:` commit on dev and restarts dev at once, judging only its size. */
export const hotfixLandVerb = defineVerb({
    path: ["hotfix", "land"],
    summary: "the coordinator's hotfix (contexts/authority/lanes.md \"Hotfix\"): land the uncommitted edit of the app's dev checkout (edited in place, from the coordinator chat) on dev and restart dev at once; it judges only the size (at most ops/hotfix.yaml maxFiles files and maxLines changed lines, else \"quá lớn cho hotfix (N file / M dòng), mở lane\") and runs NO check (no typecheck, hfs, secrets or spec). Under the dev lock it refuses while a dev sync of the checkout runs, makes ONE commit with a Hotfix: trailer, rebases it onto origin/dev and pushes dev (never forced; the pre-push gate is skipped for this one push by the pass hotfix writes, the only path that skips it), then restarts the stack through dev sync (light: the changed api/web only; the full steps when a lockfile, migration, schema or workspace package changed, said in the output), waits for --health-url to answer 200, and starts the CI watch, which judges the commit after the fact. --only names the hotfix's paths (a new file lands only when named; tracked changes outside the list refuse HOTFIX_FOREIGN). In the harness (--profile harness, --only required) nothing is a dev server: after the push it rebuilds the CLI copy (_cli-<sha9>, then _cli-current repointed), runs deps publish-dev and syncs every app of devSync.repos at once. A coordinator verb; a subagent opens a lane. --dry-run prints the size and the restart plan",
    effect: "remote",
    roles: COORDINATOR,
    schema: "starci/hotfix-land@1",
    flags: {
        message: { kind: "string", summary: "what the hotfix fixes: the subject of its commit", required: true },
        "health-url": { kind: "string", summary: "after the restart, wait until this url answers 200 (ops/hotfix.yaml healthWaitSeconds); without it the restart's own health wait stands" },
        "dry-run": { kind: "boolean", summary: "print the size, the limits and the restart plan; take no lock, commit nothing" },
        ...ONLY,
        ...COMMON,
    },
    run: async (context, flags) => {
        if (flags.message.trim() === "") throw new Refusal("CLI_USAGE", "--message names what the hotfix fixes")
        const root = await repositoryRoot(context.cwd)
        const profile = profileNameFor(root, flags.profile)
        const dir = flags["dry-run"] ? (flags.dir ?? "") : lanesDir(flags.dir)
        const landed = await hotfixLand({ root, dir, profile, message: flags.message, rules: loadHotfixRules(), only: flags.only, dryRun: flags["dry-run"], healthUrl: flags["health-url"], say: context.progress })
        if (landed.dryRun) return { data: landed, message: `hotfix dry run: ${String(landed.scope.files)} file(s) / ${String(landed.scope.lines)} line(s), within the limits` }
        const failed = [...landed.restarts.filter((restart) => restart.state === "failed"), ...(landed.cliCopy?.state === "failed" ? [landed.cliCopy] : []), ...landed.publishFailed]
        const unhealthy = landed.health.startsWith("FAILED")
        const restart = profile === "harness"
            ? landed.consumed.length === 0 ? "no app restart or sync (it changes no package the apps consume)" : `apps synced: ${String(landed.restarts.length)} (it changes ${landed.consumed.join(", ")})`
            : `restart ${landed.escalation.length === 0 ? "light" : `FULL (${landed.escalation.join("; ")})`}`
        const lines = [
            `hotfix ${landed.sha.slice(0, 10)} is on dev (${String(landed.scope.files)} file(s) / ${String(landed.scope.lines)} line(s)); ${restart}`,
            ...landed.restarts.map((one) => `${one.state === "done" ? "restarted" : "RESTART FAILED"} ${one.checkout}: ${one.note}`),
            `health: ${landed.health}`,
            ...(landed.cliCopy === undefined ? [] : [`CLI copy: ${landed.cliCopy.state}: ${landed.cliCopy.note}`]),
            ...(landed.published.length === 0 ? [] : [`published to the dev line: ${landed.published.join(", ")}`]),
            ...landed.publishFailed.map((failure) => `dev publish FAILED ${failure}`),
            "CI watch started: starci lane status shows its verdict",
        ]
        return { data: landed, message: lines.join("\n"), ...(failed.length > 0 || unhealthy ? { exitCode: 1 } : {}) }
    },
})

/** `starci hotfix status`: the edit in the dev checkout against the limits. */
export const hotfixStatusVerb = defineVerb({
    path: ["hotfix", "status"],
    summary: "where a hotfix stands in the dev checkout: the files and changed lines of its uncommitted edit against the limits of ops/hotfix.yaml, whether its restart would be light or the full sync steps, how far the checkout is behind origin/dev, who holds the dev lock and whether a dev sync of the checkout is running; changes nothing",
    effect: "read",
    roles: COORDINATOR,
    schema: "starci/hotfix-status@1",
    flags: { ...ONLY, ...COMMON },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const profile = profileNameFor(root, flags.profile)
        const rules = loadHotfixRules()
        const status = await hotfixStatus({ root, dir: lanesDir(flags.dir), profile, rules, only: flags.only })
        const lines = [
            `${root} on ${status.branch ?? "a detached HEAD"}, ${String(status.behind)} commit(s) behind origin/dev`,
            status.files.length === 0 ? "no uncommitted edit" : `${String(status.scope.files)} file(s) / ${String(status.scope.lines)} line(s) (limits ${String(rules.maxFiles)} / ${String(rules.maxLines)}): ${status.scope.ok ? "within the hotfix scope" : "OVER the limit: quá lớn cho hotfix, mở lane"}`,
            ...status.files.map((file) => `  ${file}`),
            status.files.length === 0 ? "" : profile === "harness" ? "restart: none in the harness; the apps sync only for a package they consume (hotfix land --dry-run says which)" : status.escalation.length === 0 ? "restart: light (the changed api/web only)" : `restart: the full sync steps (${status.escalation.join("; ")})`,
            ...(status.foreign.length === 0 ? [] : [`tracked changes OUTSIDE the hotfix (they stop it): ${status.foreign.join(", ")}`]),
            ...(status.overlay.length === 0 ? [] : [`the local overlay of dev sync, left alone (never committed, never foreign): ${status.overlay.join(", ")}`]),
            ...(status.untracked.length === 0 ? [] : [`untracked, left alone unless --only names them: ${status.untracked.slice(0, 8).join(", ")}${status.untracked.length > 8 ? ", ..." : ""}`]),
            `dev lock: ${status.devLock ?? "free"}`,
            `dev sync: ${status.syncBusy ?? "not running"}`,
        ]
        return { data: status, message: lines.filter((line) => line !== "").join("\n") }
    },
})

/** `starci hotfix abort`: gives the dev checkout back its HEAD. */
export const hotfixAbortVerb = defineVerb({
    path: ["hotfix", "abort"],
    summary: "abandon the uncommitted hotfix of the dev checkout: restore every touched tracked file from HEAD and delete the files the edit added (the check-cache records are left); dry until --execute, and it touches nothing committed",
    effect: "local-write",
    roles: COORDINATOR,
    schema: "starci/hotfix-abort@1",
    flags: { ...ONLY, execute: { kind: "boolean", summary: "restore and delete (default: a dry run that lists them)" } },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        await assertDevCheckout(root)
        const plan = await hotfixAbort({ root, execute: flags.execute, only: flags.only })
        const lines = [...plan.restore.map((file) => `${flags.execute ? "restored" : "would restore"} ${file} from HEAD`), ...plan.remove.map((file) => `${flags.execute ? "deleted" : "would delete"} ${file} (new file)`)]
        return { data: { dryRun: !flags.execute, ...plan }, message: [...(lines.length === 0 ? ["no uncommitted edit"] : lines), ...(flags.execute ? [] : ["dry run: nothing changed; pass --execute"])].join("\n") }
    },
})
