/** Exit code of a refused command: the verb ran and declined, nothing moved. */
export const EXIT_REFUSED = 1

/** Exit code of bad usage: the command line itself is wrong. */
export const EXIT_USAGE = 2

/** A verb declined to act; the code is machine-readable and the message says what to do instead. */
export class Refusal extends Error {
    public readonly code: string
    public readonly exitCode: number

    public constructor(code: string, message: string, exitCode: number = EXIT_REFUSED) {
        super(message)
        this.name = "Refusal"
        this.code = code
        this.exitCode = exitCode
    }
}

/** The command line is wrong (unknown flag, missing value). */
export class UsageError extends Refusal {
    public constructor(message: string) {
        super("CLI_USAGE", message, EXIT_USAGE)
        this.name = "UsageError"
    }
}

/** Turns anything thrown into a refusal, keeping a refusal as it is. */
export const asRefusal = (error: unknown): Refusal => {
    if (error instanceof Refusal) return error
    const message = error instanceof Error ? error.message : String(error)
    return new Refusal("CLI_UNEXPECTED", message)
}
