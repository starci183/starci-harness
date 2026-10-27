import type { PoolConfig, RouterEvents } from "./types.ts"

/** One handler per router event, subscribed when the module starts and released when the application shuts down. */
export type AiRouterHandlers = { readonly [E in keyof RouterEvents]?: (payload: RouterEvents[E]) => void }

/** What `AiRouterModule.register` takes: the router's pool config plus optional event handlers. */
export type AiRouterModuleOptions<Profiles extends string = string> = PoolConfig<Profiles> & {
    /** Event handlers; like the events themselves, they never see a key value. */
    readonly on?: AiRouterHandlers
}
