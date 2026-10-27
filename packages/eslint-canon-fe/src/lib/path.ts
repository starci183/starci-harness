/** Forward-slash form of a filename, so Windows paths compare like every other path. */
export const normalizePath = (filename: unknown): string => String(filename || "").replace(/\\/g, "/")
