import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import type { RequiredProbesService } from "./required-probes.service"

/** Token of the required dependencies readiness waits for, exported so a spec can provide it. */
export const REQUIRED_PROBES: unique symbol = Symbol("platform.http-security.required-probes")

/** Injects the required dependencies readiness waits for. Parameter type: RequiredProbesService. */
export const InjectRequiredProbes = (): TypedParameterDecorator<RequiredProbesService> =>
    injector<RequiredProbesService>(REQUIRED_PROBES)
