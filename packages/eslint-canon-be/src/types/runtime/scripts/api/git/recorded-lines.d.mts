// The types of runtime/scripts/api/git/recorded-lines.mjs (untyped JavaScript), read through `#runtime/*`.

/** The line count at the branch's merge base, null for a confirmed new file, or `unavailable` for unreadable history. */
export declare function recordedLines(filename: string, options?: { source?: string } | string): number | null | "unavailable"
