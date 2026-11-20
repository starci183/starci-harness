// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Module } from "@nestjs/common"
import { LoginHandler } from "./application/login.handler"
import { RefreshHandler } from "./application/refresh.handler"
import { SessionHandler } from "./application/session.handler"
import { LogoutHandler } from "./application/logout.handler"
import { GoogleBeginHandler } from "./application/google-begin.handler"
import { GoogleCompleteHandler } from "./application/google-complete.handler"
import { GetJwksHandler } from "./application/get-jwks.handler"
import { SignupHandler } from "./application/signup.handler"
import { ResendHandler } from "./application/resend.handler"
import { ConfirmHandler } from "./application/confirm.handler"
import { ForgotHandler } from "./application/forgot.handler"
import { ResetHandler } from "./application/reset.handler"
import { ConfigurableModuleClass } from "./auth.module-definition"

@Module({
    providers: [
        LoginHandler,
        RefreshHandler,
        SessionHandler,
        LogoutHandler,
        GoogleBeginHandler,
        GoogleCompleteHandler,
        GetJwksHandler,
        SignupHandler,
        ResendHandler,
        ConfirmHandler,
        ForgotHandler,
        ResetHandler,
    ],
})
/** The auth feature: the handlers behind the sign-in doors. */
export class AuthApiModule extends ConfigurableModuleClass {}
