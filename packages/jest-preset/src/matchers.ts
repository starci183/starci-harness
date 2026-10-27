/// <reference types="jest" preserve="true" />

/**
 * Outcome matchers, registered by the `unit` project's `setupFilesAfterEnv` (nowhere else).
 *
 * They match the platform `Outcome<V, C>` structurally: `{ kind: "ok", value }` or `{ kind: "refused", code, params? }`.
 * `expect(outcome).toBeRefused("STOCK_EXHAUSTED")` (or `{ code, params }`) and `expect(outcome).toSucceedWith(value)`.
 */

/** The refusal a matcher expects: a capability code, or a code with the parameters of its display text. */
export type RefusalReason = string | { readonly code: string; readonly params?: Record<string, unknown> }

declare global {
  namespace jest {
    interface Matchers<R> {
      /** The received `Outcome` is `{ kind: "refused" }` with this code (and these params, when given). */
      toBeRefused(reason: RefusalReason): R
      /** The received `Outcome` is `{ kind: "ok" }` whose value equals `value` (recursive equality). */
      toSucceedWith(value: unknown): R
    }
  }
}

interface OutcomeShape {
  readonly kind: "ok" | "refused"
  readonly code?: unknown
  readonly params?: unknown
  readonly value?: unknown
}

const isOutcome = (received: unknown): received is OutcomeShape =>
  typeof received === "object" && received !== null && "kind" in received && (received.kind === "ok" || received.kind === "refused")

const notOutcome = (utils: jest.MatcherUtils["utils"], received: unknown): string =>
  `expected an Outcome ({ kind: "ok" | "refused" }), received ${utils.printReceived(received)}`

/** The matchers registered on `expect`. */
export const matchers: {
  toBeRefused(this: jest.MatcherContext, received: unknown, reason: RefusalReason): jest.CustomMatcherResult
  toSucceedWith(this: jest.MatcherContext, received: unknown, value: unknown): jest.CustomMatcherResult
} = {
  toBeRefused(received, reason) {
    if (!isOutcome(received)) return { pass: false, message: () => notOutcome(this.utils, received) }
    const expected = typeof reason === "string" ? { code: reason } : reason
    const pass =
      received.kind === "refused" &&
      received.code === expected.code &&
      (!("params" in expected) || this.equals(received.params, expected.params))
    return {
      pass,
      message: () =>
        pass
          ? `expected the outcome not to be refused with ${this.utils.printExpected(expected)}`
          : `expected the outcome to be refused with ${this.utils.printExpected(expected)}, received ${this.utils.printReceived(received)}`,
    }
  },
  toSucceedWith(received, value) {
    if (!isOutcome(received)) return { pass: false, message: () => notOutcome(this.utils, received) }
    const pass = received.kind === "ok" && this.equals(received.value, value)
    return {
      pass,
      message: () =>
        pass
          ? `expected the outcome not to succeed with ${this.utils.printExpected(value)}`
          : `expected the outcome to succeed with ${this.utils.printExpected(value)}, received ${this.utils.printReceived(received)}`,
    }
  },
}

if (typeof expect !== "undefined" && typeof expect.extend === "function") expect.extend(matchers)
