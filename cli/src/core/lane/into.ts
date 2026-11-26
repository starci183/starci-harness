import { resolve } from "node:path"
import { mainCheckout, repositoryRoot } from "../../shared/git.js"
import { EVERYONE, defineVerb } from "../../shared/verb.js"
import { landIntoForRepo } from "../../harness/local-settings.js"

/**
 * `starci lane into`: the branch the lanes of the repository land into, alone on its line (`dev`, or the integration branch `landInto` of the local
 * settings names, contexts/project/branches.md PROJECT-BRANCH-4). The managed pre-push hook reads it, so a push of that branch runs the fast level as a
 * push of dev does; an older CLI without the verb leaves the hook at dev alone.
 */
export const laneIntoVerb = defineVerb({
    path: ["lane", "into"],
    summary: "print the branch the repository's lanes land into: dev, or the integration branch devSync.repos.<repo>.landInto of the local settings names (the managed pre-push hook reads it to judge a push of that branch at the fast level)",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/lane-into@1",
    flags: {
        dir: { kind: "string", summary: "a checkout of the repository (default: the current folder)" },
    },
    run: async (context, flags) => {
        const repo = await mainCheckout(await repositoryRoot(resolve(flags.dir ?? context.cwd)))
        const into = landIntoForRepo(repo)
        return { data: { repo, into }, message: into }
    },
})
