// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { Injectable } from "@nestjs/common"
import { AuthError, InjectAuthDoors, InjectAuthSessions, PassportError } from "@modules/integrations/passport"
import type { AccessGrant, AuthDoors, AuthSessions, GoogleRedirect, HttpExchange, JwksDocument } from "@modules/integrations/passport"

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

    /** The public key document access tokens verify against. */
    jwks(): Promise<JwksDocument> {
        return this.refusing(() => this.sessions.jwks())
    }

    private async refusing<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work()
        } catch (cause) {
            throw cause instanceof AuthError ? new PassportError({ code: cause.code, cause }) : cause
        }
    }
}
