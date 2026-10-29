// proves: FE_TRANSPORT_OWNER@lite
/**
 * The session issuer's client of `modules/auth` (FE-AUTH): one door file, `modules/auth/auth-door.ts`, calls the app's own back-end
 * auth doors with the REST client, and one store file, `modules/auth/token-store.ts`, keeps the in-memory access token. Every other
 * file of `modules/auth`, and every other module, stays outside the transport.
 *
 *   node --test src/auth-door.spec.ts
 */
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { fetchOnlyInApiClient, noSharedTransportState } from "./transport.ts"

const slots = slotTester()
const DOOR = at("apps/web/src/modules/auth/auth-door.ts")
const STORE = at("apps/web/src/modules/auth/token-store.ts")
const CLIENT = at("apps/web/src/modules/auth/client.ts")
const HOOK = at("apps/web/src/hooks/auth/useSignIn.ts")

test("fetch-only-in-api-client: the auth door alone takes the REST client, and calls only /auth/ doors", () => {
  slots.run("fetch-only-in-api-client", fetchOnlyInApiClient, {
    valid: [
      { filename: DOOR, code: 'import axios from "axios"\nexport const signIn = (base: string, body: unknown) => axios.post(`${base}/auth/sign-in`, body, { withCredentials: true })' },
      { filename: DOOR, code: 'import axios from "axios"\nexport const refresh = () => axios.post("/auth/refresh", undefined, { withCredentials: true })' },
      // a path the rule cannot read is left to review
      { filename: DOOR, code: 'import axios from "axios"\nexport const call = (url: string) => axios.post(url)' },
    ],
    invalid: [
      { filename: CLIENT, code: 'import axios from "axios"\nexport const a = axios', errors: [{ messageId: "placed" }] },
      { filename: HOOK, code: 'import axios from "axios"\nexport const a = axios', errors: [{ messageId: "placed" }] },
      { filename: DOOR, code: 'import axios from "axios"\nexport const orders = (base: string) => axios.get(`${base}/orders`)', errors: [{ messageId: "authDoor" }] },
      { filename: DOOR, code: 'export const signIn = () => fetch("/auth/sign-in")', errors: [{ messageId: "outside" }] },
    ],
  })
})

test("no-shared-transport-state: modules/auth keeps module-level state only in its token store", () => {
  slots.run("no-shared-transport-state", noSharedTransportState, {
    valid: [
      { filename: STORE, code: "let current: string | undefined\nexport const read = () => current\nexport const write = (next: string | undefined) => { current = next }" },
      { filename: HOOK, code: "let cache = 0\nexport const bump = () => { cache += 1; return cache }" },
    ],
    invalid: [
      { filename: CLIENT, code: "let token: string | undefined\nexport const read = () => token", errors: [{ messageId: "shared" }] },
      { filename: DOOR, code: "let token: string | undefined\nexport const read = () => token", errors: [{ messageId: "shared" }] },
    ],
  })
})
