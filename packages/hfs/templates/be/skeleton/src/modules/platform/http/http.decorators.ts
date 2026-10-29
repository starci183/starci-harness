import { injector } from "@modules/platform/composition"
import type { TypedParameterDecorator } from "@modules/platform/composition"
import type { HttpOptions } from "./http.options"
import type { HttpClient } from "./http.port"

/** Token of the http options, exported so a spec can provide it. */
export const HTTP_OPTIONS: unique symbol = Symbol("platform.http.options")

/** Token of the HttpClient port. */
export const HTTP_CLIENT: unique symbol = Symbol("platform.http.client")

/** Injects the options of the http capability. Parameter type: HttpOptions. */
export const InjectHttpOptions = (): TypedParameterDecorator<HttpOptions> => injector<HttpOptions>(HTTP_OPTIONS)

/** Injects the HttpClient port. Parameter type: HttpClient. */
export const InjectHttpClient = (): TypedParameterDecorator<HttpClient> => injector<HttpClient>(HTTP_CLIENT)
