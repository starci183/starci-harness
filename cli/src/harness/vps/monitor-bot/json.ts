/**
 * Reading parsed JSON without trusting it: a path into a value, and the plain types it may hold, each falling back when the value is not
 * that type. Every answer of Prometheus, Loki, Alertmanager, Docker, Telegram and every config the bot reads goes through these.
 */

/** The value at `path` inside `value`, or undefined when any step is missing or not an object or array. */
export const at = (value: unknown, ...path: readonly (string | number)[]): unknown => {
    let current: unknown = value
    for (const step of path) {
        if (current === null || typeof current !== "object") return undefined
        current = (current as Record<string | number, unknown>)[step]
    }
    return current
}

/** A string, or `fallback`. */
export const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)

/** A number (a numeric string too, as Prometheus writes its samples), or NaN. */
export const asNumber = (value: unknown): number => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN)

/** An array, or an empty one. */
export const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as unknown[]) : [])

/** The string fields of an object (labels, annotations), every other field dropped. */
export const asLabels = (value: unknown): Record<string, string> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}
