// Managed by starci app sync (slot be.feature.auth); do not edit: run "npx starci app sync --execute".
import { Module } from "@nestjs/common"
import { AuthApiModule } from "../../auth.module"
import { AuthController } from "./auth.controller"
import { ConfigurableModuleClass } from "./auth-http.module-definition"

@Module({ imports: [AuthApiModule.register({})], controllers: [AuthController] })
/** The HTTP transport of the auth feature: the REST doors under /auth. */
export class AuthHttpModule extends ConfigurableModuleClass {}
