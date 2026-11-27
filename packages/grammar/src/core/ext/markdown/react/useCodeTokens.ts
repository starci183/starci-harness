"use client"

import { useEffect, useState } from "react"
import type { CodeToken } from "../types.js"

/** The tokens of one text in one language, and which text and language they were made for (a stale answer is never shown). */
type Highlighted = { readonly code: string; readonly language: string; readonly tokens: CodeToken[][] | undefined }

/**
 * The tokens of a text already highlighted in this page, by language then text: a block drawn again (a fold reopened, a tab revisited)
 * colours at once instead of waiting for Shiki a second time. Bounded, the oldest text dropped first, so a long session never grows it.
 */
const done = new Map<string, CodeToken[][] | undefined>()
const DONE_LIMIT = 64

const keyOf = (code: string, language: string): string => `${language}\u0000${code}`

const remember = (key: string, tokens: CodeToken[][] | undefined): void => {
    done.delete(key)
    done.set(key, tokens)
    if (done.size > DONE_LIMIT) {
        const oldest = done.keys().next().value
        if (oldest !== undefined) done.delete(oldest)
    }
}

/**
 * CLIENT HIGHLIGHTING: Shiki's tokens for `code` in `language`, made in the browser, for `CodeBlock tokens` (or a diff's `diffCode(diff)`, whose
 * tokens line up with its rows). Shiki is loaded with a dynamic import on the first call, so a page that never draws code never downloads it;
 * it is the same highlighter and css-variables theme as the server's `highlightCode` (`core/ext/markdown/server/highlight.ts`), whose colours
 * `CodeBlock` maps onto the code palette, so there is no second palette.
 *
 * Returns `undefined` until the tokens are ready, for no `language`, for a language Shiki does not ship, and if Shiki fails to load: the block
 * draws plain text meanwhile and its lines, `highlightLines` and Copy are the same either way. When `code` or `language` changes, the old
 * tokens are dropped at once (never drawn over the new text) and the new ones arrive when ready.
 *
 * ```tsx
 * const tokens = useCodeTokens(code, "ts")
 * return <CodeBlock code={code} language="ts" highlightLines={[[3, 4]]} {...(tokens === undefined ? {} : { tokens })} />
 * ```
 */
export const useCodeTokens = (code: string, language: string | undefined): CodeToken[][] | undefined => {
    const [made, setMade] = useState<Highlighted | undefined>(undefined)
    useEffect(() => {
        if (language === undefined) return undefined
        const key = keyOf(code, language)
        // Highlighted before in this page: the render below already reads it from `done`.
        if (done.has(key)) return undefined
        let isLive = true
        import("../server/highlight.js")
            .then(({ highlightCode }) => highlightCode(code, language))
            .then(
                (tokens) => {
                    remember(key, tokens)
                    if (isLive) setMade({ code, language, tokens })
                },
                // Shiki did not load (offline, a blocked chunk): the block stays plain text, which is still the whole code.
                () => undefined,
            )
        return () => {
            isLive = false
        }
    }, [code, language])
    if (language === undefined) return undefined
    if (made !== undefined && made.code === code && made.language === language) return made.tokens
    const key = keyOf(code, language)
    return done.has(key) ? done.get(key) : undefined
}
