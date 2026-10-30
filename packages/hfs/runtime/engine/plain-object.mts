// plain-object.mjs — the one "is this a non-array object" predicate the runtime asks with.
// A leaf beside digest.mjs: schema walkers, config readers and JSON consumers all mean the
// same thing by "a mapping" - own object, never null, never an array - so they share it here.
/** True for a non-null, non-array object. Does not check the prototype (a JSON.parse result). */
export const isPlainObject = <T,>(value: T): value is T & Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
