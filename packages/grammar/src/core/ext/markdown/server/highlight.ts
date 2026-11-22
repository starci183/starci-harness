import { bundledLanguages, createCssVariablesTheme, createHighlighter, type BundledLanguage, type Highlighter, type ThemedToken } from "shiki"
import { mapBlocks } from "../tree.js"
import type { Block, CodeToken, MarkdownTree } from "../types.js"

/**
 * Shiki's css-variables theme: every token colour is a `var(--shiki-token-*)`, which `@starci/grammar/core/ext/markdown.css` maps onto the Grammar
 * tokens, so a highlighted block follows the app's brand and its dark mode with no second theme.
 */
const THEME = createCssVariablesTheme({ name: "starci-css-variables", variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true })

/** The language names a fence may use for a Shiki grammar it ships under another id. */
const ALIASES: Readonly<Record<string, string>> = { typescript: "ts", javascript: "js", shell: "bash", sh: "bash", zsh: "bash", yml: "yaml", mdx: "mdx", text: "", plaintext: "", txt: "" }

let shared: Promise<Highlighter> | undefined

const highlighter = (): Promise<Highlighter> => {
    shared ??= createHighlighter({ themes: [THEME], langs: [] })
    return shared
}

const languageOf = (lang: string | undefined): BundledLanguage | undefined => {
    if (lang === undefined) return undefined
    const name = ALIASES[lang] ?? lang
    return name !== "" && name in bundledLanguages ? (name as BundledLanguage) : undefined
}

const tokenOf = (token: ThemedToken): CodeToken => {
    const fontStyle = token.fontStyle === undefined ? undefined : (token.fontStyle & 1) === 1 ? "italic" : (token.fontStyle & 2) === 2 ? "bold" : undefined
    return { content: token.content, ...(token.color === undefined ? {} : { color: token.color }), ...(fontStyle === undefined ? {} : { fontStyle }) }
}

/** One token list per line of `code` in `lang`, or `undefined` for a language Shiki does not ship (the block stays plain). */
export const highlightCode = async (code: string, lang: string | undefined): Promise<CodeToken[][] | undefined> => {
    const language = languageOf(lang)
    if (language === undefined) return undefined
    const shiki = await highlighter()
    if (!shiki.getLoadedLanguages().includes(language)) await shiki.loadLanguage(language)
    return shiki.codeToTokensBase(code, { lang: language, theme: THEME }).map((line) => line.map(tokenOf))
}

const highlightBlock = async (node: Block): Promise<Block> => {
    if (node.type === "code") {
        const tokens = await highlightCode(node.code, node.lang)
        return tokens === undefined ? node : { ...node, tokens }
    }
    if (node.type === "diff") {
        const tokens = await highlightCode(node.lines.map((line) => line.text).join("\n"), node.lang)
        return tokens === undefined ? node : { ...node, tokens }
    }
    return node
}

/** The tree with Shiki tokens on every code block and diff whose language Shiki ships. Run it on the server, at render time. */
export const highlight = async (tree: MarkdownTree): Promise<MarkdownTree> => ({ ...tree, children: await mapBlocks(tree.children, highlightBlock) })
