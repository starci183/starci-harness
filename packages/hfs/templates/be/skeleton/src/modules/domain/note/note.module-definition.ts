import { defineCapabilityModule } from "@starci/nest-kit"
import type { NoteOptions } from "./note.options"

/** The configurable-module base of the note capability; `isGlobal` is decided by the app root. */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = defineCapabilityModule<NoteOptions>()
