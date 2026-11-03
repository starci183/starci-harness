// proves: FE_TRANSPORT_OWNER@lite
/**
 * The session issuer's client of `modules/auth` (FE-AUTH): it is `@starci/auth/client` over the app's own back-end auth doors, so
 * no file of `modules/auth` takes a transport library or `fetch`, and none keeps module-level mutable state.
 *
 *   node --test src/auth-client.spec.ts
 */
import test from "node:test"
import { at, slotTester } from "../fixtures/typed/tester.ts"
import { fetchOnlyInApiClient, noSharedTransportState } from "./transport.ts"

const slots = slotTester()
const CLIENT = at("apps/web/src/modules/auth/client.ts")
const OTHER = at("apps/web/src/modules/auth/session.ts")
const HOOK = at("apps/web/src/hooks/auth/useSignIn.ts")

test("fetch-only-in-api-client: no file of modules/auth takes axios or fetch; the package client owns the doors", () => {
  slots.run("fetch-only-in-api-client", fetchOnlyInApiClient, {
    valid: [{ filename: CLIENT, code: 'import { createAuthClient } from "@starci/auth/client"\nexport const auth = createAuthClient({ apiOrigin: "https://api.example.test" })' }],
    invalid: [
      { filename: CLIENT, code: 'import axios from "axios"\nexport const a = axios', errors: [{ messageId: "placed" }] },
      { filename: OTHER, code: 'import axios from "axios"\nexport const a = axios', errors: [{ messageId: "placed" }] },
      { filename: HOOK, code: 'import axios from "axios"\nexport const a = axios', errors: [{ messageId: "placed" }] },
      { filename: CLIENT, code: 'export const signIn = () => fetch("/auth/login")', errors: [{ messageId: "outside" }] },
    ],
  })
})

test("no-shared-transport-state: modules/auth keeps no module-level mutable state, the token lives in the package client", () => {
  slots.run("no-shared-transport-state", noSharedTransportState, {
    valid: [{ filename: HOOK, code: "let cache = 0\nexport const bump = () => { cache += 1; return cache }" }],
    invalid: [
      { filename: CLIENT, code: "let token: string | undefined\nexport const read = () => token", errors: [{ messageId: "shared" }] },
      { filename: OTHER, code: "let token: string | undefined\nexport const read = () => token", errors: [{ messageId: "shared" }] },
    ],
  })
})
