/**
 * Accessibility landmarks for ordinary React route composition.
 *
 * Native HTML landmarks are intentionally independent of component implementation details. The
 * application may pass children through layouts and pages normally.
 */
import type { Recommended, Rules } from "./lib/rule.ts"

/** No custom landmark AST rule is needed; semantic ownership is enforced by the component code. */
export const rules: Rules = {}

/** No repository audit is coupled to landmark ownership. */
export const audits: Readonly<Record<string, never>> = {}

/** The landmark contribution has no mandatory rule levels. */
export const recommended: Recommended = {}
