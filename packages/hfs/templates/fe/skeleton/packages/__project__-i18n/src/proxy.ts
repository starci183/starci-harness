import { createProxy } from "@starci/next-i18n/proxy"
import type { LocaleProxy } from "@starci/next-i18n/proxy"
import { i18n } from "./routing"

/**
 * The one thing that runs before a route exists: which language it is in. The product's one description of its languages, read by
 * the package's proxy; each app's `src/proxy.ts` re-exports this.
 */
export const proxy: LocaleProxy = createProxy(i18n)
