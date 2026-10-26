import { doctorVerb } from "./core/doctor.js"
import { explainVerb } from "./core/explain.js"
import { ciStatusVerb } from "./core/release/ci-status.js"
import { versionVerb } from "./core/version.js"
import { appInfoVerb } from "./lite/app/info.js"
import type { AnyVerb, TreeKind } from "./shared/verb.js"

// Each definition is widened once here; the registry is the only place that erases verb types.
const widen = (verb: object): AnyVerb => verb as AnyVerb

/** Every verb this build knows, core first, then each edition. */
export const ALL_VERBS: readonly AnyVerb[] = [versionVerb, explainVerb, doctorVerb, ciStatusVerb, appInfoVerb].map(widen)

/** The verbs a tree offers: an app sees core plus its own edition; the runtime and a bare directory see everything. */
export const verbsFor = (tree: TreeKind): readonly AnyVerb[] => {
    if (tree === "lite" || tree === "full") return ALL_VERBS.filter((verb) => verb.editions.includes(tree))
    return ALL_VERBS
}
