import type { DomainError, DomainErrorInit, ErrorParams } from "./error.ts"

/** The success half of an outcome: the value the operation produced. */
export interface OutcomeOk<V> {
    /** Discriminant of the success half. */
    readonly kind: "ok"
    /** The value the operation produced. */
    readonly value: V
}

/** The expected-refusal half of an outcome: a capability code and the parameters of its display text. */
export interface OutcomeRefused<C extends string> {
    /** Discriminant of the refusal half. */
    readonly kind: "refused"
    /** The capability code of the refusal, a member of its code enum. */
    readonly code: C
    /** Values for the placeholders of the display text. */
    readonly params?: ErrorParams
}

/** The result of an operation that can be refused for an expected business reason: returned, never thrown. */
export type Outcome<V, C extends string> = OutcomeOk<V> | OutcomeRefused<C>

/** The class of a capability error family, as `unwrapOutcome` constructs it from a refusal. */
export type OutcomeErrorClass<K extends string> = new (init: DomainErrorInit<K>) => DomainError<K>

/** Wraps a produced value as a successful outcome. */
export const ok = <V>(value: V): OutcomeOk<V> => ({ kind: "ok", value })

/** Builds a refusal with a capability code and the parameters of its display text. */
export const refused = <C extends string>(code: C, params?: ErrorParams): OutcomeRefused<C> => ({
    kind: "refused",
    code,
    ...(params === undefined ? {} : { params }),
})

/**
 * Returns the value of a successful outcome; a refusal becomes the capability error of `ErrorClass`. This is the only
 * place a refusal turns into a throw, and it runs in the transport.
 */
export const unwrapOutcome = <V, C extends K, K extends string>(
    outcome: Outcome<V, C>,
    ErrorClass: OutcomeErrorClass<K>,
): V => {
    if (outcome.kind === "ok") return outcome.value
    throw new ErrorClass({ code: outcome.code, ...(outcome.params === undefined ? {} : { params: outcome.params }) })
}
