/**
 * The files a rule of this canon reads that ESLint's own import graph does not carry.
 *
 * The result cache of `starci app lint` (contexts/project/check-cache.md, ESLint) re-lints a file when it or a file it reaches through imports
 * changed. A rule that reads another file by path, with `fs` (a sibling, a directory listing, a manifest, a module file it follows by hand),
 * has an input the import graph cannot see, so the rule declares it here and the cache dirties the files that depend on it:
 *
 * - `content`: the rule reads the bytes of the files the globs match; a changed, added or removed match dirties the dependants.
 * - `exists`: the rule only asks whether a file is there or lists a folder; an added or removed match dirties the dependants.
 * - `git`: the rule compares the file with git history (the merge-base with the base branch), which no file holds; a change of the merge-base
 *   dirties every dependant of more than `minLines` lines (the rule reads history only for a file over its size budget). `globs` is empty.
 *
 * `globs` are relative to the linted file's folder (`relativeTo: "file"`) or to the side root, the folder of the side's `eslint.config.mjs`
 * (`relativeTo: "side"`); they use `*`, `**`, `?` and `{a,b}`, posix separators. `appliesTo` are side-root globs of the linted files that
 * depend on the input. A declaration may be wider than the read, never narrower: a too wide one costs a lint, a too narrow one a wrong answer.
 * `cross-file-inputs.spec.ts` proves the list complete: every source file that reads the disk is named here or accounted for, and a recorder of
 * file reads checks each rule's real reads against these declarations and the import graph.
 */

/** One input of a rule that the import graph does not carry. */
export interface CrossFileInput {
  /** The published rule name, as the linter's config spells it. */
  readonly rule: string
  readonly kind: "content" | "exists" | "git"
  readonly relativeTo: "file" | "side"
  readonly globs: readonly string[]
  /** For `git`: the line count above which the rule reads history; a file of fewer lines does not depend on it. */
  readonly minLines?: number
  /** The linted files (side-root globs) whose result depends on the input. */
  readonly appliesTo: readonly string[]
  /** The source file of this package (relative to `src/`) that performs the read; the audit checks it exists and that no reader is missing. */
  readonly reader: string
}

/** Every disk read of this canon's rules beyond the import graph. */
export const crossFileInputs: readonly CrossFileInput[] = [
  // the app tokens the config allows are the custom properties every globals.css of an app or package declares
  { rule: "starci/token-only", kind: "content", relativeTo: "side", globs: ["{apps,packages}/*/src/**/globals.css"], appliesTo: ["**/*.css"], reader: "lib/app-tokens.ts" },
  { rule: "starci/no-apply-raw", kind: "content", relativeTo: "side", globs: ["{apps,packages}/*/src/**/globals.css"], appliesTo: ["**/*.css"], reader: "lib/app-tokens.ts" },
  // an @source path must exist beside the stylesheet that names it
  { rule: "starci/source-resolves", kind: "exists", relativeTo: "side", globs: ["**/*"], appliesTo: ["**/*.css"], reader: "source-resolves.ts" },
]
