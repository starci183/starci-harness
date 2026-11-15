import { Module, type DynamicModule } from "@nestjs/common"
import { DatabaseStore } from "./database.adapter"
import { DATABASE_STORE } from "./seed.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./seed.module-definition"

@Module({})
/**
 * Composes the store adapters of `@starci/seed` that read only through platform, one per such store `data.stores` of
 * `application-stacks.yaml` declares (PROJECT-STACKS-14): the stack declaration names the adapter file, and this module composes it.
 */
export class DataSeedModule extends ConfigurableModuleClass {
    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [...(base.providers ?? []), { provide: DATABASE_STORE, useClass: DatabaseStore }],
            exports: [DATABASE_STORE],
        }
    }
}
