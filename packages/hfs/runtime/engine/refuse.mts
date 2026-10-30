// refuse.mjs — the refusal Error every verb raises: a message plus a stable `code` (and any extra fields the
// caller attaches). `refuse` builds it, `fail` throws it, `need` throws it when a required condition is false.

/** An Error carrying `code` and `extra` fields; callers `throw` it or hand it to a result row. */
export type Refusal<E extends object = object> = Error & { code: string | undefined } & E;

export const refuse = <E extends object = object>(message: string, code?: string, extra: E = {} as E): Refusal<E> => Object.assign(new Error(message), { code, ...extra });

/** Throws the refusal `refuse` builds — the spelling used where refusing is the whole statement. */
export function fail(message: string, code?: string, extra: object = {}): never { throw refuse(message, code, extra); }

/** Throws `refuse(message, code)` when `ok` is falsy — the assertion spelling of a refusal. */
export function need(ok: unknown, message: string, code?: string): asserts ok { if (!ok) throw refuse(message, code); }
