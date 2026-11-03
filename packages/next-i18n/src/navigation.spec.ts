import assert from "node:assert/strict"
import test from "node:test"
import { defineI18n } from "./config.ts"
import { createI18nNavigation } from "./navigation.ts"

test("FE-I18N-4: the navigation of the app's routing offers the locale-aware link, redirect, pathname and router", () => {
    const navigation = createI18nNavigation(defineI18n({ locales: ["vi", "en"], defaultLocale: "vi", timeZone: "UTC" }))
    assert.equal(typeof navigation.Link, "object")
    assert.equal(typeof navigation.redirect, "function")
    assert.equal(typeof navigation.usePathname, "function")
    assert.equal(typeof navigation.useRouter, "function")
    assert.equal(navigation.getPathname({ locale: "en", href: "/orders" }), "/en/orders")
    assert.equal(navigation.getPathname({ locale: "vi", href: "/orders" }), "/orders")
})
