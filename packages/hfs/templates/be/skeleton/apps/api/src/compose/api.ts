import type { DynamicModule, Type } from "@nestjs/common"
import { AuthHttpModule } from "@features/api/auth"

/** The API transports of the app: the sign-in doors; `starci app add api` registers each generated door here. */
export const apiModules = (): Array<Type<unknown> | DynamicModule> => [AuthHttpModule.register({})]
