// secret-errors.mjs - sanitized public errors shared by app secret operations.

export class SecretError extends Error {}

export const publicStorage = <T,>(action: () => T): T => {
  try {
    return action();
  } catch (caught: unknown) {
    // reason: a thrown value is untyped; storage failures are Node errors carrying an optional code.
    const error = caught as NodeJS.ErrnoException;
    throw new SecretError(
      error.code ? `private storage failed (${error.code})` : error.message,
    );
  }
};

export function secretErrorMessage(caught: unknown): string {
  if (caught instanceof SecretError) return caught.message;
  if (caught instanceof SyntaxError) return "invalid secret document";
  // reason: a thrown value is untyped; read its optional Node error code exactly as the JavaScript did.
  const error = caught as NodeJS.ErrnoException;
  const code = error.code ? ` (${error.code})` : "";
  return `operation failed${code}; no secret values were printed`;
}
