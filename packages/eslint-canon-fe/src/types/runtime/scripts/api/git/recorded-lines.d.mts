// The types of runtime/scripts/api/git/recorded-lines.mjs.

/** The line count at the branch's merge base, null for a confirmed new file, or `unavailable` for unreadable history. */
export declare const recordedLines: (
  filename: string,
  options?: { readonly source?: string } | string,
) => number | null | "unavailable"
