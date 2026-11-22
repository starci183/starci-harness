/**
 * The jest resolver of the root packages' unit projects. A package source imports its own files with the `.ts` extension (`allowImportingTsExtensions`)
 * and ts-jest rewrites that specifier to `.js`, a file that does not exist; the resolver maps the request back to the `.ts`, `.tsx` or `.mts` file, and only
 * when the `.js` file itself cannot be resolved, so a real `.js` file (and any package request) resolves as jest would resolve it.
 */
interface ResolverOptions {
  readonly defaultResolver: (request: string, options: ResolverOptions) => string
}

const SOURCE_EXTENSIONS: readonly string[] = Object.freeze([".ts", ".tsx", ".mts"])

function resolver(request: string, options: ResolverOptions): string {
  try {
    return options.defaultResolver(request, options)
  } catch (error) {
    if (!/^\.{1,2}\//.test(request) || !request.endsWith(".js")) throw error
    const stem = request.slice(0, -".js".length)
    for (const extension of SOURCE_EXTENSIONS) {
      try {
        return options.defaultResolver(stem + extension, options)
      } catch {
        // try the next extension; the first error is the one reported
      }
    }
    throw error
  }
}

export = resolver
