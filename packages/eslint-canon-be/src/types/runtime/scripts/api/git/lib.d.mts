// The types of runtime/scripts/api/git/lib.mjs (a bundled copy of @starci/hfs's runtime, untyped JavaScript), read through
// `#runtime/*` so a consumer in another package (the front-end canon's specs) sees the same contract as this package's own.
import type { SpawnSyncReturns } from "node:child_process"

/** `git args` in `cwd`, or `git -C dir args`; `config` prefixes one `-c key=value` per entry. */
export declare function runGit(
    args: readonly string[],
    options?: { cwd?: string | null; dir?: string | null; git?: string; config?: Readonly<Record<string, string>> | null },
): SpawnSyncReturns<string>
