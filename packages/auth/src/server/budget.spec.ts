import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import { FakeClock, MemoryRateCounter } from "../testing/index.ts"
import { SignInBudget } from "./budget.ts"
import { AuthError } from "./errors.ts"

const build = () => {
    const clock = new FakeClock()
    const rate = new MemoryRateCounter(clock)
    return { clock, rate, budget: new SignInBudget({ loginAttempts: 3, resetAttempts: 2, windowMs: 60_000 }, rate) }
}

const tooMany = (error: unknown): boolean => error instanceof AuthError && error.code === AUTH_ERROR_CODES.TooManyAttempts

describe("SignInBudget (a budget of failures)", () => {
    it("locks an address at its limit of wrong passwords", async () => {
        const { budget } = build()
        const wrong = () => Promise.resolve({ passed: false, value: "wrong" })
        for (let n = 0; n < 3; n += 1) assert.equal(await budget.counted("login", "a@example.test", wrong), "wrong")
        await assert.rejects(budget.counted("login", "a@example.test", wrong), tooMany)
    })

    it("lets a right password clear the count, so ten good sign-ins never lock an account", async () => {
        const { budget } = build()
        const right = () => Promise.resolve({ passed: true, value: "right" })
        const wrong = () => Promise.resolve({ passed: false, value: "wrong" })
        for (let n = 0; n < 10; n += 1) assert.equal(await budget.counted("login", "a@example.test", right), "right")
        await budget.counted("login", "a@example.test", wrong)
        await budget.counted("login", "a@example.test", wrong)
        await budget.counted("login", "a@example.test", right)
        for (let n = 0; n < 3; n += 1) await budget.counted("login", "a@example.test", wrong)
        await assert.rejects(budget.admit("login", "a@example.test"), tooMany)
    })

    it("counts addresses and kinds apart and uses the reset limit for reset and signup", async () => {
        const { budget } = build()
        await budget.admit("reset", "a@example.test")
        await budget.admit("reset", "a@example.test")
        await assert.rejects(budget.admit("reset", "a@example.test"), tooMany)
        await budget.admit("reset", "b@example.test")
        await budget.admit("login", "a@example.test")
        await budget.admit("signup", "c@example.test")
        await budget.admit("signup", "c@example.test")
        await assert.rejects(budget.admit("signup", "c@example.test"), tooMany)
    })

    it("opens a new window, and clear forgets an address", async () => {
        const { budget, clock, rate } = build()
        for (let n = 0; n < 3; n += 1) await budget.admit("login", "a@example.test")
        await assert.rejects(budget.admit("login", "a@example.test"), tooMany)
        clock.advance(60_001)
        await budget.admit("login", "a@example.test")
        await budget.clear("login", "a@example.test")
        for (let n = 0; n < 3; n += 1) await budget.admit("login", "a@example.test")
        assert.equal(await rate.consume("unrelated", 1000, 1), true)
    })

    it("keeps the address out of the counter key", async () => {
        const keys: string[] = []
        const budget = new SignInBudget(
            { loginAttempts: 3, resetAttempts: 2, windowMs: 1 },
            { consume: (key) => Promise.resolve(keys.push(key) > 0), clear: () => Promise.resolve() },
        )
        await budget.admit("login", "secret@example.test")
        assert.match(keys[0] ?? "", /^login:[0-9a-f]{64}$/u)
    })
})
