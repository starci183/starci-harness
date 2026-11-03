import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_LOCALE_COOKIE, defineI18n } from "./config.ts"

const vi = defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "Asia/Ho_Chi_Minh" })

test("FE-I18N-1: the routing is the app's locales, the default and the prefix mode, as-needed unless the app says otherwise", () => {
    assert.deepEqual(vi.routing.locales, ["vi", "en"])
    assert.equal(vi.routing.defaultLocale, "vi")
    assert.equal(vi.routing.localePrefix, "as-needed")
    assert.equal(vi.localePrefix, "as-needed")
    assert.equal(vi.timeZone, "Asia/Ho_Chi_Minh")
})

test("FE-I18N-1: the locale cookie is next-intl's own unless the app names one, and the prefix mode never keeps the address bare", () => {
    assert.equal(vi.localeCookieName, DEFAULT_LOCALE_COOKIE)
    const cookie = defineI18n({
        locales: ["vi", "en"],
        defaultLocale: "vi",
        timeZone: "UTC",
        localePrefix: "never",
        localeCookie: { name: "APP_LOCALE", maxAge: 60 * 60 * 24 * 365 },
    })
    assert.equal(cookie.localeCookieName, "APP_LOCALE")
    assert.equal(cookie.localePrefix, "never")
    assert.deepEqual(cookie.routing.localeCookie, { name: "APP_LOCALE", path: "/", maxAge: 31_536_000, sameSite: "lax" })
    const strict = defineI18n({ locales: ["en"], defaultLocale: "en", timeZone: "UTC", localeCookie: { name: "L", sameSite: "strict" } })
    assert.deepEqual(strict.routing.localeCookie, { name: "L", path: "/", sameSite: "strict" })
})

test("isLocale and localeOf narrow to the served locales and fall back to the default for anything else", () => {
    assert.equal(vi.isLocale("en"), true)
    assert.equal(vi.isLocale("fr"), false)
    assert.equal(vi.isLocale(undefined), false)
    assert.equal(vi.isLocale(["en"]), false)
    assert.equal(vi.localeOf("en"), "en")
    assert.equal(vi.localeOf("fr"), "vi")
    assert.equal(vi.localeOf(null), "vi")
})

test("intlTagOf is the locale itself unless the app maps it to a BCP 47 tag", () => {
    assert.equal(vi.intlTagOf("en"), "en")
    const tagged = defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "UTC", intlTags: { vi: "vi-VN", en: "en-GB" } })
    assert.equal(tagged.intlTagOf("vi"), "vi-VN")
    assert.equal(tagged.intlTagOf("en"), "en-GB")
    assert.equal(tagged.intlTagOf("fr"), "vi-VN")
    assert.equal(vi.intlTagOf(undefined), "vi")
})

test("localeDetection and alternateLinks pass through to the routing only when the app states them", () => {
    assert.equal("localeDetection" in vi.routing, false)
    assert.equal("alternateLinks" in vi.routing, false)
    const stated = defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "UTC", localeDetection: false, alternateLinks: false })
    assert.equal(stated.routing.localeDetection, false)
    assert.equal(stated.routing.alternateLinks, false)
})

test("the locales stay a literal union, so a catalog loader and a layout see exactly the served locales", () => {
    const narrowed = (value: unknown): "vi" | "en" => vi.localeOf(value)
    assert.equal(narrowed("en"), "en")
    const served: readonly ("vi" | "en")[] = vi.locales
    const prefix: "as-needed" = vi.localePrefix
    assert.deepEqual(served, ["vi", "en"])
    assert.equal(prefix, "as-needed")
})
