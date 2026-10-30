import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, defineVerb, EVERYONE } from "../../shared/verb.js"
import { judgePush } from "./push-gate.js"

/** `starci deps check`: the push gate of the app's `@starci` dependencies (`judgePush`), the body of the app's pre-push hook. */
export const depsCheckVerb = defineVerb({
    path: ["deps", "check"],
    summary: "refuse a push whose committed @starci pins npm cannot install (DEPS_PIN_UNPUBLISHED) or whose local package copies hold code no published version does (DEPS_LOCAL_AHEAD)",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/deps-check@1",
    flags: {
        sha: { kind: "string", summary: "judge the package.json files committed at this commit (default HEAD)" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const judged = await judgePush(root, flags.sha ?? "HEAD")
        const message = [
            ...judged.pins.map((pin) => `published ${pin.name}@${pin.spec} (${pin.file} ${pin.field})`),
            ...judged.local.map((copy) => `local     ${copy.name} ${copy.version} in ${copy.dir}: equal to the published tarball`),
            ...judged.notes,
            judged.app ? "verdict: green" : "verdict: green (nothing judged)",
        ]
        return { data: judged, message: message.join("\n") }
    },
})
