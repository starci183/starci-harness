/** The only process-environment reader in the web app. */
const required = (name: string, value: string | undefined): string => {
    if (value === undefined || value === "") throw new Error(`${name} is not set`)
    return value
}

/** The public origin used for metadata. */
export const siteUrl = (): string => required("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL)
/** The public origin of the API whose auth doors modules/auth calls; the browser holds no credential of its own. */
export const apiUrl = (): string => required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL)
/** The URL of a repo-owned static: the public base of the statics in the app's own store plus its staticsKey, the path under statics/. */
export const staticsUrl = (key: string): string => `${required("NEXT_PUBLIC_STATICS_URL", process.env.NEXT_PUBLIC_STATICS_URL).replace(/\/+$/u, "")}/${key.replace(/^\/+/u, "")}`
