// The types of runtime/scripts/hfs/architecture/config.mjs, the part the specs call: the config is handed on unread.

/** The architecture configuration of a repository. */
export interface ArchitectureConfig {
  readonly root: string
}

/** Load the architecture configuration of the repository at `repositoryRoot`. */
export declare function loadArchitectureConfig(repositoryRoot: string, options?: { readonly hfs?: unknown }): ArchitectureConfig
