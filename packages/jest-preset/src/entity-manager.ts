/// <reference types="jest" preserve="true" />

/**
 * `mockEntityManager()` and `fakeTransaction()` -- the one typed double of a typeorm `EntityManager`.
 *
 * `mockEntityManager(stubs)` takes the answers a spec describes as `{ method: [Entity, result] }` (`query` takes
 * `[sql, rows]`; several answers of one method are a list of pairs). Every method is a `jest.fn()`, so
 * `expect(em.save).toHaveBeenCalledWith(...)` works, and a method the subject calls that the spec did NOT stub throws
 * `mockEntityManager: em.<method>() was called but this spec did not stub it`. The absence of a stub is therefore the
 * proof that the subject made no such call. A method stubbed for another entity (or another sql text) throws too and names
 * both. Answers of one method and one entity are handed out in order and the last one repeats. There is no typeorm import
 * at run time: the types come from `typeorm` (type-only), the runtime is a Proxy.
 *
 * `create(Entity, plain)` is pure construction and works without a stub. `transaction` needs `fakeTransaction`.
 *
 * `fakeTransaction(em)` makes `em.transaction(work)` (and `em.transaction(isolation, work)`) run `work` with a scoped view
 * of the same double and record how it ended (`commit` when `work` resolves, `rollback` when it throws and the error is
 * rethrown) and which writes it made, so a spec can assert that a rolled-back transaction committed nothing.
 */
import type { DeleteResult, EntityManager, InsertResult, UpdateResult } from "typeorm"
import { createMock, jestFn } from "./mock.ts"
import type { MockOf } from "./mock.ts"

/** A typed double of `EntityManager`: assignable wherever an `EntityManager` is required, every method a jest mock. */
export type MockEntityManager = MockOf<EntityManager>

/** An entity class. */
export type EntityClass<E extends object = object> = new (...args: never[]) => E

type Row<C extends EntityClass> = InstanceType<C>
type Write<T> = Partial<Omit<T, "raw">> & { readonly raw?: unknown }

/** The result type of each entity-taking `EntityManager` method, for the entity class `C`. */
export interface EntityAnswers<C extends EntityClass> {
  findOne: Row<C> | null
  findOneBy: Row<C> | null
  findOneOrFail: Row<C>
  findOneByOrFail: Row<C>
  find: ReadonlyArray<Row<C>>
  findBy: ReadonlyArray<Row<C>>
  findAndCount: readonly [ReadonlyArray<Row<C>>, number]
  findAndCountBy: readonly [ReadonlyArray<Row<C>>, number]
  count: number
  countBy: number
  exists: boolean
  existsBy: boolean
  save: Row<C> | ReadonlyArray<Row<C>>
  remove: Row<C> | ReadonlyArray<Row<C>>
  softRemove: Row<C> | ReadonlyArray<Row<C>>
  recover: Row<C> | ReadonlyArray<Row<C>>
  insert: Write<InsertResult>
  update: Write<UpdateResult>
  upsert: Write<InsertResult>
  delete: Write<DeleteResult>
  softDelete: Write<UpdateResult>
  restore: Write<UpdateResult>
  increment: Write<UpdateResult>
  decrement: Write<UpdateResult>
}

/** The methods a spec may stub as `[Entity, result]`. */
export type EntityMethod = keyof EntityAnswers<EntityClass>

type Pair<M extends EntityMethod, C extends EntityClass> = readonly [entity: C, result: EntityAnswers<C>[M]]
type Untyped = readonly [unknown, unknown]

/** One stub: `[Entity, result]` (`query`: `[sql, rows]`), or a list of such pairs answered in order. */
export type StubOf<M extends string, V> = M extends "query"
  ? readonly [sql: string, rows: unknown] | ReadonlyArray<readonly [sql: string, rows: unknown]>
  : M extends EntityMethod
    ? V extends readonly [infer C extends EntityClass, unknown]
      ? Pair<M, C>
      : V extends ReadonlyArray<readonly [infer C extends EntityClass, unknown]>
        ? ReadonlyArray<Pair<M, C>>
        : never
    : never

/** The stubs of a spec, checked entry by entry against the entity each one names. */
export type StubsOf<S> = { readonly [M in keyof S & string]: StubOf<M, S[M]> }

