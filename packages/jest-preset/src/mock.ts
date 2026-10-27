/// <reference types="jest" preserve="true" />

/**
 * `mock<T>()` -- a typed test double that replaces the `{ ... } as unknown as T` cast.
 *
 * Every property read yields one stable `jest.fn()` (created on first read), so `mock<Repo>().find` is
 * already a mock function, `expect(m.find).toHaveBeenCalledWith(...)` works, and `m.find.mockResolvedValue(x)`
 * type-checks against `Repo["find"]`. Values passed in `overrides` win over the generated functions and may be
 * partial: the return type is still `T`.
 *
 * `createMock` takes the function factory as an argument (called with the property name) so the helper has no hard
 * dependency on a global `jest`; `mock` binds it to `jest.fn`.
 */

/** Function members become jest mocks typed against the real signature; everything else stays as declared. */
export type MockOf<T> = T & {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? jest.Mock<R, A> & T[K] : T[K]
}

// Probed by promise resolution, jest matchers and serializers: they must read as absent, not as a mock function.
const ABSENT = new Set(["then", "asymmetricMatch", "$$typeof", "nodeType", "tagName", "toJSON"])

/** The factory behind `mock`, for callers that bring their own function factory (used by the package spec). */
export function createMock(makeFn: (property: string) => unknown): <T extends object>(overrides?: Partial<T>) => MockOf<T> {
  function mock<T extends object>(overrides?: Partial<T>): MockOf<T>
  function mock(overrides?: object): object {
    const own = new Map<string | symbol, unknown>()
    const store: Record<string | symbol, unknown> = overrides ? { ...overrides } : {}
    return new Proxy(store, {
      get(target, property, receiver) {
        if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver)
        if (typeof property === "symbol" || property in Object.prototype) return Reflect.get(target, property, receiver)
        if (ABSENT.has(property)) return undefined
        if (!own.has(property)) own.set(property, makeFn(property))
        return own.get(property)
      },
      set(target, property, value) {
        own.delete(property)
        target[property] = value
        return true
      },
      has(target, property) {
        return Object.hasOwn(target, property) || own.has(property)
      },
    })
  }
  return mock
}

// jest-runtime hands every module it loads, this one included, a module-scoped `jest` object; it is not a property
// of globalThis, so it is read as a free identifier. @jest/globals is the fallback for a runner that does not.
export function jestFn(implementation?: (...args: never[]) => unknown): unknown {
  if (typeof jest !== "undefined" && typeof jest.fn === "function") return jest.fn(implementation)
  try {
    const globals: { jest: { fn(implementation?: (...args: never[]) => unknown): unknown } } = require("@jest/globals")
    return globals.jest.fn(implementation)
  } catch {
    throw new Error("@starci/jest-preset mock<T>() needs the jest runtime; call it from a jest test")
  }
}

/** A typed test double for `T`. `overrides` may be partial; the result is usable wherever a `T` is required. */
export const mock = createMock(() => jestFn())
