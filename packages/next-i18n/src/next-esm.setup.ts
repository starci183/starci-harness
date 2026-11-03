import { registerHooks } from "node:module"

/** The Next subpaths next-intl imports bare; Next ships no `exports` map, so Node's ES module resolution needs the file name. */
const NEXT_SUBPATH = /^next\/[a-z-]+$/

/**
 * Lets the specs run next-intl's server modules in Node, the way a bundler resolves them: a bare `next/server` resolves to
 * `next/server.js`. Loaded by `npm test` with `--import`; it is no part of the published package.
 */
registerHooks({
    resolve: (specifier, context, nextResolve) => nextResolve(NEXT_SUBPATH.test(specifier) ? `${specifier}.js` : specifier, context),
})
