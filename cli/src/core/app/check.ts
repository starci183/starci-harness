import { requireHostServices } from "../../harness/host-needs.js"
import { appRootOf } from "../../harness/memory-plan.js"
import { captureGitSync } from "../../shared/git.js"
import { defineVerb, WRITERS } from "../../shared/verb.js"
import type { VerbContext } from "../../shared/verb.js"
import { packageVersion } from "../version.js"
import { judgePush } from "../deps/push-gate.js"
import { LEVEL_FLAG, memoStore, runFastCheck, treeMemoKey } from "./fast-check.js"
import type { FastPorts } from "./fast-check.js"
import { applyHfsEnv, argValue, FORWARDED, runHfs } from "./hfs.js"

/**
 * The host services the app's environments declare (`environments.<env>.hostServices`, contexts/harness/host.md "What an app needs"), judged
 * against this host's config.yaml before a production-mode check or a deploy: HOST_SERVICE_MISSING, HOST_ROLE_MISSING or HOST_MACHINE_UNKNOWN
 * refuses; a host with no config.yaml (a CI runner) says it did not judge.
 */
export const judgeHostServices = (context: VerbContext, env?: string): void => {
    for (const verdict of requireHostServices(context.cwd, env)) context.progress(`host services ${verdict.env} (on ${verdict.target}): ${verdict.detail}`)
}

/** Whether the app declares the deps gate off for every branch (`gates` of .starcistacks/application-stacks.yaml), read by @starci/hfs's one reader. */
const depsDeclaredOff = async (context: VerbContext, root: string): Promise<boolean> => {
    applyHfsEnv(context)
    const { activeProfile } = await import("@starci/hfs/runtime/scripts/hfs/branch-profile.mjs")
    return activeProfile(root, process.env).modes.deps === "off"
}

/** The fast level's ports on this checkout: the memo of the repository, the deps push gate, and @starci/hfs in-process. */
const fastPorts = async (context: VerbContext, env: string): Promise<FastPorts> => {
    const root = appRootOf(context.cwd)
    const dev = captureGitSync(["rev-parse", "--verify", "-q", "origin/dev"], root)
    // The judged set of the fast level is the diff from origin/dev: a moved dev is another verdict, as a new harness or another env is.
    const salt = `level dev; env ${env}; harness ${packageVersion()}; origin/dev ${dev.exitCode === 0 ? dev.stdout.trim() : "none"}`
    const off = await depsDeclaredOff(context, root)
    return {
        memoKey: () => treeMemoKey(root, salt),
        ...memoStore(root),
        depsOff: () => off,
        deps: async (target) => (await judgePush(root, "HEAD", { target })).notes,
        hfs: (args) => runHfs(context, "check", args, true),
        say: (line) => {
            process.stderr.write(`${line}\n`)
        },
        json: context.json,
    }
}

/** `starci app check`: run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture under the branch profile, or with --staged the pre-commit guard; --fix, --out and the result cache write; @starci/hfs runs it in-process in the app. */
export const appCheckVerb = defineVerb({
    path: ["app", "check"],
    summary: "run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture, and run the project checks ext/manifest.json `checks` declares as their own step wherever the hfs gate runs (a red one is HFS_PROJECT_CHECK_FAILED with its exit and output); --level full|dev (default full) is the two-level gate (owner: \"rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn\"): dev is the FAST level of a landing on dev (a lane push, a push of dev, the batch lander and lane gate): the deps check (local-registry pins allowed where hfs.json deps.devAllowsLocalRegistry is declared; --push-refs <the pre-push stdin> names the target, else dev), types with its package builds and codegen, the lane's own tests (the changed and related unit specs), db and the design approval (HFS_APP_GALLERY_DESIGN_CHANGE_UNAPPROVED); it prints one line naming the gates it skips, which run once at the main cut, and a tree it already judged green is not judged again (one pass per push); full is every gate, run by a push of main or a release tag, release cut, release push and app release; --gate selects, --side limits the lint, --fix fixes it, --out writes the Sonar import, --staged is the pre-commit guard; --env local|prod (default local) judges the same code checks in both (prod first refuses HOST_SERVICE_MISSING when an environment's declared hostServices are hosted by none of its machines in this host's config.yaml) and only decides whether the findings a local-registry loop alone causes (a pin the lockfile resolved from the local registry, a cache written from a build with no source digest) are report-only (local) or block (prod: the pre-push hook, CI, the release gate); every run is under the branch profile of the branch it judges (`branches` of .starcistacks/application-stacks.yaml, chosen in CI from GITHUB_BASE_REF, where a pull request into main is the full gate, then GITHUB_HEAD_REF, then GITHUB_REF, else the checked-out branch): a gate the profile reports runs and records but never counts, an off gate does not run, and where lint reports the lint ratchet blocks a commit that adds lint findings to a file it touches; --profile prints the profile (with one --gate, that gate's mode), --ratchet is the pre-commit lint ratchet; an app may also declare gates off for the whole app on every branch (`gates` of .starcistacks/application-stacks.yaml: any gate but hfs, secrets and db, each `{ run: off, reason }`, contexts/project/lint.md PROJECT-LINT-4): a declared gate does not run, is listed `off (declared: <reason>)` and is never counted as passed",
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-check@1",
    forward: true,
    flags: FORWARDED,
    run: async (context, flags) => {
        const env = argValue(flags.args, "env") ?? "local"
        if (env === "prod") judgeHostServices(context)
        if (argValue(flags.args, LEVEL_FLAG) !== "dev") return runHfs(context, "check", flags.args, true)
        return runFastCheck(flags.args, await fastPorts(context, env))
    },
})
