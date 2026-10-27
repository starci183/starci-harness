/** The declared contract of ./sibling-canon.mjs: the front-end canon loaded through its package entry. */
import type { CanonRule } from "./typed/tester.mjs"

/** The front-end canon's gathered plugin. */
export declare const fePlugin: { readonly rules: Readonly<Record<string, CanonRule>> }
