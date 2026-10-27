// The types of runtime/scripts/lib/line-count.mjs.

/** The line count of a text; a trailing newline does not open a line. */
export declare const lineCount: (text: unknown) => number

/** The line count above which a file may not grow: the soft budget when `hardGrowth` holds, else no limit. */
export declare const hardGrowthLines: (budget: { readonly soft: number; readonly hardGrowth?: boolean }) => number
