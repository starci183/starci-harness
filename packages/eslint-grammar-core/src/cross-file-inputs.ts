/**
 * The files a rule of this canon reads that ESLint's own import graph does not carry.
 *
 * The result cache of `starci app lint` (contexts/project/check-cache.md, ESLint) re-lints a file when it or a file it reaches through imports
 * changed. A rule that reads another file by path, with `fs` (a sibling, a directory listing, a manifest, a module file it follows by hand),
 * has an input the import graph cannot see, so the rule declares it here and the cache dirties the files that depend on it:
 *
 * - `content`: the rule reads the bytes of the files the globs match; a changed, added or removed match dirties the dependants.
 * - `exists`: the rule only asks whether a file is there or lists a folder; an added or removed match dirties the dependants.
 *
 * `globs` are relative to the linted file's folder (`relativeTo: "file"`) or to the side root, the folder of the side's `eslint.config.mjs`
 * (`relativeTo: "side"`); they use `*`, `**`, `?` and `{a,b}`, posix separators. `appliesTo` are side-root globs of the linted files that
 * depend on the input. A declaration may be wider than the read, never narrower: a too wide one costs a lint, a too narrow one a wrong answer.
 * `cross-file-inputs.spec.ts` proves the list complete: every source file that reads the disk is named here or accounted for, and a recorder of
 * file reads checks each rule's real reads against these declarations and the import graph.
 */

/** One input of a rule that the import graph does not carry. */
export interface CrossFileInput {
  /** The published rule name (without the plugin prefix). */
  readonly rule: string
  readonly kind: "content" | "exists"
  readonly relativeTo: "file" | "side"
  readonly globs: readonly string[]
  /** The linted files (side-root globs) whose result depends on the input. */
  readonly appliesTo: readonly string[]
  /** The source file of this package (relative to `src/`) that performs the read; the audit checks it exists and that no reader is missing. */
  readonly reader: string
}

/** Every disk read of this canon's rules beyond the import graph. */
export const crossFileInputs: readonly CrossFileInput[] = [
  // the header an app shell imports is followed into the workspace packages by their manifests and entries
  { rule: "app-shell-frame", kind: "content", relativeTo: "side", globs: ["packages/*/package.json", "packages/*/src/**/*.{ts,tsx}"], appliesTo: ["**/*.{ts,tsx}"], reader: "lib/app-shell-owner-source.ts" },
  { rule: "navbar-cluster", kind: "content", relativeTo: "side", globs: ["packages/*/package.json", "packages/*/src/**/*.{ts,tsx}"], appliesTo: ["**/*.{ts,tsx}"], reader: "lib/app-shell-owner-source.ts" },
  // a page owner is judged by the route files of its app that mount it and the layouts above them
  { rule: "page-tabs-in-header", kind: "content", relativeTo: "side", globs: ["**/src/app/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"], appliesTo: ["**/src/features/pages/**/*.{ts,tsx}"], reader: "lib/page-frame.ts" },
  { rule: "route-page-is-one-page", kind: "content", relativeTo: "side", globs: ["**/src/app/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"], appliesTo: ["**/src/features/pages/**/*.{ts,tsx}"], reader: "lib/page-frame.ts" },
  // the theme an app defines its tokens in: the route slot's globals.css and the brand slot's brand.css
  { rule: "no-unresolved-token-class", kind: "content", relativeTo: "side", globs: ["**/globals.css", "**/brand.css"], appliesTo: ["**/*.{ts,tsx}"], reader: "tokens.ts" },
]
