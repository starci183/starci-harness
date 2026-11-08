/** True for a non-null object (an array included), so untrusted parsed data can be narrowed before any key is read. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

/** True for a non-null object that is not an array: a parsed JSON object, never a list. */
export const isPlainRecord = (value: unknown): value is Record<string, unknown> => isRecord(value) && !Array.isArray(value)
