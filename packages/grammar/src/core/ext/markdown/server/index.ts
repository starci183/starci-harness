import { parse, type ParseOptions } from "../parse.js"
import { profileOf } from "../profiles.js"
import type { Issue, MarkdownTree, ProfileName } from "../types.js"
import { validateTree } from "../validate.js"
import { highlight } from "./highlight.js"

export { highlight, highlightCode } from "./highlight.js"

/** A text ready to draw: its highlighted tree and the issues of its profile. */
export interface PreparedMarkdown {
    readonly profile: ProfileName
    readonly tree: MarkdownTree
    readonly issues: readonly Issue[]
}

/**
 * Parses, validates against `profile` and highlights one text on the server, for `<Markdown tree={prepared.tree} profile=...>`:
 * a server component awaits it and hands the plain JSON to the client.
 */
export const prepare = async (source: string, profile: ProfileName = "prose", options: ParseOptions = {}): Promise<PreparedMarkdown> => {
    const parsed = parse(source, options)
    const issues = [...parsed.issues, ...validateTree(parsed, profileOf(profile))]
    return { profile, tree: await highlight(parsed), issues }
}
