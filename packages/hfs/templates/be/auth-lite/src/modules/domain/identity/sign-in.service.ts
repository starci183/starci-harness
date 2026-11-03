// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import { AuthError, PassportError, PassportErrorCode } from "@modules/integrations/passport"
import type { Principal } from "@modules/platform/cqrs"
import { IdentityError, IdentityErrorCode } from "./errors/identity.error"
import { InjectAuthDoors, InjectAuthSessions } from "./identity.decorators"
import type { AccessGrant, AuthDoors, AuthSessions, GoogleRedirect, HttpExchange, JwksDocument } from "@modules/integrations/passport"

/** The wire codes of the package that belong to the passport family (the token, key and Google legs). */
const PASSPORT_CODES: ReadonlyArray<PassportErrorCode> = [
    PassportErrorCode.AccessTokenInvalid,
    PassportErrorCode.KeyInvalid,
    PassportErrorCode.MissingCredentials,
    PassportErrorCode.GoogleStateInvalid,
    PassportErrorCode.GoogleRejected,
    PassportErrorCode.GoogleUnavailable,
]

/** The wire codes of the package that belong to the identity family (the session and the sign-in refusals). */
const IDENTITY_CODES: ReadonlyArray<IdentityErrorCode> = [
    IdentityErrorCode.RefreshInvalid,
    IdentityErrorCode.RefreshReused,
    IdentityErrorCode.AccountDisabled,
    IdentityErrorCode.TooManyAttempts,
    IdentityErrorCode.PairRefused,
    IdentityErrorCode.EmailNotConfirmed,
]

/** The error of the family that owns a wire code of the package; a code neither family names reads as unauthenticated. */
const familyOf = (error: AuthError): IdentityError | PassportError => {
    const passport = PASSPORT_CODES.find((each) => each === error.code)
    if (passport !== undefined) return new PassportError({ code: passport, cause: error })
    const identity = IDENTITY_CODES.find((each) => each === error.code) ?? IdentityErrorCode.Unauthenticated
    return new IdentityError({ code: identity, cause: error })
}

@Injectable()
/** The cookie doors of sign-in for the transport: the package's doors with its refusals turned into the passport error family the errors filter maps. */
export class IdentitySignInService {
    constructor(
        @InjectAuthDoors() private readonly doors: AuthDoors,
        @InjectAuthSessions() private readonly sessions: AuthSessions,
    ) {}

    /** Email and password through the local strategy; the refresh token goes into the cookie. */
    login(exchange: HttpExchange): Promise<AccessGrant> {
        return this.refusing(() => this.doors.login(exchange))
    }

    /** Rotates the cookie token and answers a new access token. */
    refresh(exchange: HttpExchange): Promise<AccessGrant> {
        return this.refusing(() => this.doors.refresh(exchange))
    }

    /** Answers a fresh access token for the cookie session without rotating the cookie. */
    session(exchange: HttpExchange): Promise<AccessGrant> {
        return this.refusing(() => this.doors.session(exchange))
    }

    /** Ends the session of the cookie and clears it. */
    logout(exchange: HttpExchange): Promise<void> {
        return this.refusing(() => this.doors.logout(exchange))
    }

    /** Sends the browser to the Google consent screen. */
    beginGoogle(exchange: HttpExchange): Promise<void> {
        return this.refusing(() => this.doors.beginGoogle(exchange))
    }

    /** Finishes the Google round trip; a failure redirects to the sign-in page instead of throwing. */
    completeGoogle(exchange: HttpExchange): Promise<GoogleRedirect> {
        return this.refusing(() => this.doors.completeGoogle(exchange))
    }

    /** Signs the person out of every other device; the session of the caller stays. */
    endOthers(principal: Principal): Promise<void> {
        return this.refusing(() => this.sessions.endOthers(principal.id, principal.sessionId))
    }

    /** The public key document access tokens verify against. */
    jwks(): Promise<JwksDocument> {
        return this.refusing(() => this.sessions.jwks())
    }

    private async refusing<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work()
        } catch (cause) {
            if (cause instanceof AuthError) throw familyOf(cause)
            throw cause
        }
    }
}
