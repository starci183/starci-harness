import assert from "node:assert/strict"
import { test } from "node:test"
import { DomainError, isDomainError } from "./index.ts"
import type { DomainErrorInit, ErrorKind, ErrorParams } from "./index.ts"

type OrdersCode = "ORDERS_NOT_SHIPPABLE" | "ORDERS_MISSING"

class OrdersError extends DomainError<OrdersCode> {}

class Specialised extends DomainError<"SPECIAL"> {
    readonly extra: string

    constructor(init: DomainErrorInit<"SPECIAL">, extra: string) {
        super(init)
        this.extra = extra
    }
}

test("an error carries its code as the message and the class name as its name", () => {
    const error = new OrdersError({ code: "ORDERS_NOT_SHIPPABLE" })
    assert.equal(error.code, "ORDERS_NOT_SHIPPABLE")
    assert.equal(error.message, "ORDERS_NOT_SHIPPABLE")
    assert.equal(error.name, "OrdersError")
    assert.deepEqual(error.params, {})
    assert.equal(error.cause, undefined)
    assert.ok(error instanceof Error)
})

test("params and cause are kept as given", () => {
    const cause = new Error("disk")
    const error = new OrdersError({ code: "ORDERS_MISSING", params: { id: "o-1", count: 2 }, cause })
    assert.deepEqual(error.params, { id: "o-1", count: 2 })
    assert.equal(error.cause, cause)
    assert.ok(Object.hasOwn(error, "cause"))
})

test("a falsy cause is still a cause", () => {
    const error = new OrdersError({ code: "ORDERS_MISSING", cause: null })
    assert.equal(error.cause, null)
})

test("a subclass keeps its own fields and the name of its own class", () => {
    const error = new Specialised({ code: "SPECIAL" }, "more")
    assert.equal(error.name, "Specialised")
    assert.equal(error.extra, "more")
    assert.equal(error.code, "SPECIAL")
})

test("isDomainError narrows any subclass and refuses everything else", () => {
    const error: unknown = new OrdersError({ code: "ORDERS_MISSING" })
    assert.equal(isDomainError(error), true)
    if (isDomainError(error)) assert.equal(error.code, "ORDERS_MISSING")
    assert.equal(isDomainError(new Error("ORDERS_MISSING")), false)
    assert.equal(isDomainError({ code: "ORDERS_MISSING" }), false)
    assert.equal(isDomainError(null), false)
    assert.equal(isDomainError("ORDERS_MISSING"), false)
})

test("the kinds are the closed set a transport maps", () => {
    const kinds: readonly ErrorKind[] = ["invalid", "unauthenticated", "forbidden", "not-found", "conflict", "rate-limited", "unavailable", "internal"]
    assert.equal(new Set(kinds).size, 8)
})

test("params and cause may be passed as undefined under exactOptionalPropertyTypes, and mean absent", () => {
    const maybeParams = ((): ErrorParams | undefined => undefined)()
    const maybeCause = ((): unknown => undefined)()
    const error = new OrdersError({ code: "ORDERS_MISSING", params: maybeParams, cause: maybeCause })
    assert.deepEqual(error.params, {})
    assert.equal(error.cause, undefined)
    assert.equal(Object.hasOwn(error, "cause"), false)
})

test("ErrorParams is a named interface any string-or-number record satisfies", () => {
    const text = (params: ErrorParams): string => Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(",")
    assert.equal(text({ id: "o-1", count: 2 }), "id=o-1,count=2")
    assert.equal(text(new OrdersError({ code: "ORDERS_MISSING", params: { id: "o-1" } }).params), "id=o-1")
})
