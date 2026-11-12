import { ConfigurableModuleBuilder } from "@nestjs/common"
import type { JournalOptions } from "./journal.options"

/** The configurable-module base of the journal capability (fixture). */
export const { ConfigurableModuleClass, OPTIONS_TYPE } = new ConfigurableModuleBuilder<JournalOptions>()
    .setExtras({ isGlobal: false }, (definition, extras) => ({ ...definition, global: extras.isGlobal }))
    .build()
