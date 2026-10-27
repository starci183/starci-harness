// The types of runtime/scripts/api/git/lib.mjs, the parts the specs call.

/** The outcome of one git run. */
export interface GitResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

/** Run git with `args`; `dir` is passed as `-C`, `config` as `-c key=value`. */
export declare const runGit: (
  args: readonly string[],
  options?: {
    readonly cwd?: string | null
    readonly dir?: string | null
    readonly git?: string
    readonly config?: Readonly<Record<string, string>> | null
    readonly [option: string]: unknown
  },
) => GitResult
