import type { DynamicModule } from "@nestjs/common"
import type { AiRouterRegisterOptions } from "./ai-router.module-definition.ts"
import { AiRouterModule } from "./ai-router.module.ts"
import type { FakeProvider } from "./fake.ts"

/** What `AiRouterTestingModule.register` takes: a registration whose requests a fake provider answers. */
export type AiRouterTestingOptions = Omit<AiRouterRegisterOptions, "fetch"> & {
    /** The provider every request goes to, in process; script it with `fake.on` and read `fake.calls`. */
    readonly fake: FakeProvider
}

/** `AiRouterModule` wired to a fake provider, for a consumer's tests. */
export const AiRouterTestingModule = {
    /** Registers the router like `AiRouterModule.register`, sending through `fake`, with a fixed jitter unless `random` is given. */
    register({ fake, ...options }: AiRouterTestingOptions): DynamicModule {
        return AiRouterModule.register({ ...options, fetch: fake.fetch, random: options.random ?? (() => 0.5) })
    },
}
