import { OBJECT_STORAGE } from "@starci/object-storage"
import type { ObjectStorage } from "@starci/object-storage"
import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"

/** Token of the bucket of the app's objects. */
export const OBJECT_STORAGE_BUCKET: unique symbol = Symbol("integrations.object-storage.bucket")

/** Injects the object storage port of `@starci/object-storage`. Parameter type: ObjectStorage. */
export const InjectObjectStorage = (): TypedParameterDecorator<ObjectStorage> => injector<ObjectStorage>(OBJECT_STORAGE)

/** Injects the bucket of the app's objects. Parameter type: string. */
export const InjectObjectStorageBucket = (): TypedParameterDecorator<string> => injector<string>(OBJECT_STORAGE_BUCKET)
