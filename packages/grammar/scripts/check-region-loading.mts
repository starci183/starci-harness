import { readdirSync, readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { REGION_LOADING_EXEMPT } from "../src/common/region-loading.ts"

/**
 * Contract check: every component of core/leaf, core/branch and core/composite honours the loading region (withRegionLoading,
 * withRegionInert, withRegionGeometry, useIsLoading or a FieldSkeletonScope) or is listed, with its reason, in
 * src/common/region-loading.ts. Fails on a component with neither, and on an exemption that names nothing or that the component no
 * longer needs.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "core")
const HONOURS = [/withRegionLoading\(/, /withRegionInert\(/, /withRegionGeometry\(/, /useIsLoading\(/, /FieldSkeletonScope/]
const problems: string[] = []
const seen = new Set<string>()
for (const tier of ["leaf", "branch", "composite"]) {
    for (const name of readdirSync(resolve(root, tier), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
        const file = resolve(root, tier, name, "index.tsx")
        if (!existsSync(file)) continue
        const key = `${tier}/${name}`
        seen.add(key)
        const honours = HONOURS.some((pattern) => pattern.test(readFileSync(file, "utf8")))
        const exempt = key in REGION_LOADING_EXEMPT
        if (!honours && !exempt) problems.push(`${key}: no loading support from the region (wrap it in withRegionLoading, withRegionInert or withRegionGeometry, or list it with a reason in src/common/region-loading.ts)`)
    }
}
for (const key of Object.keys(REGION_LOADING_EXEMPT)) if (!seen.has(key)) problems.push(`${key}: listed as exempt but no such component`)
if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
}
console.log(`region loading: ${seen.size} components, ${Object.keys(REGION_LOADING_EXEMPT).length} exempt with a reason`)
