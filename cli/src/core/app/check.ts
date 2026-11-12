import { BOTH_EDITIONS, defineVerb, WRITERS } from "../../shared/verb.js"
import { FORWARDED, runHfs } from "./hfs.js"

/** `starci app check`: run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture under the branch profile, or with --staged the pre-commit guard; --fix, --out and the result cache write; @starci/hfs runs it in-process in the app. */
export const appCheckVerb = defineVerb({
    path: ["app", "check"],
    summary: "run the app ESLint canons and judge the tree, managed output, contracts, formatting and architecture, and run the project checks ext/manifest.json `checks` declares as their own step wherever the hfs gate runs (a red one is HFS_PROJECT_CHECK_FAILED with its exit and output); --gate selects, --side limits the lint, --fix fixes it, --out writes the Sonar import, --staged is the pre-commit guard; --env local|prod (default local) judges the same code checks in both and only decides whether the findings a local-registry loop alone causes (a pin the lockfile resolved from the local registry, a cache written from a build with no source digest) are report-only (local) or block (prod: the pre-push hook, CI, the release gate); every run is under the branch profile of the branch it judges (`branches` of .starcistacks/application-stacks.yaml, chosen in CI from GITHUB_BASE_REF, where a pull request into main is the full gate, then GITHUB_HEAD_REF, then GITHUB_REF, else the checked-out branch): a gate the profile reports runs and records but never counts, an off gate does not run, and where lint reports the lint ratchet blocks a commit that adds lint findings to a file it touches; --profile prints the profile (with one --gate, that gate's mode), --ratchet is the pre-commit lint ratchet",
    editions: BOTH_EDITIONS,
    effect: "local-write",
    roles: WRITERS,
    schema: "starci/app-check@1",
    forward: true,
    flags: FORWARDED,
    run: (context, flags) => runHfs(context, "check", flags.args, true),
})
