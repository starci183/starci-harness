import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"
import type { ObjectStorage } from "./storage.options"

/** Token of the object storage port. */
export const OBJECT_STORAGE: unique symbol = Symbol("integrations.storage.object-storage")

/** Injects the object storage port. Parameter type: ObjectStorage. */
export const InjectObjectStorage = (): TypedParameterDecorator<ObjectStorage> => injector<ObjectStorage>(OBJECT_STORAGE)
