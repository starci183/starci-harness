// The types of runtime/scripts/hfs/slots.mjs, the part the specs call: the opened resolver is handed on unread.

/** An opened slot resolver. */
export interface OpenedHfs {
  readonly repo: Readonly<Record<string, unknown>>
}

/** Open the slot manifest under `root` for a repository on disk or an in-memory declaration. */
export declare function openHfs(input: {
  readonly root: string
  readonly repoRoot?: string
  readonly declaration?: unknown
  readonly side?: string
}): OpenedHfs
