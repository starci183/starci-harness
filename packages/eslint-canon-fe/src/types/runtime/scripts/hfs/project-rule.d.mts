// The types of runtime/scripts/hfs/project-rule.mjs.
import type { TSESLint } from "@typescript-eslint/utils"
import type { HfsView } from "../../../../lib/hfs-view.ts"
import type { LintEnforcer } from "./architecture/surface.mjs"

/** A rule reporting the graph findings of an enforcer's codes on the linted file. */
export declare const projectRule: (input: {
  readonly enforcer: LintEnforcer
  readonly runtimeRoot: string
  readonly hfsOf: (context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>) => HfsView
}) => TSESLint.RuleModule<"finding", readonly unknown[]>
