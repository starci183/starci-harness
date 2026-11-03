import { AUTH_ERROR_CODES, AUTH_ERROR_KINDS } from "@starci/auth/contracts"
import type { AuthErrorCode } from "@starci/auth/contracts"
import { DomainError } from "@modules/platform/errors"
import type { ErrorKind } from "@modules/platform/errors"

/** The codes of sign-in: the wire codes @starci/auth names, the same on both sides of the doors. */
export const PassportErrorCode = AUTH_ERROR_CODES
export type PassportErrorCode = AuthErrorCode

/** How each sign-in code travels. */
export const PASSPORT_ERROR_KINDS: Record<PassportErrorCode, ErrorKind> = AUTH_ERROR_KINDS

/** The one error class of the passport integration. */
export class PassportError extends DomainError<PassportErrorCode> {}
