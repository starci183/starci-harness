// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Body, Controller, Get, HttpCode, Post, Query, Redirect, Req, Res } from "@nestjs/common"
import type { CommandBus, QueryBus } from "@nestjs/cqrs"
import type { Request, Response } from "express"
import { Public, PublicReason } from "@modules/domain/identity"
import type { AccessGrant, GoogleRedirect, JwksDocument } from "@modules/integrations/passport"
import { InjectCommandBus, InjectQueryBus } from "@modules/platform/cqrs"
import { RateLimit, RateTier } from "@modules/platform/http-security"
import { GetJwksQuery } from "../../application/get-jwks.query"
import { GoogleBeginCommand } from "../../application/google-begin.command"
import { GoogleCompleteCommand } from "../../application/google-complete.command"
import { LoginCommand } from "../../application/login.command"
import { LogoutCommand } from "../../application/logout.command"
import { RefreshCommand } from "../../application/refresh.command"
import { SessionCommand } from "../../application/session.command"
import { GoogleStartRequest } from "./dto/google-start.request"
import { LoginRequest } from "./dto/login.request"

@Controller("auth")
/** The cookie doors of sign-in: email and password, Google, refresh, session, sign-out and the public keys. */
export class AuthController {
    constructor(
        @InjectCommandBus() private readonly commandBus: CommandBus,
        @InjectQueryBus() private readonly queryBus: QueryBus,
    ) {}

    /** Signs in with email and password; the refresh token is set as an httpOnly cookie. */
    @Post("login")
    @HttpCode(200)
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    login(
        @Body() _body: LoginRequest,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<AccessGrant> {
        return this.commandBus.execute(new LoginCommand({ request: { exchange: { req, res } } }))
    }

    /** Rotates the refresh cookie and answers a new access token; a bad cookie is cleared. */
    @Post("refresh")
    @HttpCode(200)
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AccessGrant> {
        return this.commandBus.execute(new RefreshCommand({ request: { exchange: { req, res } } }))
    }

    /** Answers a fresh access token for the cookie session WITHOUT rotating the cookie, so parallel requests of one browser never race. */
    @Get("session")
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    session(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AccessGrant> {
        return this.commandBus.execute(new SessionCommand({ request: { exchange: { req, res } } }))
    }

    /** Ends the session of the refresh cookie and clears it. */
    @Post("logout")
    @HttpCode(204)
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
        return this.commandBus.execute(new LogoutCommand({ request: { exchange: { req, res } } }))
    }

    /** Sends the browser to Google (authorization code with state and PKCE); `returnTo` is an absolute address on the web origin or a path. */
    @Get("google")
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    google(@Query() _query: GoogleStartRequest, @Req() req: Request, @Res() res: Response): Promise<void> {
        return this.commandBus.execute(new GoogleBeginCommand({ request: { exchange: { req, res } } }))
    }

    /** Google sends the browser back here; the session cookie is set and the browser lands on the web app (or its sign-in page on failure). */
    @Get("google/callback")
    @Redirect()
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    googleCallback(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<GoogleRedirect> {
        return this.commandBus.execute(new GoogleCompleteCommand({ request: { exchange: { req, res } } }))
    }

    /** The public keys access tokens verify against. */
    @Get("jwks")
    @Public({ reason: PublicReason.AuthHandshake })
    @RateLimit(RateTier.Strict)
    jwks(): Promise<JwksDocument> {
        return this.queryBus.execute(new GetJwksQuery({ request: {} }))
    }
}
