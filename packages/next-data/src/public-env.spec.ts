import assert from "node:assert/strict"
import { describe, it } from "node:test"
import vm from "node:vm"
import {
    PUBLIC_ENV_SCRIPT_ID,
    checkPublicEnvKeys,
    createPublicEnv,
    pickPublicEnv,
    publicEnvScript,
    publicEnvScriptProps,
    readPublicEnv,
    serializePublicEnv,
} from "./public-env.ts"

/** Runs an inline script text the way a browser would, in a fresh global with a `window`; `__ENV` comes back as a copy of this realm, `frozen` as it was set. */
const runScript = (text: string): { readonly __ENV: Record<string, unknown>; readonly frozen: boolean } => {
    const window: { __ENV?: object } = {}
    vm.runInNewContext(text, { window })
    const carried = window.__ENV ?? {}
    return { __ENV: { ...carried }, frozen: Object.isFrozen(carried) }
}

describe("the allowlist", () => {
    it("holds NEXT_PUBLIC_* names only, so a secret name is refused before any value is read", () => {
        assert.doesNotThrow(() => { checkPublicEnvKeys(["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_A1"]) })
        for (const key of ["DATABASE_URL", "NEXT_PUBLIC_", "next_public_api", "NEXT_PUBLIC_api", " NEXT_PUBLIC_X"]) {
            assert.throws(() => { checkPublicEnvKeys([key]) }, TypeError, key)
            assert.throws(() => pickPublicEnv([key], {}), TypeError, key)
            assert.throws(() => createPublicEnv([key]), TypeError, key)
            assert.throws(() => readPublicEnv(key, { env: {} }), TypeError, key)
        }
    })

    it("picks only the allowlisted keys that are set, never another key of the source", () => {
        const source = { NEXT_PUBLIC_API_URL: "https://api.staging.example", NEXT_PUBLIC_OTHER: "x", DATABASE_URL: "postgres://secret", NEXT_PUBLIC_UNSET: undefined }
        assert.deepEqual(pickPublicEnv(["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_UNSET"], source), { NEXT_PUBLIC_API_URL: "https://api.staging.example" })
    })

    it("reads process.env when no source is given", () => {
        process.env.NEXT_PUBLIC_SPEC_PICK = "from-process"
        try {
            assert.deepEqual(pickPublicEnv(["NEXT_PUBLIC_SPEC_PICK"]), { NEXT_PUBLIC_SPEC_PICK: "from-process" })
        } finally {
            delete process.env.NEXT_PUBLIC_SPEC_PICK
        }
    })
})

describe("the inline script", () => {
    it("sets a frozen window.__ENV with the allowlisted values", () => {
        const window = runScript(publicEnvScript(["NEXT_PUBLIC_API_URL"], { NEXT_PUBLIC_API_URL: "https://api.example", DATABASE_URL: "secret" }))
        assert.deepEqual(window.__ENV, { NEXT_PUBLIC_API_URL: "https://api.example" })
        assert.equal(window.frozen, true)
    })

    it("escapes every character that could close the script or break the line", () => {
        const hostile = "</script><script>alert(1)</script><!-- & \u2028\u2029 \"quoted\""
        const text = publicEnvScript(["NEXT_PUBLIC_X"], { NEXT_PUBLIC_X: hostile })
        assert.doesNotMatch(text, /[<>&\u2028\u2029]/u)
        assert.equal(text.includes("</script"), false)
        assert.deepEqual(runScript(text).__ENV, { NEXT_PUBLIC_X: hostile }, "the escaped JSON still reads back as the exact value")
        assert.equal(serializePublicEnv({ A: "<>&" }), `{"A":"${["003c", "003e", "0026"].map((hex) => `${String.fromCharCode(92)}u${hex}`).join("")}"}`)
    })

    it("renders the script props with the id, an optional nonce and the text", () => {
        const source = { NEXT_PUBLIC_A: "a" }
        const props = publicEnvScriptProps(["NEXT_PUBLIC_A"], { source })
        assert.equal(props.id, PUBLIC_ENV_SCRIPT_ID)
        assert.equal("nonce" in props, false)
        assert.equal(props.dangerouslySetInnerHTML.__html, publicEnvScript(["NEXT_PUBLIC_A"], source))
        assert.equal(publicEnvScriptProps(["NEXT_PUBLIC_A"], { source, nonce: "n0nce" }).nonce, "n0nce")
        assert.equal(publicEnvScriptProps(["NEXT_PUBLIC_A"]).id, PUBLIC_ENV_SCRIPT_ID)
    })
})

describe("publicEnv", () => {
    it("reads window.__ENV first, then the runtime environment, then the build/dev fallback", () => {
        const fallback = { NEXT_PUBLIC_A: "built", NEXT_PUBLIC_B: "built", NEXT_PUBLIC_C: "built" }
        const scope = { __ENV: { NEXT_PUBLIC_A: "window", NEXT_PUBLIC_N: 7 } }
        const env = { NEXT_PUBLIC_A: "runtime", NEXT_PUBLIC_B: "runtime" }
        assert.equal(readPublicEnv("NEXT_PUBLIC_A", { scope, env, fallback }), "window")
        assert.equal(readPublicEnv("NEXT_PUBLIC_B", { scope, env, fallback }), "runtime")
        assert.equal(readPublicEnv("NEXT_PUBLIC_C", { scope, env, fallback }), "built")
        assert.equal(readPublicEnv("NEXT_PUBLIC_N", { scope, env: undefined }), undefined, "a non-string in window.__ENV is not a value")
        assert.equal(readPublicEnv("NEXT_PUBLIC_D", { scope: { __ENV: null }, env: undefined }), undefined)
    })

    it("falls back to process.env when no runtime environment is injected", () => {
        process.env.NEXT_PUBLIC_SPEC_READ = "from-process"
        try {
            assert.equal(readPublicEnv("NEXT_PUBLIC_SPEC_READ", { scope: {} }), "from-process")
            assert.equal(readPublicEnv("NEXT_PUBLIC_SPEC_READ"), "from-process")
        } finally {
            delete process.env.NEXT_PUBLIC_SPEC_READ
        }
    })

    it("binds one app's allowlist: a key outside it reads as undefined, never from the environment", () => {
        const reader = createPublicEnv(["NEXT_PUBLIC_API_URL"], { NEXT_PUBLIC_API_URL: "http://localhost:3001" }, { scope: {}, env: { NEXT_PUBLIC_OTHER: "set" } })
        assert.deepEqual(reader.keys, ["NEXT_PUBLIC_API_URL"])
        assert.equal(reader.publicEnv("NEXT_PUBLIC_API_URL"), "http://localhost:3001", "dev and build read the fallback")
        assert.equal((reader.publicEnv as (key: string) => string | undefined)("NEXT_PUBLIC_OTHER"), undefined)
        const source = { NEXT_PUBLIC_API_URL: "https://api.example", NEXT_PUBLIC_OTHER: "set" }
        assert.deepEqual(runScript(reader.script(source)).__ENV, { NEXT_PUBLIC_API_URL: "https://api.example" })
        assert.equal(reader.scriptProps({ source, nonce: "n" }).nonce, "n")
        const browser = createPublicEnv(["NEXT_PUBLIC_API_URL"], {}, { scope: runScript(reader.script(source)), env: undefined })
        assert.equal(browser.publicEnv("NEXT_PUBLIC_API_URL"), "https://api.example", "the client reads what the server rendered")
    })
})
