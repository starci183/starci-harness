/**
 * `builder(defaults)` -- the one way a spec makes a plain value with a few fields changed: a module options object
 * (`<CAP>_OPTIONS`), a principal, a request context. Options tokens are provided as REAL values, never as doubles; a
 * builder holds the valid defaults once so each spec states only the field it varies.
 *
 *   const options = builder<OrderOptions>({ maxLines: 50, allowGuestCheckout: false })
 *   options({ allowGuestCheckout: true })   // a whole OrderOptions with one flag flipped
 */
/** Makes a builder of `T`: a function returning the defaults with `overrides` applied. */
export function builder<T extends object>(defaults: T): (overrides?: Partial<T>) => T {
  return (overrides) => ({ ...defaults, ...overrides })
}
