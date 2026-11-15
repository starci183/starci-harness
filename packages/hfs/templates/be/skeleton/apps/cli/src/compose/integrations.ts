import type { DynamicModule } from "@nestjs/common"
import { DataSeedModule } from "@modules/integrations/seed"

/** The integrations of the cli: the store adapters of the data standard, which the cli's commands serve. */
export const integrationModules = (): Array<DynamicModule> => [DataSeedModule.register({ isGlobal: true })]
