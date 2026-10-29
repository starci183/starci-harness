/**
 * `fakeQueryBuilder()` and `queueQueryBuilders()` -- the double of a typeorm `SelectQueryBuilder` (and its insert, update
 * and delete siblings) that `mockEntityManager` hands out from `createQueryBuilder(Entity, "alias")`.
 *
 * A lite service reads with `createQueryBuilder(Entity, "alias")` and named parameters (persistence.md BE-PERSISTENCE-4).
 * The fake is a Proxy: every chained method (`where`, `andWhere`, `innerJoin`, `orderBy`, `take`, `setLock`, `returning`,
 * ...) records `{ method, args }` and returns the builder; a terminal method (`execute`, `getMany`, `getOne`,
 * `getRawMany`, `getRawOne`, `getCount`, `getManyAndCount`) records too and resolves the answer the spec gave it (a function
 * answer is called when the terminal runs). A spec asserts the statement it expects through `calls` or `callsOf(method)`.
 *
 * `queueQueryBuilders(em, answers)` queues one fake per answer on `em.createQueryBuilder` of a `mockEntityManager()`, in
 * call order, and returns the fakes so the spec can read each one's calls.
 */

/** One chained call recorded on a fake query builder. */
export interface QueryBuilderCall {
  /** The builder method that was called. */
  readonly method: string
  /** The arguments it was called with. */
  readonly args: ReadonlyArray<unknown>
}

/** What the terminal methods of a fake query builder answer; a function is called when the terminal runs and its result returned. */
export interface QueryBuilderAnswers {
  /** The answer of `execute()`. */
  readonly execute?: unknown
  /** The answer of `getMany()`. */
  readonly getMany?: ReadonlyArray<unknown> | (() => unknown)
  /** The answer of `getOne()`. */
  readonly getOne?: unknown
  /** The answer of `getRawMany()`. */
  readonly getRawMany?: ReadonlyArray<unknown> | (() => unknown)
  /** The answer of `getRawOne()`. */
  readonly getRawOne?: unknown
  /** The answer of `getCount()`. */
  readonly getCount?: number | (() => unknown)
  /** The answer of `getManyAndCount()`. */
  readonly getManyAndCount?: readonly [ReadonlyArray<unknown>, number] | (() => unknown)
}

/** A chainable stand-in for a typeorm query builder that records every chained call. */
export interface FakeQueryBuilder {
  /** The builder to hand back from `entityManager.createQueryBuilder`. */
  readonly builder: object
  /** Every chained call, in order. */
  readonly calls: ReadonlyArray<QueryBuilderCall>
  /** The argument lists of every call of one builder method, in order. */
  callsOf(method: string): ReadonlyArray<ReadonlyArray<unknown>>
}

/** The methods that end a chain and resolve the spec's answer. */
const TERMINALS = ["execute", "getMany", "getOne", "getRawMany", "getRawOne", "getCount", "getManyAndCount"] as const
type Terminal = (typeof TERMINALS)[number]

const isTerminal = (method: string): method is Terminal => TERMINALS.some((name) => name === method)

/** Builds a chainable query-builder double: every method returns the builder, the terminal methods resolve `answers`. */
export const fakeQueryBuilder = (answers: QueryBuilderAnswers = {}): FakeQueryBuilder => {
  const calls: QueryBuilderCall[] = []
  const builder: object = new Proxy(
    {},
    {
      get: (_target, property) => {
        // `then` stays undefined so an awaited builder is not mistaken for a promise.
        if (typeof property !== "string" || property === "then") return undefined
        return (...args: unknown[]): unknown => {
          calls.push({ method: property, args })
          if (!isTerminal(property)) return builder
          const answer: unknown = answers[property]
          return Promise.resolve(typeof answer === "function" ? (answer as () => unknown)() : answer)
        }
      },
    },
  )
  return {
    builder,
    calls,
    callsOf: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
  }
}

/** The part of a `mockEntityManager()` this helper queues on: its `createQueryBuilder` jest mock. */
export interface QueryBuilderHost {
  readonly createQueryBuilder: { mockReturnValueOnce(value: never): unknown }
}

/** Queues one fake query builder per answer on `manager.createQueryBuilder`, handed out in call order, and returns them. */
export const queueQueryBuilders = (manager: QueryBuilderHost, answers: ReadonlyArray<QueryBuilderAnswers>): ReadonlyArray<FakeQueryBuilder> => {
  const fakes = answers.map((answer) => fakeQueryBuilder(answer))
  for (const fake of fakes) manager.createQueryBuilder.mockReturnValueOnce(fake.builder as never)
  return fakes
}
