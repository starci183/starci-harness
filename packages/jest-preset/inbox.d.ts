/** One claim or release of a delivery. */
export interface InboxEntry {
  readonly source: string
  readonly eventId: string
}
/** The inbox operations `failNext` can make reject. */
export type InboxOperation = "claim" | "release" | "runClient" | "sweepClients"

/** The client operation namespace, exact key and JSON request whose outcome the inbox stores. */
export interface InboxClientOperation {
  readonly principalId: string
  readonly operation: string
  readonly idempotencyKey: string
  readonly request: unknown
}

/** A client claim with the manager passed by its caller. */
export interface InboxClientEntry extends InboxEntry {
  readonly tx: unknown
  readonly inTransaction: boolean
}

/** One retention sweep with the cutoff instant and manager passed by its caller. */
export interface InboxSweep {
  readonly cutoff: Date
  readonly tx: unknown
  readonly inTransaction: boolean
}

/** An `Inbox` double with the behaviour of the real claim. */
export interface FakeInbox {
  /** True for the first claim of a (source, eventId) pair, false for every later one until it is released. */
  claim(source: string, eventId: string): Promise<boolean>
  /** Gives an ordinary delivery claim back while preserving client receipts and their outcomes. */
  release(source: string, eventId: string): Promise<void>
  /** Runs once for the client namespace and key, replays the JSON outcome and refuses a different body. */
  runClient<T>(request: InboxClientOperation, tx: unknown, effect: () => Promise<T>): Promise<T>
  /** Deletes at most one batch of completed client claims older than the cutoff. */
  sweepClients(cutoff: Date, tx: unknown): Promise<number>
  /** Marks a pair as already claimed (a redelivery). */
  seen(source: string, eventId: string): void
  /** Makes the next call of `operation` reject with `error`, once. */
  failNext(operation: InboxOperation, error: Error): void
  /** Every claim, in order, duplicates included. */
  readonly claims: ReadonlyArray<InboxEntry>
  /** The pairs held now: claimed and not released. */
  readonly claimed: ReadonlyArray<InboxEntry>
  /** Every release, in order. */
  readonly released: ReadonlyArray<InboxEntry>
  /** Every client claim with its manager; this double records transaction ownership, not database commit semantics. */
  readonly clientEntries: ReadonlyArray<InboxClientEntry>
  /** Every sweep attempt with its cutoff and transaction, including a scripted failure. */
  readonly sweeps: ReadonlyArray<InboxSweep>
  clear(): void
}

/** The inbox double. Pass a driven clock to test retention; omitted clocks stamp client claims at the Unix epoch. */
export declare function fakeInbox(clock?: { now(): Date }): FakeInbox
