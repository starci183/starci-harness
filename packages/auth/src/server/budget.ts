import { AUTH_ERROR_CODES } from "../contracts/index.ts"
import type { AttemptKind } from "../contracts/index.ts"
import { AuthError } from "./errors.ts"
import type { BudgetOptions } from "./options.ts"
import type { RateCounter } from "./ports.ts"
import { digestOf } from "./primitives.ts"

/**
 * Counts sign-in, reset and signup attempts per address in a window every replica shares, and refuses an address over its
 * limit. A sign-in budget is a budget of failures: the password check that succeeds clears the count of its address, so good
 * sign-ins never lock an account out.
 */
export class SignInBudget {
    readonly #options: BudgetOptions
    readonly #rate: RateCounter

    constructor(options: BudgetOptions, rate: RateCounter) {
        this.#options = options
        this.#rate = rate
    }

    /** Counts one attempt of this kind for an address (hashed in the counter key); throws when the address is over its limit. */
    async admit(kind: AttemptKind, address: string): Promise<void> {
        const limit = kind === "login" ? this.#options.loginAttempts : this.#options.resetAttempts
        const allowed = await this.#rate.consume(this.#keyOf(kind, address), this.#options.windowMs, limit)
        if (!allowed) throw new AuthError(AUTH_ERROR_CODES.TooManyAttempts)
    }

    /** Forgets the attempts of this kind counted for an address: its password was proved right, so earlier failures no longer weigh on it. */
    async clear(kind: AttemptKind, address: string): Promise<void> {
        await this.#rate.clear(this.#keyOf(kind, address))
    }

    /** Admits one attempt, runs the check, and clears the address when the check passes; only failures stay counted. */
    async counted<T>(kind: AttemptKind, address: string, check: () => Promise<{ readonly passed: boolean; readonly value: T }>): Promise<T> {
        await this.admit(kind, address)
        const result = await check()
        if (result.passed) await this.clear(kind, address)
        return result.value
    }

    #keyOf(kind: AttemptKind, address: string): string {
        return `${kind}:${digestOf(address)}`
    }
}
