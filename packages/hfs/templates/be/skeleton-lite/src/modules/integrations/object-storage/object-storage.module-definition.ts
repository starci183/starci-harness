import { defineCapabilityModule } from "@starci/nest-kit"
import type { ObjectStorageOptions } from "./object-storage.options"

/** The configurable-module base of the object storage glue; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<ObjectStorageOptions>()
