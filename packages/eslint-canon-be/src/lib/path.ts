/** Forward-slash form of a filename, so Windows paths compare like every other path. */
export const normalizePath = (filename: string | null | undefined): string => String(filename || "").replace(/\\/g, "/")

/** A spec file: the unit lane, where a fixture may build a deliberately wrong value. */
export const isSpecFile = (filename: string | null | undefined): boolean => /\.(?:spec|test)\.[cm]?[jt]sx?$|-spec\.[cm]?[jt]sx?$/.test(normalizePath(filename))

/** A migration: the one place schema-changing SQL is allowed to be written. */
export const isMigrationFile = (filename: string | null | undefined): boolean => /\/persistence\/migrations\/[^/]+\.[cm]?[jt]s$/.test(normalizePath(filename))

/** A declaration file carries types only and no runtime behaviour to police. */
export const isDeclarationFile = (filename: string | null | undefined): boolean => /\.d\.[cm]?ts$/.test(normalizePath(filename))
