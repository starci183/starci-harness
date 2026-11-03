import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createAuthClient } from "../client/index.ts"
import { AuthProvider, useAuthClient, useAuthSession, useCooldown, useWhenSignedIn } from "./index.ts"

const client = createAuthClient({ apiOrigin: "https://api.example.test", fetch: () => Promise.reject(new Error("offline")) })

describe("React bindings", () => {
    it("reads the session snapshot through the provider and renders loading on the server", () => {
        const View = () => {
            const session = useAuthSession()
            const same = useAuthClient() === client
            useWhenSignedIn(() => undefined)
            return createElement("p", null, `${session.status}:${String(same)}`)
        }
        const html = renderToString(createElement(AuthProvider, { client }, createElement(View)))
        assert.match(html, /loading:true/u)
    })

    it("needs the provider", () => {
        const View = () => {
            useAuthClient()
            return null
        }
        assert.throws(() => renderToString(createElement(View)), /AuthProvider/u)
    })

    it("counts a cooldown down from where it starts", () => {
        const View = () => createElement("p", null, String(useCooldown(60, true).left))
        assert.match(renderToString(createElement(View)), />60</u)
        const Idle = () => createElement("p", null, String(useCooldown(60).left))
        assert.match(renderToString(createElement(Idle)), />0</u)
    })
})