/**
 * A strict `EntityManager` double. Describe what the subject should see, `{ findOne: [OrderEntity, order] }`; any method
 * the subject calls that the spec did not stub throws an error naming the method, and a wrong entity or sql text throws
 * too. Results are typed against the entity: `findOne: [OrderEntity, 5]` is a compile error.
 */
export type MockEntityManagerFactory = <
  const S extends { readonly [M in string]?: Untyped | ReadonlyArray<Untyped> } = Record<never, never>,
>(stubs?: S & StubsOf<S>) => MockEntityManager

/** A write made inside a transaction. */
export interface TransactionWrite {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

/** The transaction attached to a double by `fakeTransaction`. */
export interface FakeTransaction<M extends MockEntityManager = MockEntityManager> {
  /** The double whose `transaction(work)` runs `work`. */
  readonly em: M
  /** How each transaction ended, in call order. */
  readonly outcomes: ReadonlyArray<"commit" | "rollback" | "pending">
  /** Number of transactions that committed. */
  readonly commits: number
  /** Number of transactions that rolled back (the callback threw; the error was rethrown). */
  readonly rollbacks: number
  /** The writes of the transactions that committed. */
  readonly committedWrites: ReadonlyArray<TransactionWrite>
  /** The writes of the transactions that rolled back: what a real rollback would have discarded. */
  readonly rolledBackWrites: ReadonlyArray<TransactionWrite>
}

/** Makes `em.transaction(work)` run `work` with a scoped view whose queryRunner stays active until commit or rollback. */
export type FakeTransactionFactory = <M extends MockEntityManager = MockEntityManager>(em?: M) => FakeTransaction<M>

/** The manager views handed to a transaction body; `recordingEventBus` and `recordingQueueOutbox` ask whether a manager is one of them. */
const TRANSACTION_MANAGERS = new WeakSet<object>()

/** Methods that change data; a write made inside a transaction is recorded on it. */
const WRITE_METHODS = new Set([
  "save", "insert", "update", "delete", "remove", "softRemove", "softDelete", "recover", "restore", "upsert",
  "increment", "decrement", "clear",
])
const WRITE_SQL = /^\s*(insert|update|delete|upsert|merge|truncate)\b/i

const describeTarget = (target: unknown): string =>
  typeof target === "function" ? target.name || "<anonymous class>" : JSON.stringify(String(target)).slice(0, 80)

const isPair = (value: unknown): value is [unknown, unknown] =>
  Array.isArray(value) && value.length === 2 && (typeof value[0] === "function" || typeof value[0] === "string")

interface TableEntry {
  readonly target: unknown
  readonly result: unknown
  used: boolean
}

/** `{ method: [target, result] | [[target, result], ...] }` as `Map<method, Array<{ target, result, used }>>`. */
function tableOf(stubs: Record<string, unknown>): Map<string, TableEntry[]> {
  const table = new Map<string, TableEntry[]>()
  for (const [method, value] of Object.entries(stubs)) {
    const pairs: unknown = isPair(value) ? [value] : value
    if (!Array.isArray(pairs) || !pairs.every(isPair)) {
      throw new Error(`mockEntityManager: the stub of em.${method}() must be [Entity, result] (em.query: [sql, rows]) or a list of such pairs`)
    }
    table.set(method, pairs.map(([target, result]) => ({ target, result, used: false })))
  }
  return table
}

interface TransactionRun {
  outcome: "pending" | "commit" | "rollback"
  readonly writes: TransactionWrite[]
}

/**
 * The kit over a function factory (`makeFn(implementation)`); `mockEntityManager` and `fakeTransaction` below bind it to
 * `jest.fn`. The seam lets the package spec run the kit without a jest runtime.
 */
export function createEntityManagerKit(makeFn: (implementation?: (...args: never[]) => unknown) => unknown): {
  mockEntityManager: MockEntityManagerFactory
  fakeTransaction: FakeTransactionFactory
} {
  function answerOf(method: string, entries: TableEntry[] | undefined): (...args: unknown[]) => unknown {
    if (entries === undefined) {
      return () => {
        throw new Error(
          `mockEntityManager: em.${method}() was called but this spec did not stub it. Stub it with mockEntityManager({ ${method}: [Entity, result] }); an unstubbed call means the subject reached the database where the spec says it must not.`,
        )
      }
    }
    return async (...args: unknown[]) => {
      const matches = entries.filter((entry) => entry.target === args[0])
      const last = matches[matches.length - 1]
      if (last === undefined) {
        throw new Error(
          `mockEntityManager: em.${method}(${describeTarget(args[0])}) was called but this spec stubbed em.${method} only for ${entries.map((entry) => describeTarget(entry.target)).join(", ")}`,
        )
      }
      const entry = matches.find((candidate) => !candidate.used) ?? last
      entry.used = true
      return entry.result
    }
  }

  function mockEntityManager(stubs?: Record<string, unknown>): MockEntityManager
  function mockEntityManager(stubs: Record<string, unknown> = {}): object {
    const table = tableOf(stubs)
    const create = makeFn((target: new () => object, plain: object) => Object.assign(new target(), plain))
    return createMock((method) => makeFn(answerOf(method, table.get(method))))({ create })
  }

  function fakeTransaction<M extends MockEntityManager = MockEntityManager>(em?: M): FakeTransaction<M>
  function fakeTransaction(em: MockEntityManager = mockEntityManager()): FakeTransaction {
    const runs: TransactionRun[] = []
    const scopedFor = (run: TransactionRun): MockEntityManager => {
      const view: MockEntityManager = new Proxy(em, {
        get(target, property, receiver): unknown {
          if (property === "queryRunner") return { get isTransactionActive() { return run.outcome === "pending" } }
          const value: unknown = Reflect.get(target, property, receiver)
          if (property === "transaction") {
            return (...args: unknown[]): unknown => {
              const work = args[args.length - 1]
              if (typeof work !== "function") throw new TypeError(`${String(work)} is not a function`)
              return work(view)
            }
          }
          if (typeof property !== "string" || typeof value !== "function") return value
          if (!WRITE_METHODS.has(property) && property !== "query") return value
          return (...args: unknown[]): unknown => {
            if (property !== "query" || WRITE_SQL.test(String(args[0]))) run.writes.push({ method: property, args })
            return value(...args)
          }
        },
      })
      TRANSACTION_MANAGERS.add(view)
      return view
    }
    Reflect.set(em, "transaction", makeFn(async (...args: unknown[]) => {
      const work = args[args.length - 1]
      if (typeof work !== "function") throw new Error("fakeTransaction: em.transaction() needs a callback as its last argument")
      const run: TransactionRun = { outcome: "pending", writes: [] }
      runs.push(run)
      try {
        const result: unknown = await work(scopedFor(run))
        run.outcome = "commit"
        return result
      } catch (error) {
        run.outcome = "rollback"
        throw error
      }
    }))
    const writesOf = (outcome: "commit" | "rollback"): TransactionWrite[] => runs.filter((run) => run.outcome === outcome).flatMap((run) => run.writes)
    return {
      em,
      /** How each transaction ended, in call order: "commit" or "rollback". */
      get outcomes() {
        return runs.map((run) => run.outcome)
      },
      get commits() {
        return runs.filter((run) => run.outcome === "commit").length
      },
      get rollbacks() {
        return runs.filter((run) => run.outcome === "rollback").length
      },
      /** The writes (`{ method, args }`) that ended in a commit, in call order. */
      get committedWrites() {
        return writesOf("commit")
      },
      /** The writes that a rollback discarded: made by a body that then threw. */
      get rolledBackWrites() {
        return writesOf("rollback")
      },
    }
  }

  return { mockEntityManager, fakeTransaction }
}

/** Whether `manager` is the scoped view a `fakeTransaction` body received (used by `recordingEventBus` and `recordingQueueOutbox`). */
export const isTransactionManager = (manager: unknown): boolean => typeof manager === "object" && manager !== null && TRANSACTION_MANAGERS.has(manager)

const kit = createEntityManagerKit(jestFn)

/**
 * A strict `EntityManager` double. Describe what the subject should see, `{ findOne: [OrderEntity, order] }`; any method
 * the subject calls that the spec did not stub throws an error naming the method, and a wrong entity or sql text throws
 * too. Results are typed against the entity: `findOne: [OrderEntity, 5]` is a compile error.
 */
export const mockEntityManager: MockEntityManagerFactory = kit.mockEntityManager

/** Makes `em.transaction(work)` run `work` with a scoped view whose queryRunner stays active until commit or rollback. */
export const fakeTransaction: FakeTransactionFactory = kit.fakeTransaction
