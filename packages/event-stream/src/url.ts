import type { EventStreamDefaults, HeadersRecord, Query, QueryValue } from "./types.js"

const ABSOLUTE = /^[a-z][a-z\d+.-]*:/i

/** Lower-cases the names of one or more header sets, later sets winning. */
export const mergeHeaders = (...sets: readonly (HeadersRecord | undefined)[]): HeadersRecord => {
  const merged: HeadersRecord = {}
  for (const set of sets) for (const [name, value] of Object.entries(set ?? {})) merged[name.toLowerCase()] = value
  return merged
}

const queryString = (query: Query): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const values: readonly QueryValue[] = Array.isArray(value) ? value : [value as QueryValue]
    for (const item of values) if (item !== null && item !== undefined) params.append(key, String(item))
  }
  return params.toString()
}

/** `path` under `baseURL` (an absolute path is kept) with the query appended. */
export const buildUrl = (baseURL: string | undefined, path: string, query: Query | undefined): string => {
  const base =
    ABSOLUTE.test(path) || baseURL === undefined || baseURL === ""
      ? path
      : `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
  const search = query === undefined ? "" : queryString(query)
  if (search === "") return base
  return `${base}${base.includes("?") ? "&" : "?"}${search}`
}

/** The delay before the next attempt after `failures` failures: doubling from the base, capped, and never below a delay the server named. */
export const backoffDelay = (
  failures: number,
  retry: EventStreamDefaults["retry"],
  serverRetryMs: number | undefined,
  random: () => number,
): number => {
  const base = serverRetryMs ?? retry.baseMs
  const ceiling = Math.max(retry.maxMs, base)
  const delay = Math.min(base * 2 ** Math.max(failures - 1, 0), ceiling)
  const spread = retry.jitter ? delay * (0.5 + random() * 0.5) : delay
  return Math.max(Math.round(spread), serverRetryMs ?? 0)
}
