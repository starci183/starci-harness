// starci app look (PROJECT-GALLERY-7 step 2b): the declaration it reads, the shots it plans, the cookies it hands the browser and the index it writes.
import assert from "node:assert/strict"
import test from "node:test"
import { appLookVerb, lookEnvOf, lookIndex, lookPlan, lookStamp, sessionCookies, shotFile, signedOut, widthsOf } from "./look.js"

const declared = {
    schema: "starci/app-look@1",
    envs: {
        dev: {
            web: "https://app-dev.example.org",
            api: "http://localhost:3501",
            signIn: { path: "/auth/login", email: "owner@seed.example.test", password: { member: "seed", key: "SEED_MEMBER_PASSWORD" } },
            workspace: { route: "/workspaces/{workspace}", default: "ws-demo" },
        },
    },
}

void test("the verb is starci app look with the flags its usage names", () => {
    assert.deepEqual(appLookVerb.path, ["app", "look"])
    for (const flag of ["app", "env", "paths", "workspace", "widths", "out"]) assert.ok(flag in appLookVerb.flags, flag)
    assert.equal(appLookVerb.flags.paths.required, true)
})

void test("an environment is read from gallery/look.json; a missing file, environment or field is refused by code", () => {
    const settings = lookEnvOf(JSON.stringify(declared), "dev")
    assert.equal(settings.web, "https://app-dev.example.org")
    assert.equal(settings.signIn.password.key, "SEED_MEMBER_PASSWORD")
    assert.throws(() => lookEnvOf(null, "dev"), /LOOK_NOT_DECLARED|gallery\/look\.json is missing/u)
    assert.throws(() => lookEnvOf(JSON.stringify(declared), "prod"), /declares no environment prod \(it declares dev\)/u)
    assert.throws(() => lookEnvOf("{", "dev"), /is not JSON/u)
    assert.throws(() => lookEnvOf(JSON.stringify({ ...declared, envs: { dev: { ...declared.envs.dev, password: "x" } } }), "dev"), /envs\.dev/u)
})

void test("widths default to 1440 and 390 and take comma-separated or repeated values", () => {
    assert.deepEqual(widthsOf([]), [1440, 390])
    assert.deepEqual(widthsOf(["1440,390", "768"]), [1440, 390, 768])
    assert.throws(() => widthsOf(["wide"]), /--widths takes pixel widths/u)
})

