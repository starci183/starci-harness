import { ConfigurableModuleBuilder, Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { resolveMailOptions } from "./options.ts"
import type { MailOptions } from "./options.ts"
import { MailService } from "./service.ts"
import { SmtpTransport } from "./smtp.ts"
import { MAILER } from "./tokens.ts"

/** The extras every registration sets beside the options. */
export interface MailModuleExtras {
    /** Whether the module is global. */
    readonly isGlobal: boolean
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<MailOptions>({
    moduleName: "Mail",
})
    .setClassMethodName("register")
    .setFactoryMethodName("createMailOptions")
    .setExtras<MailModuleExtras>({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

/** What `MailModule.register` takes: the typed options, plus `isGlobal`. */
export type MailRegisterOptions = typeof OPTIONS_TYPE

/** What `MailModule.registerAsync` takes: `imports`, `inject` and one of `useFactory`, `useClass`, `useExisting`, plus `isGlobal`. */
export type MailRegisterAsyncOptions = typeof ASYNC_OPTIONS_TYPE

const withPort = (base: DynamicModule): DynamicModule => ({
    ...base,
    providers: [
        ...(base.providers ?? []),
        {
            provide: MAILER,
            inject: [MODULE_OPTIONS_TOKEN],
            useFactory: (options: MailOptions): MailService => {
                const resolved = resolveMailOptions(options)
                return new MailService(new SmtpTransport(resolved), resolved)
            },
        },
    ],
    exports: [...(base.exports ?? []), MAILER],
})

/**
 * Outgoing mail as one Nest capability: the `Mailer` port under the `MAILER` token, over SMTP with every timeout in force,
 * TLS required by default and coded errors. The module reads no environment; the app parses its settings and passes them typed.
 */
export class MailModule extends ConfigurableModuleClass {
    /** Registers the module from options known now. */
    static override register(options: MailRegisterOptions): DynamicModule {
        return withPort(super.register(options))
    }

    /** Registers the module from options a factory, class or existing provider supplies. */
    static override registerAsync(options: MailRegisterAsyncOptions): DynamicModule {
        return withPort(super.registerAsync(options))
    }
}

Module({})(MailModule)
