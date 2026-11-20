import { MailModule as PackageMailModule, type MailOptions as PackageMailOptions } from "@starci/mail"
import { Module, type DynamicModule } from "@nestjs/common"
import { MAIL_SETTINGS } from "./mail.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./mail.module-definition"

@Module({})
/** Composes `@starci/mail` with the app's typed settings and provides the settings of the app's own mail. */
export class MailModule extends ConfigurableModuleClass {
    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const { webOrigin, brandName, defaultLanguage, confirmTtlSeconds, resetTtlSeconds, isGlobal, ...transport } =
            options
        const base = super.register(options)
        const mail = PackageMailModule.register({ ...(transport satisfies PackageMailOptions), isGlobal: false })
        return {
            ...base,
            imports: [...(base.imports ?? []), mail],
            providers: [
                ...(base.providers ?? []),
                {
                    provide: MAIL_SETTINGS,
                    useValue: {
                        ...transport,
                        webOrigin,
                        brandName,
                        defaultLanguage,
                        confirmTtlSeconds,
                        resetTtlSeconds,
                    },
                },
            ],
            exports: [...(base.exports ?? []), mail, MAIL_SETTINGS],
            global: isGlobal === true,
        }
    }
}
