/** Shared helpers of the specs: lint a string as a named file with the canon's own factory config. Not published. */
import stylelint from "stylelint"
import type { Warning } from "stylelint"
import { starciStylelintConfig } from "./index.ts"
import type { StarciStylelintOptions } from "./index.ts"

/** Where a file sits decides which kind of stylesheet it is. */
export const FILES = {
  brand: "apps/web/src/modules/brand/brand.css",
  globals: "apps/web/src/app/globals.css",
  module: "apps/web/src/components/Card/Card.module.css",
  css: "apps/web/src/components/Card/card.css",
}

/** Every warning of one lint run. */
export async function lint(code: string, file: string = FILES.module, options: StarciStylelintOptions = {}): Promise<Warning[]> {
  const result = await stylelint.lint({ code, codeFilename: file, config: starciStylelintConfig(options) })
  return result.results[0]?.warnings ?? []
}

/** The text of the warning at `index`; the spec fails when there is none. */
export function textAt(warnings: readonly Warning[], index: number): string {
  const warning = warnings[index]
  if (warning === undefined) throw new Error(`expected a warning at index ${index}, found ${warnings.length}`)
  return warning.text
}

/** The warnings of one rule (short name, without `starci/`). */
export async function lintRule(rule: string, code: string, file: string = FILES.module, options: StarciStylelintOptions = {}): Promise<Warning[]> {
  return (await lint(code, file, options)).filter((warning) => warning.rule === `starci/${rule}`)
}
