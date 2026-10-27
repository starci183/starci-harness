/** The declared contract of ./size-growth.mjs: the shared size-growth assertions of both canons. */
import type { CanonRule, CanonRuleTester } from "./typed/tester.mjs"

/** `count` lines of inert exports. */
export declare const lines: (count: number) => string

/** Register the shared size-growth assertions against one side's rule and tester. */
export declare function sizeGrowthSharedSpec(input: {
    side: string
    tester: CanonRuleTester
    fileSizeGrowth: CanonRule
    budget: number
    fileName?: string
}): void
