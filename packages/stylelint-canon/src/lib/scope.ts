import type { Root } from "postcss"

/**
 * Which kind of stylesheet a file is. Every rule reads the kind from the path, so one flat config governs a
 * whole repository and no per-file override can exist to turn a rule off.
 */

/** The single file that may hold raw brand values, relative to any app or package root. */
export const BRAND_FILE = "modules/brand/brand.css"

const normalize = (file: string | undefined): string => String(file || "").replaceAll("\\", "/")

/** `"brand" | "globals" | "module" | "css"` for a stylesheet path. */
export function fileKind(file: string | undefined): "brand" | "globals" | "module" | "css" {
  const path = normalize(file)
  if (path === BRAND_FILE || path.endsWith(`/${BRAND_FILE}`)) return "brand"
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (base === "globals.css") return "globals"
  if (base.endsWith(".module.css")) return "module"
  return "css"
}

/** The file of a postcss root, or "" for code linted without a name. */
export const fileOf = (root: Root): string => root.source?.input?.file ?? ""

// -- the two themes of the brand layer -------------------------------------------------------------------------

const quoted = `["']?`
const LIGHT = new RegExp(String.raw`^(?::root|html|\.light|\[data-theme=${quoted}light${quoted}\]|:root\[data-theme=${quoted}light${quoted}\]|:root\.light)$`)
const DARK = new RegExp(String.raw`^(?:\.dark|\[data-theme=${quoted}dark${quoted}\]|:root\[data-theme=${quoted}dark${quoted}\]|:root\.dark|html\.dark)$`)
/** The selectors that match the document root whatever the theme is. */
const ALWAYS = /^(?::root|html)$/
const DARK_MEDIA = /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/

/** `"light"`, `"dark"` or null for one selector of a brand-layer rule (`:root`, `.light`, `.dark`...). */
export function themeOfSelector(selector: string): "light" | "dark" | null {
  const text = selector.trim()
  if (LIGHT.test(text)) return "light"
  if (DARK.test(text)) return "dark"
  return null
}

/** True for the selector of the follow-the-system block inside `@media (prefers-color-scheme: dark)`. */
export const isSystemSelector = (selector: string): boolean => ALWAYS.test(selector.trim())

/** True for the prelude of the dark media query. */
export const isDarkMedia = (params: string): boolean => DARK_MEDIA.test(params.trim())
