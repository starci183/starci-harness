import type { Block, Inline } from "./types.js"

/** The blocks a block holds (a list's items, a callout's or a quote's content, every panel and every tab), in order. */
export const childBlocks = (node: Block): readonly Block[] => {
    if (node.type === "list") return node.items.flat()
    if (node.type === "blockquote" || node.type === "callout") return node.children
    if (node.type === "accordion") return node.panels.flatMap((panel) => panel.children)
    if (node.type === "tabs") return node.tabs.flatMap((tab) => tab.children)
    return []
}

/** The inline content a block holds itself (a heading, a paragraph, the cells of a table). */
export const childInlines = (node: Block): readonly Inline[] => {
    if (node.type === "heading" || node.type === "paragraph") return node.children
    if (node.type === "table") return [...node.header.flat(), ...node.rows.flat(2)]
    return []
}

/** Every block of a tree, depth first. */
export const walkBlocks = (nodes: readonly Block[], visit: (node: Block) => void): void => {
    for (const node of nodes) {
        visit(node)
        walkBlocks(childBlocks(node), visit)
    }
}

/** Every inline of a list, depth first. */
export const walkInlines = (nodes: readonly Inline[], visit: (node: Inline) => void): void => {
    for (const node of nodes) {
        visit(node)
        if (node.type === "strong" || node.type === "emphasis" || node.type === "delete" || node.type === "link") walkInlines(node.children, visit)
    }
}

/** A copy of the tree with `change` applied to every block, the nested ones first (async: Shiki loads its grammars on demand). */
export const mapBlocks = async (nodes: readonly Block[], change: (node: Block) => Promise<Block>): Promise<Block[]> => {
    const each = (list: readonly Block[]): Promise<Block[]> => mapBlocks(list, change)
    return Promise.all(
        nodes.map(async (node): Promise<Block> => {
            if (node.type === "list") return change({ ...node, items: await Promise.all(node.items.map(each)) })
            if (node.type === "blockquote" || node.type === "callout") return change({ ...node, children: await each(node.children) })
            if (node.type === "accordion") return change({ ...node, panels: await Promise.all(node.panels.map(async (panel) => ({ ...panel, children: await each(panel.children) }))) })
            if (node.type === "tabs") return change({ ...node, tabs: await Promise.all(node.tabs.map(async (tab) => ({ ...tab, children: await each(tab.children) }))) })
            return change(node)
        }),
    )
}
