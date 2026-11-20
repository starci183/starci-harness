// The slot gate of `starci app add` (design 8.6 R8): a verb whose file tree lands in a slot the app does not have, or one the
// manifest forbids, refuses before anything is planned or written. The slot resolver of the app answers, the same view
// `starci app check` reads; the noun's name is never the test, so a forbidden slot refuses every verb that writes into it, with no noun
// list kept anywhere. The refusal carries no failure code by design: the scaffolders of packages/hfs keep their codes out of the
// runtime catalog (like HFS_SCAFFOLD_LOCK_FAILED).

/** The refusal of a verb the app cannot carry: printed verbatim by the CLI, exit 2, nothing written. */
export class ScaffoldRefusal extends Error {
  constructor(command: string, message: string = `${command}: the app has no slot this verb writes into (the manifest forbids it)`) {
    super(message);
    this.name = 'ScaffoldRefusal';
  }
}

/**
 * The refusal of a pattern noun in a lite app whose topic carries a `liteAdapter` (R212)
 * and no lite template in this package: lite has the pattern, but generating its full-adapter templates would write adapter paths
 * unavailable in lite. The pattern is written by hand using the topic's declared lite adapter until the package carries a lite template.
 */
export class LiteAdapterRefusal extends ScaffoldRefusal {
  constructor(command: string, topics: readonly string[]) {
    super(command, `${command}: the package carries only the full adapter of ${topics.join(', ')}; in a lite app write it on its lite adapter (knowledge/patterns/be/${topics[0]}.yaml liteAdapter)`);
    this.name = 'LiteAdapterRefusal';
  }
}

/**
 * Refuses `command` in a lite app when one of `topics` (pattern topic ids with their parsed documents) carries a `liteAdapter` and
 * has no complete edition-specific file tree: neither a `liteFiles` list nor a place among `liteTemplated`, the topics whose lite
 * templates the package carries.
 */
/** A pattern topic with its parsed document. */
export interface PatternTopic {
  readonly id: string;
  readonly doc?: { readonly liteAdapter?: unknown; readonly liteFiles?: unknown } | null | undefined;
}

export function refuseFullAdapterInLite({ topics, command, liteTemplated = [] }: { topics: readonly PatternTopic[], command: string, liteTemplated?: readonly string[] }): void {
  const adapted = topics.filter(({ id, doc }) => doc?.liteAdapter !== undefined && !liteTemplated.includes(id) && (!Array.isArray(doc.liteFiles) || doc.liteFiles.length === 0)).map(({ id }) => id).sort();
  if (adapted.length) throw new LiteAdapterRefusal(command, adapted);
}

/**
 * Refuses `command` (`add <noun>`, `new <noun>`) when one of `slotIds` - the slots the verb writes into - does not
 * exist for `resolver`'s repository or is forbidden there. `resolver` is the createSlotResolver() view of the app; every scope
 * answers a slot id. A slot id the view does not answer (an unknown id) refuses too: the callers name only slots of the manifest.
 */
/** The createSlotResolver() view of an app, as far as the gate reads it. */
export interface SlotResolverLike {
  slot(id: string): { readonly presence?: string } | null;
}

export function refuseOutsideSlots({ resolver, slotIds, command }: { resolver: SlotResolverLike, slotIds: readonly string[], command: string }): void {
  if (slotIds.some((id) => {
    const slot = resolver.slot(id);
    return slot === null || slot.presence === 'forbidden';
  })) throw new ScaffoldRefusal(command);
}
