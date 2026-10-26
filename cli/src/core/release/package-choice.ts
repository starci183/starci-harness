import { Refusal } from "../../shared/errors.js"
import { listPackages } from "../../shared/workspace.js"
import type { WorkspacePackage } from "../../shared/workspace.js"

/** The package a release verb acts on: the one named by --package, the root package, or the only package of the repository. */
export const choosePackage = (root: string, named: string | undefined): WorkspacePackage => {
    const packages = listPackages(root)
    if (named !== undefined) {
        const wanted = named.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") || "."
        const found = packages.find((pkg) => pkg.relativeDir === wanted || pkg.name === named)
        if (found === undefined) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package ${named}; packages: ${packages.map((pkg) => pkg.relativeDir).join(", ")}`)
        return found
    }
    const rootPackage = packages.find((pkg) => pkg.relativeDir === ".")
    if (rootPackage !== undefined) return rootPackage
    const [only, ...others] = packages
    if (only === undefined) throw new Refusal("RELEASE_PACKAGE_UNKNOWN", `no package.json with a name and version under ${root}`)
    if (others.length > 0) throw new Refusal("RELEASE_PACKAGE_AMBIGUOUS", `name the package with --package: ${packages.map((pkg) => pkg.relativeDir).join(", ")}`)
    return only
}
