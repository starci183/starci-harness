// errors.mjs - the one error type of the stack tooling and its exit codes.
export const EXIT = Object.freeze({ ok: 0, failed: 1, refused: 2, approval: 3 });

/** A refusal or failure with a stable code; `exit` is the process exit code the CLI maps it to. */
export class StackError extends Error {
  code: string;
  exit: number;

  constructor(code: string, message: string, exit: number = EXIT.refused) {
    super(`${code}: ${message}`);
    this.name = 'StackError';
    this.code = code;
    this.exit = exit;
  }
}

/** A failed step (a check or an effect did not succeed): exit 1. */
export const failure = (code: string, message: string): StackError => new StackError(code, message, EXIT.failed);

/** A refusal (bad usage, unsafe or unknown input, missing configuration): exit 2. */
export const refusal = (code: string, message: string): StackError => new StackError(code, message, EXIT.refused);

/** The owner has not approved a one-time effect: exit 3. */
export const approvalMissing = (code: string, message: string): StackError => new StackError(code, message, EXIT.approval);
