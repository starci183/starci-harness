import { loadPolicy } from "../../harness/policy.js"
import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { describeLoosening, scanLoosening } from "./loosening-scan.js"

/** `starci check loosening`: the state-based no-bypass gate over the tree as it stands (policy/loosening.yaml). */
export const checkLooseningVerb = defineVerb({
    path: ["check", "loosening"],
    summary: "scan the tree as it stands for banned loosening markers (policy/loosening.yaml); red with file:line for each",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-loosening@1",
    flags: {},
    run: async (context) => {
        const root = await repositoryRoot(context.cwd)
        const report = await scanLoosening(root, loadPolicy(root))
        return { data: report, message: describeLoosening(report).join("\n"), exitCode: report.verdict === "red" ? 1 : 0 }
    },
})
