import { ObjectStorageModule } from "@starci/object-storage"
import type { ObjectStorageOptions as StorageSettings } from "@starci/object-storage"
import type { DynamicModule } from "@nestjs/common"
import { CLOCK } from "@modules/platform/clock"
import type { Clock } from "@modules/platform/clock"
import { OBJECT_STORAGE_BUCKET } from "./object-storage.decorators"
import type { ObjectStorageOptions } from "./object-storage.options"

/** The object storage package as a Nest module: the typed settings and the app's clock, plus the bucket of the app's objects. */
export const objectStorageModule = (options: ObjectStorageOptions): DynamicModule => {
    const { bucket, ...settings } = options
    const base = ObjectStorageModule.registerAsync({
        isGlobal: true,
        inject: [CLOCK],
        useFactory: (clock: Clock): StorageSettings => ({ ...settings, clock }),
    })
    return {
        ...base,
        providers: [...(base.providers ?? []), { provide: OBJECT_STORAGE_BUCKET, useValue: bucket }],
        exports: [...(base.exports ?? []), OBJECT_STORAGE_BUCKET],
    }
}
