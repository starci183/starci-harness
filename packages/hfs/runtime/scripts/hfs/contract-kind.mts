// contract-kind.mts - which contract an api app serves (hfs.json `sides.be.apps[].contract`, contexts/code/be/transport.md BE-TRANSPORT-1):
// `graphql`, the default, a code-first schema committed as `contracts/<app>/schema.graphql`; or `rest`, controllers described by a committed
// OpenAPI 3 document `contracts/<app>/openapi.json` that `starci app emit` builds with @nestjs/swagger. An app that declares none serves graphql.

/** The contract kinds an api app may declare. */
export const CONTRACT_KINDS = Object.freeze(['graphql', 'rest'] as const);
/** One contract kind. */
export type ContractKind = (typeof CONTRACT_KINDS)[number];
/** The kind of an api app that declares none. */
export const DEFAULT_CONTRACT: ContractKind = 'graphql';

/** The contract kind of an app entry of hfs.json (or of a resolved view): its declared `contract`, else the default. */
export const contractOf = (app: { contract?: unknown } | null | undefined): ContractKind => (app?.contract === 'rest' ? 'rest' : DEFAULT_CONTRACT);

/** The repository-relative path (of the be side) of a rest app's document head, the `OPENAPI` export the emit merges with the scanned paths. */
export const openapiHeadPath = (app: string): string => `apps/${app}/src/openapi.ts`;
