/**
 * One document a seat loads by its section index: `source` relative to the runtime root, its index's place under contexts/,
 * the index's title, what the document owns, and the search scope that ranks its sections.
 */
export interface SectionedDoc {
    readonly source: string
    readonly index: string
    readonly title: string
    readonly owns: string
    readonly scope: string
}

/**
 * The documents too large for a seat's fixed context that it still needs to find its way in: each op or coordinator brief
 * loads the index and opens a section on demand, so its fixed context stays a small core while every section is one call away.
 */
export const SECTIONED_DOCS: readonly SectionedDoc[] = [
    { source: "cli/README.md", index: "harness/cli-sections.md", title: "CLI sections", owns: "how the CLI is built and how the harness inside it works", scope: "harness" },
    { source: "contexts/project/work.md", index: "project/work-sections.md", title: "Work sections", owns: "the `.starciwork` record families, their state, who writes what, UAT flows and evidence", scope: "project" },
    { source: "contexts/project/stacks.md", index: "project/stacks-sections.md", title: "Stacks sections", owns: "how an app runs: `.starcistacks/`, its environments, custody and operations", scope: "project" },
    { source: "contexts/ui/composition.md", index: "ui/composition-sections.md", title: "Composition sections", owns: "the composition rules of a page: regions, rank, the decisive action, conditions and emphasis", scope: "ui" },
    { source: "contexts/grammars/contract.md", index: "grammars/contract-sections.md", title: "Grammar contract sections", owns: "the reasoning behind each entry of the grammar contract every grammar implements", scope: "grammars" },
]


/**
 * The source a section index stands for, when `path` (absolute or relative, either separator) is one: the same path with the
 * index's place under contexts/ replaced by its source. A task whose context lists the index may open any of its sections, so
 * the ids of the source are citable from it (harness/contract.ts and harness/run-checks.ts read them).
 */
export const sectionedSource = (path: string): string | undefined => {
    const normal = path.replaceAll("\\", "/")
    for (const doc of SECTIONED_DOCS) {
        const index = `contexts/${doc.index}`
        if (normal === index || normal.endsWith(`/${index}`)) return normal.slice(0, normal.length - index.length) + doc.source
    }
    return undefined
}
