// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Module } from "@nestjs/common"
import { LoginHandler } from "./application/login.handler"
import { RefreshHandler } from "./application/refresh.handler"
import { SessionHandler } from "./application/session.handler"
import { LogoutHandler } from "./application/logout.handler"
import { GoogleBeginHandler } from "./application/google-begin.handler"
import { GoogleCompleteHandler } from "./application/google-complete.handler"
import { GetJwksHandler } from "./application/get-jwks.handler"
import { ConfigurableModuleClass } from "./auth.module-definition"

@Module({
    providers: [LoginHandler, RefreshHandler, SessionHandler, LogoutHandler, GoogleBeginHandler, GoogleCompleteHandler, GetJwksHandler],
})
/** The auth feature: the handlers behind the sign-in doors. */
export class AuthApiModule extends ConfigurableModuleClass {}
