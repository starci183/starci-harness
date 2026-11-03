import assert from "node:assert/strict"
import test from "node:test"
import { defineI18n } from "./config.ts"
import { LOCALE_HEADER, readRequestLocale } from "./locale.ts"
import type { LocaleReaders } from "./locale.ts"

const i18n = defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "UTC", localeCookie: { name: "APP_LOCALE" } })

interface Values {
    readonly route?: unknown
    readonly header?: string
    readonly cookie?: string
}

/** Readers over fixed values that record which source was asked. */
const readers = (values: Values): { readonly asked: string[]; readonly readers: LocaleReaders } => {
    const asked: string[] = []
    return {
        asked,
        readers: {
            route: () => {
                asked.push("route")
                return Promise.resolve(values.route)
            },
            header: (name) => {
                asked.push(`header:${name}`)
                return Promise.resolve(values.header)
            },
            cookie: (name) => {
                asked.push(`cookie:${name}`)
                return Promise.resolve(values.cookie)
            },
        },
    }
}

test("FE-I18N-1: the locale the route states wins, and no header or cookie is read for it", async () => {
    const { asked, readers: r } = readers({ route: "en", header: "vi", cookie: "vi" })
    assert.equal(await readRequestLocale(i18n, r), "en")
    assert.deepEqual(asked, ["route"])
})

test("FE-I18N-1: without a route locale the proxy's header decides, then the cookie, then the default", async () => {
    assert.equal(await readRequestLocale(i18n, readers({ route: "fr", header: "en" }).readers), "en")
    const cookie = readers({ header: "fr", cookie: "en" })
    assert.equal(await readRequestLocale(i18n, cookie.readers), "en")
    assert.deepEqual(cookie.asked, ["route", `header:${LOCALE_HEADER}`, "cookie:APP_LOCALE"])
    assert.equal(await readRequestLocale(i18n, readers({ cookie: "fr" }).readers), "vi")
    assert.equal(await readRequestLocale(i18n, readers({}).readers), "vi")
})

test("an app that reads no route locale goes straight to the header", async () => {
    const { asked, readers: r } = readers({ header: "en" })
    assert.equal(await readRequestLocale(i18n, { header: r.header, cookie: r.cookie }), "en")
    assert.deepEqual(asked, [`header:${LOCALE_HEADER}`])
})