void test("every route is shot at every width, under the workspace route unless already full", () => {
    const settings = lookEnvOf(JSON.stringify(declared), "dev")
    const plan = lookPlan(settings, ["/chat", "/workspaces/other/leads", "/"], [1440, 390], "ws-demo")
    assert.deepEqual(plan.map((shot) => [shot.url, shot.width, shot.file]), [
        ["https://app-dev.example.org/workspaces/ws-demo/chat", 1440, "chat-1440.png"],
        ["https://app-dev.example.org/workspaces/ws-demo/chat", 390, "chat-390.png"],
        ["https://app-dev.example.org/workspaces/other/leads", 1440, "workspaces-other-leads-1440.png"],
        ["https://app-dev.example.org/workspaces/other/leads", 390, "workspaces-other-leads-390.png"],
        ["https://app-dev.example.org/workspaces/ws-demo", 1440, "root-1440.png"],
        ["https://app-dev.example.org/workspaces/ws-demo", 390, "root-390.png"],
    ])
    assert.equal(lookPlan(settings, ["/login"], [390], undefined)[0]?.url, "https://app-dev.example.org/login")
    assert.throws(() => lookPlan(settings, [], [390], undefined), /--paths names at least one route/u)
    assert.throws(() => lookPlan(settings, ["chat"], [390], undefined), /start with \//u)
    assert.equal(shotFile("/leads?tab=new", 390), "leads-tab-new-390.png")
})

void test("the session is the cookies the web host receives: a shared parent domain first, else host-only ones bound to the web", () => {
    const shared = sessionCookies(["sid=abc; Domain=example.org; Path=/; HttpOnly; Secure; SameSite=Lax", "local=1; Path=/", "other=2; Domain=elsewhere.com"], "https://app-dev.example.org")
    assert.deepEqual(shared, [{ name: "sid", value: "abc", domain: ".example.org", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }])
    const hostOnly = sessionCookies(["refresh=r=1; Path=/auth; HttpOnly; SameSite=Strict"], "https://app-dev.example.org")
    assert.deepEqual(hostOnly, [{ name: "refresh", value: "r=1", domain: "app-dev.example.org", path: "/auth", secure: false, httpOnly: true, sameSite: "Strict" }])
    assert.deepEqual(sessionCookies(["x=1; Domain=elsewhere.com"], "https://app-dev.example.org"), [])
    const rotated = sessionCookies([
        "refresh_token=; Domain=example.org; Path=/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
        "refresh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure",
        "refresh_token=live; Max-Age=2592000; Domain=example.org; Path=/; HttpOnly; Secure; SameSite=Lax",
    ], "https://app-dev.example.org")
    assert.deepEqual(rotated.map((cookie) => [cookie.name, cookie.value, cookie.domain, cookie.path]), [["refresh_token", "live", ".example.org", "/"]], "a clearing header sets nothing")
})

void test("a host-only cookie the api set is bound to the api host too: the web calls its api across hosts (no shared cookie domain in dev)", () => {
    const at = new Date("2026-11-23T05:00:00.000Z")
    const cross = sessionCookies(["next_refresh=r1; Path=/auth; HttpOnly; Secure; SameSite=Strict"], "https://next-app-dev.example.org", at, "https://next-api-dev.example.org")
    assert.deepEqual(
        cross.map((cookie) => [cookie.name, cookie.domain, cookie.path, cookie.sameSite]),
        [
            ["next_refresh", "next-app-dev.example.org", "/auth", "Strict"],
            ["next_refresh", "next-api-dev.example.org", "/auth", "Strict"],
        ],
    )
    // a shared domain still comes first; the api host keeps its host-only cookies; an api on the web host binds nothing twice
    const shared = sessionCookies(["sid=abc; Domain=example.org; Path=/", "local=1; Path=/"], "https://app-dev.example.org", at, "https://api-dev.example.org")
    assert.deepEqual(shared.map((cookie) => [cookie.name, cookie.domain]), [["sid", ".example.org"], ["local", "api-dev.example.org"]])
    assert.deepEqual(sessionCookies(["local=1; Path=/"], "https://app-dev.example.org", at, "https://app-dev.example.org/api").map((cookie) => cookie.domain), ["app-dev.example.org"])
})

void test("the index names the app, the dev sha and each shot with its time; a sign-in page is a signed-out look", () => {
    const index = lookIndex({ app: "demo", env: "dev", web: "https://app-dev.example.org", workspace: "ws-demo", devSha: "abc123", startedAt: "2026-11-23T01:00:00.000Z" }, [
        { route: "/chat", url: "https://app-dev.example.org/workspaces/ws-demo/chat", width: 1440, file: "chat-1440.png", time: "2026-11-23T01:00:05.000Z", landed: "https://app-dev.example.org/workspaces/ws-demo/chat", status: 200, problem: null },
    ])
    assert.equal(index.schema, "starci/app-look-index@1")
    assert.equal(index.devSha, "abc123")
    assert.deepEqual(index.shots.map((shot) => [shot.route, shot.width, shot.time]), [["/chat", 1440, "2026-11-23T01:00:05.000Z"]])
    assert.equal(signedOut("https://app-dev.example.org/login?next=/chat"), true)
    assert.equal(signedOut("https://app-dev.example.org/workspaces/ws/chat"), false)
    assert.equal(lookStamp(new Date("2026-11-23T01:02:03.456Z")), "20261123T010203Z")
})
