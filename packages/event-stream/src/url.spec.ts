import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { backoffDelay, buildUrl, mergeHeaders } from "./url.js"

const retry = { baseMs: 1000, maxMs: 15_000, jitter: false }

describe("mergeHeaders", () => {
  it("lower-cases the names and lets later sets win", () => {
    assert.deepEqual(mergeHeaders({ Accept: "a", "X-One": "1" }, undefined, { accept: "b" }), { accept: "b", "x-one": "1" })
  })
})

describe("buildUrl", () => {
  it("joins the base and the path with exactly one slash", () => {
    assert.equal(buildUrl("https://api.test/", "/events", undefined), "https://api.test/events")
    assert.equal(buildUrl("https://api.test/v1///", "///events", undefined), "https://api.test/v1/events")
  })

  it("keeps an absolute path and a path without a base", () => {
    assert.equal(buildUrl("https://api.test", "https://other.test/x", undefined), "https://other.test/x")
    assert.equal(buildUrl(undefined, "/events", undefined), "/events")
    assert.equal(buildUrl("", "/events", undefined), "/events")
  })

  it("appends the query, repeating arrays and leaving out null and undefined", () => {
    assert.equal(
      buildUrl(undefined, "/s", { a: 1, b: ["x", "y", null], c: undefined, d: null, e: true, f: "a b" }),
      "/s?a=1&b=x&b=y&e=true&f=a+b",
    )
  })

  it("appends to a path that already has a query, and adds nothing for an empty one", () => {
    assert.equal(buildUrl(undefined, "/s?x=1", { a: 2 }), "/s?x=1&a=2")
    assert.equal(buildUrl(undefined, "/s", { a: undefined }), "/s")
  })
})

describe("backoffDelay", () => {
  it("starts at the base and doubles up to the cap", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((failures) => backoffDelay(failures, retry, undefined, () => 0))
    assert.deepEqual(delays, [1000, 1000, 2000, 4000, 8000, 15_000, 15_000])
  })

  it("spreads the delay over its upper half when jitter is on", () => {
    const jittered = { ...retry, jitter: true }
    assert.equal(backoffDelay(2, jittered, undefined, () => 0), 1000)
    assert.equal(backoffDelay(2, jittered, undefined, () => 1), 2000)
  })

  it("takes the retry the server named as the base and never waits less than it", () => {
    assert.equal(backoffDelay(1, retry, 2500, () => 0), 2500)
    assert.equal(backoffDelay(2, retry, 2500, () => 0), 5000)
    assert.equal(backoffDelay(1, { ...retry, jitter: true }, 2500, () => 0), 2500)
  })

  it("honours a server retry above the cap", () => {
    assert.equal(backoffDelay(3, retry, 60_000, () => 0), 60_000)
  })
})
