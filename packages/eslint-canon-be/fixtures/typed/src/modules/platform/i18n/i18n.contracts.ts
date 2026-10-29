/** The locale of the current request. */
export interface RequestLocale {
    /** The language tag. */
    readonly tag: string
}

/** What an owner writes in its `messages/<owner>.messages.ts`: one flat key to text map per language, the same keys in each. */
export interface MessageBundle {
    /** Vietnamese texts by key. */
    readonly vi: Readonly<Record<string, string>>
    /** English texts by key. */
    readonly en: Readonly<Record<string, string>>
}
