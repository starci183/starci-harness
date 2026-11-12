import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { describeBusiness, loadBusinessPolicy, scanBusiness } from "./business-scan.js"
import { treeFiles } from "./tree-files.js"

/** `starci check business`: no source of the harness tree holds an identifier policy/business-terms.yaml denies (contexts/harness/rules.md rule 9). */
export const checkBusinessVerb = defineVerb({
    path: ["check", "business"],
    summary: "refuse a file of the harness tree that holds, as a whole token, an app, product or provider identifier policy/business-terms.yaml denies, outside its exact allow entries; red also for an allow entry nothing uses; it decides by membership in that list, never by meaning",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-business@1",
    flags: {},
    run: async (context) => {
        const root = await repositoryRoot(context.cwd)
        const report = scanBusiness(root, loadBusinessPolicy(root), await treeFiles(root))
        return { data: report, message: describeBusiness(report).join("\n"), exitCode: report.verdict === "red" ? 1 : 0 }
    },
})
