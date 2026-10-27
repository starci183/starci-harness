import { repositoryRoot } from "../../shared/git.js"
import { BOTH_EDITIONS, EVERYONE, defineVerb } from "../../shared/verb.js"
import { loadShapeManifest } from "./shape-manifest.js"
import { describeShape, scanShape } from "./shape-scan.js"
import { treeFiles } from "./tree-files.js"

/** `starci check shape`: every file of the harness tree as it stands placed in contexts/hfs/harness.yaml, its own HFS. */
export const checkShapeVerb = defineVerb({
    path: ["check", "shape"],
    summary: "place every file of the harness tree in its slot of contexts/hfs/harness.yaml; red for an unplaced or forbidden file, a missing required slot, or a stale or expired exception",
    editions: BOTH_EDITIONS,
    effect: "read",
    roles: EVERYONE,
    schema: "starci/check-shape@1",
    flags: {},
    run: async (context) => {
        const root = await repositoryRoot(context.cwd)
        const manifest = loadShapeManifest(root)
        const report = scanShape(root, manifest, await treeFiles(root), new Date().toISOString().slice(0, 10))
        return { data: report, message: describeShape(report).join("\n"), exitCode: report.verdict === "red" ? 1 : 0 }
    },
})
