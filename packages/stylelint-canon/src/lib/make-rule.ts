/**
 * One constructor for every rule of the canon, so each is an error by construction: a rule takes `true` (and
 * an optional `{ appTokens }` secondary), never `null`, `false` or a severity downgrade, and reports through one
 * path. Severity is not configurable here; the factory config sets `defaultSeverity: "error"`.
 */
import type { Node, Root } from "postcss"
import stylelint from "stylelint"
import type { Plugin, PostcssResult, Rule } from "stylelint"

const { createPlugin, utils } = stylelint

const isString = (value: unknown): boolean => typeof value === "string"

/** The secondary option of a rule: the repository's own token names. */
export interface RuleSecondary {
  appTokens?: string[]
}

/** The extra location a report may carry: the word of the node the finding points at. */
export interface ReportExtra {
  word?: string
}

/** One message builder. */
export type MessageBuilder = (...args: never[]) => string

/** The context a rule body runs with. `M` is the rule's message builders by key. */
export interface RuleRun<M extends Record<string, MessageBuilder>> {
  root: Root
  report: <K extends keyof M>(node: Node, key: K, args: Parameters<M[K]>, extra?: ReportExtra) => void
  options: { appTokens: string[] }
}

/** What `makeRule` returns: the plugin object and the pieces it is built from. */
export interface MadeRule {
  name: string
  ruleName: string
  rule: Rule<true, RuleSecondary | undefined>
  plugin: Plugin
}

/**
 * @param name short rule name, published as `starci/<name>`
 * @param messages message builders by key
 * @param run the rule body
 */
export function makeRule<M extends Record<string, MessageBuilder>>(
  name: string,
  messages: M,
  run: (ctx: RuleRun<M>) => void,
): MadeRule {
  const ruleName = `starci/${name}`
  const built = utils.ruleMessages(ruleName, messages)

  const base = (primary: true, secondary: RuleSecondary | undefined) => (root: Root, result: PostcssResult): void => {
    const valid = utils.validateOptions(
      result,
      ruleName,
      { actual: primary, possible: [true] },
      { actual: secondary, possible: { appTokens: [isString] }, optional: true },
    )
    if (!valid) return
    const report = <K extends keyof M>(node: Node, key: K, args: Parameters<M[K]>, extra: ReportExtra = {}): void =>
      utils.report({ ruleName, result, node, message: build(built[key], args), ...extra })
    run({ root, report, options: { appTokens: secondary?.appTokens ?? [] } })
  }
  const rule = Object.assign(base, { ruleName, messages: built })
  // `meta` is assigned after `createPlugin` types the rule: stylelint's `RuleMeta` insists on a `url` this canon never set.
  const plugin = createPlugin(ruleName, rule)
  Object.assign(rule, { meta: { fixable: false } })

  return { name, ruleName, rule, plugin }
}

/** Calls one message builder with its own arguments. */
function build<F extends MessageBuilder>(builder: F, args: Parameters<F>): string {
  return builder(...args)
}
