// Managed by starci app sync (slot fe.modules.auth.client); do not edit: run "npx starci app sync --execute".
import { createAuthClient } from "@starci/auth/client"
import { apiUrl } from "@/modules/config"
import type { AuthClient, AuthFailure, AuthSession } from "./contracts"

/** The one instance of the front end: the doors of the app's own back end, the access token in its memory, one shared refresh. */
const auth = createAuthClient({ apiOrigin: () => apiUrl() })

const sessionOf = (user: { readonly id: string; readonly email: string } | null): AuthSession | undefined =>
    user === null ? undefined : { userId: user.id, ...(user.email === "" ? {} : { email: user.email }) }

/** The lite session issuer's client: `@starci/auth/client` behind the interface every edition shares. */
export const authClient: AuthClient = {
    session: async () => sessionOf(await auth.user()),
    accessToken: () => auth.accessToken(),
    refreshAccessToken: () => auth.renew(),
    signInWithPassword: async (email, password): Promise<AuthFailure | undefined> => {
        const outcome = await auth.signIn({ email, password })
        return outcome.success ? undefined : { code: outcome.error, kind: outcome.message, message: "" }
    },
    signOut: async () => {
        await auth.signOut()
        return undefined
    },
    onChange: (listener) => auth.subscribe(() => listener(sessionOf(auth.getSnapshot().user))),
}
