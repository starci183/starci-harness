import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ruleIdsIn } from "./contract.js"

/** The files of the rule book: every Markdown and yaml file of contexts/, and CONTRIBUTING.md. */
const ruleBookFiles = (root: string): string[] => {
    const contexts = join(root, "contexts")
    const tree = existsSync(contexts)
        ? readdirSync(contexts, { recursive: true, withFileTypes: true })
              .filter((entry) => entry.isFile() && /\.(?:md|ya?ml)$/.test(entry.name))
              .map((entry) => join(entry.parentPath, entry.name))
        : []
    const contributing = join(root, "CONTRIBUTING.md")
    return existsSync(contributing) ? [...tree, contributing] : tree
}

/**
 * The rule ids of the rule book under `root`: each id a heading of its Markdown names (`CONTRIB-1`, `PROJECT-LINT-2`) and each
 * `id:` entry of its yaml (`R212`). A policy exception of kind `rule` and a branch profile cite one of them.
 */
export const ruleBookIds = (root: string): ReadonlySet<string> => {
    const ids = new Set<string>()
    for (const file of ruleBookFiles(root)) for (const id of ruleIdsIn(readFileSync(file, "utf8"))) ids.add(id)
    return ids
}
