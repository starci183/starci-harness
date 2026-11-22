import { repositoryRoot } from "../../shared/git.js"
import { defineVerb, EVERYONE } from "../../shared/verb.js"
import { prePushTarget } from "./dev-local.js"
import { judgePush } from "./push-gate.js"

/** `starci deps check`: the push gate of the app's `@starci` dependencies (`judgePush`), the body of the app's pre-push hook. */
export const depsCheckVerb = defineVerb({
    path: ["deps", "check"],
    summary: "refuse a push whose committed @starci pins npm cannot install (DEPS_PIN_UNPUBLISHED), a lockfile that names the local registry (DEPS_LOCAL_REGISTRY_COMMITTED) or a lockfile whose harness package integrity is not the one npm serves for that version (DEPS_LOCK_INTEGRITY)",
    effect: "read",
    roles: EVERYONE,
    schema: "starci/deps-check@1",
    flags: {
        sha: { kind: "string", summary: "judge the package.json files committed at this commit (default HEAD)" },
        "push-refs": { kind: "string", summary: "the pre-push hook's stdin (one `<local ref> <sha> <remote ref> <sha>` line per ref): a push whose every ref is dev or a lane branch, of an app declaring hfs.json deps.devAllowsLocalRegistry, accepts local-registry pins; without it every local pin is refused" },
    },
    run: async (context, flags) => {
        const root = await repositoryRoot(context.cwd)
        const pushRefs = flags["push-refs"]
        const judged = await judgePush(root, flags.sha ?? "HEAD", pushRefs === undefined ? {} : { target: prePushTarget(pushRefs) })
        const message = [
            ...judged.pins.map((pin) => `${pin.local === true ? "local-registry" : "published"} ${pin.name}@${pin.spec} (${pin.file} ${pin.field})`),
            ...judged.notes,
            judged.app ? "verdict: green" : "verdict: green (nothing judged)",
        ]
        return { data: judged, message: message.join("\n") }
    },
})
