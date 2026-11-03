import { ObjectStorageModule as StorageModule } from "@starci/object-storage"
import type { ObjectStorageOptions as StorageSettings } from "@starci/object-storage"
import { Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { CLOCK } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { OBJECT_STORAGE_BUCKET } from "./object-storage.decorators"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./object-storage.module-definition"

@Module({})
/** Composes `@starci/object-storage` with the app's typed settings and clock, and provides the bucket of the app's objects. */
export class ObjectStorageModule extends ConfigurableModuleClass {
    /** Registers the capability once per app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const { bucket, isGlobal, ...settings } = options
        const base = super.register(options)
        const storage = StorageModule.registerAsync({
            inject: [CLOCK],
            useFactory: (clock: Clock): StorageSettings => ({ ...settings, clock }),
        })
        return {
            ...base,
            imports: [...(base.imports ?? []), storage],
            providers: [...(base.providers ?? []), { provide: OBJECT_STORAGE_BUCKET, useValue: bucket }],
            exports: [...(base.exports ?? []), storage, OBJECT_STORAGE_BUCKET],
            global: isGlobal === true,
        }
    }
}
