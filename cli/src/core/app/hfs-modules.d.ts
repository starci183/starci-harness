// The typed surface of the two @starci/hfs entries the CLI loads; the package ships JavaScript only.

declare module "@starci/hfs" {
    /** What `main` reads, writes to and where it runs; the rest of its seams are test doubles the CLI never passes. */
    interface HfsIo {
        readonly cwd: string
        /** The CLI that runs @starci/hfs: its version is the starci-harness an app is judged and scaffolded at. */
        readonly harness: { readonly version: string }
        /** Replaces the process stdin of a verb that reads one (`secret set`): the value it returns stays in memory. */
        readonly stdin?: (() => string) | undefined
        readonly stdout: (text: string) => void
        readonly stderr: (text: string) => void
    }

    /** Runs one `starci app` verb (`argv[0]`) with its arguments; resolves to its exit code. */
    export function main(argv: readonly string[], io: HfsIo): Promise<number>
}

declare module "@starci/hfs/form-bounds" {
    /** The GraphQL Code Generator plugin: the typed form limits of a schema's input-field directives, as module source. */
    export function inputBoundsPlugin(schema: unknown): string
    /** The module source of no GraphQL form limits, for an app whose last schema snapshot is gone. */
    export function emptyInputBoundsSource(): string
    /** Refuses differing bounds on one input name across several service schemas. */
    export function assertCompatibleInputBounds(schemas: Readonly<Record<string, unknown>>): void
    /** The module source of REST_INPUT_BOUNDS from emitted OpenAPI contracts, keyed by service. */
    export function openApiBoundsSource(contracts: Readonly<Record<string, unknown>>): string
}

// The custody readers `starci app secret materialize` uses, with which a live suite's verify reads its declared keys (harness/custody.ts).
declare module "@starci/hfs/runtime/scripts/hfs/secret-store.mjs" {
    /** The sealed member files (`<slug>.enc`) of an environment's secrets folder, sorted; none when the folder is absent. */
    export function sealedFiles(directory: string): string[]
    /** The decrypted KEY map of one sealed member, through the sops seam. */
    export function readMap(file: string, sops: unknown): Readonly<Record<string, string>>
}

declare module "@starci/hfs/runtime/scripts/hfs/secret-document.mjs" {
    /** The key names a sealed document holds, its format and recipients, read without decrypting anything. */
    export function envelopeOf(text: string): { readonly format: string; readonly keys: readonly string[]; readonly recipients: readonly string[] }
}

declare module "@starci/hfs/runtime/scripts/hfs/secret-sops.mjs" {
    /** The sops seam of the app at `repoRoot`, with its age identity resolved as `starci app secret` resolves it. */
    export function defaultSops(env?: NodeJS.ProcessEnv, repoRoot?: string): unknown
}
