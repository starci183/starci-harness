// Managed by starci app sync (slot be.identity.sign-in); do not edit: run "npx starci app sync --execute".
import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { AuthApiOptions } from "./auth.options"

/** The configurable-module base of the auth feature module. */
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE } =
    new ConfigurableModuleBuilder<AuthApiOptions>().setClassMethodName("register").build()
