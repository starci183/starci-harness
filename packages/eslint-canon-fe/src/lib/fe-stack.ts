/**
 * The one door between the front-end lint rules and the fe-stack catalog (`knowledge/hfs/fe-stack.yaml`): for each common
 * front-end concern the ONE canonical library, its HFS home and the alternatives a front end never imports.
 *
 * The catalog is read from this package's `runtime/` copy, the same way the slot manifest and the canon pins are (a byte copy
 * of the runtime's knowledge file, refreshed by `scripts/hfs/sync-runtime.mjs`), so a rule in a product repository judges
 * against the catalog of the canon version it installed. A rule that needs the catalog and finds none stops the lint run
 * with an error naming the fix: a rule must not guess which libraries are forbidden.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseYaml } from "#runtime/engine/yaml.mjs"
import { globExpression } from "#runtime/scripts/lib/glob.mjs"
import { RUNTIME_ROOT } from "./package-root.ts"

const CATALOG = join(RUNTIME_ROOT, "knowledge", "hfs", "fe-stack.yaml")

/** A concern of the catalog: its canonical packages, its HFS home and the packages it forbids (the catalog's own schema). */
export interface FeConcern {
  readonly id: string
  readonly tier?: string
  readonly packages?: readonly string[]
  readonly home?: readonly string[]
  readonly pattern?: string
  readonly forbids?: readonly string[]
  readonly why?: string
}

/** A forbidden package glob and the concern that forbids it. */
export interface FeForbiddenPattern {
  readonly expression: RegExp
  readonly concern: FeConcern
}

/** The parsed catalog. */
export interface FeStack {
  readonly concerns: readonly FeConcern[]
  readonly forbidden: ReadonlyMap<string, FeConcern>
  readonly patterns: readonly FeForbiddenPattern[]
}

/**
 * True for a concern row. The catalog is this package's own shipped file, its schema proved by fe-stack.spec; a row is read
 * as a concern once it is an object, as the catalog has always been read.
 */
const isConcern = (row: unknown): row is FeConcern => typeof row === "object" && row !== null

/** The `concerns` of a parsed catalog document. */
const concernsOf = (document: unknown): unknown =>
  typeof document === "object" && document !== null && "concerns" in document ? document.concerns : undefined

/** The code or message of a read failure. */
const reasonOf = (error: unknown): unknown => {
  if (typeof error !== "object" || error === null) return undefined
  if ("code" in error && error.code !== undefined && error.code !== null) return error.code
  return "message" in error ? error.message : undefined
}

let loaded: FeStack | null = null

/**
 * The parsed catalog: its concerns, and every forbidden package mapped to the concern that forbids it.
 *
 * @returns The catalog.
 */
export const feStack = (): FeStack => {
  if (loaded) return loaded
  let text: string
  try {
    text = readFileSync(CATALOG, "utf8")
  } catch (error) {
    throw new Error(`@starci/eslint-canon-fe reads the fe-stack catalog from runtime/knowledge/hfs/fe-stack.yaml and it is missing (${String(reasonOf(error))}): regenerate the runtime copy (scripts/hfs/sync-runtime.mjs)`)
  }
  const concerns: unknown = concernsOf(parseYaml(text))
  if (!Array.isArray(concerns) || concerns.length === 0) throw new Error("runtime/knowledge/hfs/fe-stack.yaml declares no concerns: the fe-stack catalog is malformed")
  const rows: FeConcern[] = concerns.map((row: unknown) => {
    if (!isConcern(row)) throw new TypeError(`runtime/knowledge/hfs/fe-stack.yaml has a concern that is not an object: ${String(row)}`)
    return row
  })
  const forbidden = new Map<string, FeConcern>()
  for (const concern of rows) for (const name of concern.forbids ?? []) forbidden.set(String(name), concern)
  const patterns = [...forbidden].filter(([name]) => name.includes("*")).map(([name, concern]) => ({ expression: globExpression(name), concern }))
  loaded = Object.freeze({ concerns: Object.freeze(rows), forbidden, patterns: Object.freeze(patterns) })
  return loaded
}

/**
 * The package a module specifier names (`@scope/name` or `name`, its subpath dropped), or null for a relative, aliased,
 * node-builtin or empty specifier.
 *
 * @param specifier - The module specifier.
 * @returns The package name.
 */
export const packageNameOf = (specifier: unknown): string | null => {
  const text = typeof specifier === "string" ? specifier : ""
  if (text === "" || text.startsWith(".") || text.startsWith("/") || text.startsWith("@/") || text.startsWith("~/") || text.startsWith("node:")) return null
  const parts = text.split("/")
  if (text.startsWith("@")) return parts.length >= 2 && parts[1] !== "" ? `${parts[0]}/${parts[1]}` : null
  return parts[0] ?? null
}

/**
 * The concern whose `forbids` lists the package a specifier names, else null.
 *
 * @param specifier - The module specifier.
 * @returns The concern (`{ id, packages, home, pattern, forbids, why }`).
 */
export const forbiddingConcern = (specifier: unknown): FeConcern | null => {
  const name = packageNameOf(specifier)
  if (name === null) return null
  const { forbidden, patterns } = feStack()
  return forbidden.get(name) ?? patterns.find(({ expression }) => expression.test(name))?.concern ?? null
}

/**
 * The canonical packages of a concern.
 *
 * @param id - The concern id (`icons`, `graphql`, ...).
 * @returns Its packages; empty for an unknown concern.
 */
export const canonicalPackages = (id: string): readonly string[] => feStack().concerns.find((concern) => concern.id === id)?.packages ?? []
