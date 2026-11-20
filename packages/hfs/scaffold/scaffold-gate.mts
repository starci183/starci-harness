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
 * The refusal of a pattern noun whose topic carries an `adapter` (R212) and no templates in this package: generating the topic's
 * general file tree would write paths its adapter does not have. The pattern is written by hand on the topic's declared adapter until
 * the package carries its templates.
 */
export class AdapterRefusal extends ScaffoldRefusal {
  constructor(command: string, topics: readonly string[]) {
    super(command, `${command}: the package carries no templates for ${topics.join(', ')}; write it by hand on the adapter the topic declares (knowledge/patterns/be/${topics[0]}.yaml adapter)`);
    this.name = 'AdapterRefusal';
  }
}

/** A pattern topic with its parsed document. */
export interface PatternTopic {
  readonly id: string;
  readonly doc?: { readonly adapter?: unknown } | null | undefined;
}

/** Refuses `command` when one of `topics` (pattern topic ids with their parsed documents) carries an `adapter` and is not among `templated`, the topics whose templates the package carries. */
export function refuseUntemplatedAdapter({ topics, command, templated = [] }: { topics: readonly PatternTopic[], command: string, templated?: readonly string[] }): void {
  const adapted = topics.filter(({ id, doc }) => doc?.adapter !== undefined && !templated.includes(id)).map(({ id }) => id).sort();
  if (adapted.length) throw new AdapterRefusal(command, adapted);
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
