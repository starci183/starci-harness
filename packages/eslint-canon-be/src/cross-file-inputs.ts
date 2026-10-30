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
    // readiness: follows module files of the controller's folders and the local imports of those by hand
    { rule: "ready-real", kind: "content", relativeTo: "side", globs: ["src/**/*.ts"], appliesTo: ["**/transport/http/**/*.ts"], reader: "health-ready.ts" },
    { rule: "health-signals", kind: "content", relativeTo: "side", globs: ["src/**/*.ts"], appliesTo: ["**/main.ts"], reader: "health-ready.ts" },
    // a unit spec reads its sibling subject (value schema, value-object classes)
    { rule: "spec-builds-with-testing-module", kind: "content", relativeTo: "file", globs: ["*.ts"], appliesTo: ["**/*.spec.ts"], reader: "lib/schema-values.ts" },
    { rule: "spec-builds-with-testing-module", kind: "content", relativeTo: "file", globs: ["*.ts"], appliesTo: ["**/*.spec.ts"], reader: "lib/subject-values.ts" },
    { rule: "spec-no-new-subject", kind: "content", relativeTo: "file", globs: ["*.ts"], appliesTo: ["**/*.spec.ts"], reader: "lib/subject-values.ts" },
    // a spec and its subject must sit side by side
    { rule: "unit-test-colocated", kind: "exists", relativeTo: "file", globs: ["*.ts"], appliesTo: ["**/*.ts"], reader: "testing.ts" },
    // a module has a sibling definition and options file
    { rule: "module-definition-required", kind: "exists", relativeTo: "file", globs: ["*.module-definition.ts", "*.options.ts"], appliesTo: ["**/*.module.ts"], reader: "module-shape.ts" },
    // the dependency manifest (the app's, one level above be/) and the SDK imports of every integration owner
    { rule: "third-party-import-owner", kind: "content", relativeTo: "side", globs: ["package.json", "../package.json"], appliesTo: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"], reader: "third-party-owner.ts" },
    { rule: "third-party-import-owner", kind: "content", relativeTo: "side", globs: ["src/modules/integrations/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"], appliesTo: ["src/modules/integrations/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"], reader: "third-party-owner.ts" },
]
