import { ConfigurableModuleBuilder, Module } from "@nestjs/common"
import type { DynamicModule } from "@nestjs/common"
import { AwsS3Transport } from "./aws.ts"
import type { ObjectStorageOptions } from "./options.ts"
import { ObjectStorageService } from "./service.ts"
import { OBJECT_STORAGE } from "./tokens.ts"

/** The extras every registration sets beside the options. */
export interface ObjectStorageModuleExtras {
    /** Whether the module is global. */
    readonly isGlobal: boolean
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = new ConfigurableModuleBuilder<ObjectStorageOptions>({
    moduleName: "ObjectStorage",
})
    .setClassMethodName("register")
    .setFactoryMethodName("createObjectStorageOptions")
    .setExtras<ObjectStorageModuleExtras>({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()

/** What `ObjectStorageModule.register` takes: the typed options, plus `isGlobal`. */
export type ObjectStorageRegisterOptions = typeof OPTIONS_TYPE

/** What `ObjectStorageModule.registerAsync` takes: `imports`, `inject` and one of `useFactory`, `useClass`, `useExisting`, plus `isGlobal`. */
export type ObjectStorageRegisterAsyncOptions = typeof ASYNC_OPTIONS_TYPE

const withPort = (base: DynamicModule): DynamicModule => ({
    ...base,
    providers: [
        ...(base.providers ?? []),
        {
            provide: OBJECT_STORAGE,
            inject: [MODULE_OPTIONS_TOKEN],
            useFactory: (options: ObjectStorageOptions): ObjectStorageService => new ObjectStorageService(new AwsS3Transport(options), options),
        },
    ],
    exports: [...(base.exports ?? []), OBJECT_STORAGE],
})

/**
 * Object storage as one Nest capability: presigned PUT and GET with expiry, head, get, put, list, delete and bucket setup over
 * S3-compatible storage (MinIO in lite), behind the `ObjectStorage` port under the `OBJECT_STORAGE` token. The module reads no
 * environment; the app parses its settings and passes them typed.
 */
export class ObjectStorageModule extends ConfigurableModuleClass {
    /** Registers the module from options known now. */
    static override register(options: ObjectStorageRegisterOptions): DynamicModule {
        return withPort(super.register(options))
    }

    /** Registers the module from options a factory, class or existing provider supplies. */
    static override registerAsync(options: ObjectStorageRegisterAsyncOptions): DynamicModule {
        return withPort(super.registerAsync(options))
    }
}

Module({})(ObjectStorageModule)
