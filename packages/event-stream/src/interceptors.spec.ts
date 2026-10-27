import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { InterceptorChain } from "./interceptors.js"

describe("InterceptorChain", () => {
  it("runs interceptors in the order they were added, awaiting each", async () => {
    const chain = new InterceptorChain<string[]>()
    chain.use((value) => [...value, "a"])
    chain.use(async (value) => {
      await Promise.resolve()
      value.push("b")
    })
    chain.use((value) => [...value, "c"])
    assert.deepEqual(await chain.run([]), ["a", "b", "c"])
  })

  it("ejects one interceptor by id and clears the rest", async () => {
    const chain = new InterceptorChain<number>()
    const first = chain.use((value) => value + 1)
    chain.use((value) => value + 10)
    chain.eject(first)
    chain.eject(first)
    assert.equal(await chain.run(0), 10)
    chain.clear()
    assert.equal(await chain.run(0), 0)
  })

  it("stops the chain at null when the chain allows dropping", async () => {
    const chain = new InterceptorChain<string, null>()
    const seen: string[] = []
    chain.use((value) => (value === "drop" ? null : value))
    chain.use((value) => {
      seen.push(value)
    })
    assert.equal(await chain.run("drop"), null)
    assert.equal(await chain.run("keep"), "keep")
    assert.deepEqual(seen, ["keep"])
  })
})
