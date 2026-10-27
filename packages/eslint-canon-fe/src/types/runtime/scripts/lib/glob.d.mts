// The types of runtime/scripts/lib/glob.mjs.

/** Every alternative a `{a,b}` pattern spells, braces expanded left to right. */
export declare function braceVariants(value: string): string[]

/** The anchored RegExp of one brace-free glob, read as a posix path. */
export declare function globExpression(value: string): RegExp
