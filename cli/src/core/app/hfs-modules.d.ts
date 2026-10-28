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
