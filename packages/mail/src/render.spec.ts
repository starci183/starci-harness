import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULT_ACCENT, MAIL_ERROR_CODES, MailError, SafeHtml, escapeHtml, html, oneLine, raw, renderTransactional, safeUrl } from "./index.ts"

describe("escaping", () => {
    it("escapes the characters that open markup or end an attribute", () => {
        assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;")
    })

    it("escapes every interpolation of the html tag and places a SafeHtml, a list and numbers as they are", () => {
        const name = `<script>alert("x")</script>`
        const out = html`<p>${name} ${3} ${raw("<b>trusted</b>")} ${[html`<i>${"a&b"}</i>`, "<"]} ${null}${undefined}${false}${true}</p>`
        assert.ok(out instanceof SafeHtml)
        assert.equal(out.toString(), "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; 3 <b>trusted</b> <i>a&amp;b</i>&lt; </p>")
    })

    it("collapses a text to one line", () => {
        assert.equal(oneLine("  Hello\r\n  World\t!  "), "Hello World !")
    })
})

describe("safeUrl", () => {
    it("accepts an absolute https or http link and normalises it", () => {
        assert.equal(safeUrl("https://app.test/confirm?token=a b"), "https://app.test/confirm?token=a%20b")
        assert.equal(safeUrl("http://localhost:3000/x"), "http://localhost:3000/x")
    })

    it("refuses a relative link, a script link and a link with a line break", () => {
        for (const bad of ["/confirm", "javascript:alert(1)", "data:text/html,x", "https://app.test/\nBcc: x@y.test", ""]) {
            assert.throws(() => safeUrl(bad), (error: unknown) => error instanceof MailError && error.code === MAIL_ERROR_CODES.MessageInvalid, bad)
        }
    })
})

describe("renderTransactional", () => {
    const base = {
        lang: "vi",
        subject: "Xác nhận email",
        brand: { name: "Acme <&>", accent: "#112233" },
        paragraphs: ["Chào <b>Ada</b>", "Nhấn nút bên dưới."],
        action: { label: "Xác nhận", url: "https://app.test/confirm?token=t1&next=%2F" },
        footer: "Bỏ qua thư này nếu không phải bạn.",
    } as const

    it("renders the subject, a text twin with the link, and an html twin with every value escaped", () => {
        const mail = renderTransactional(base)
        assert.equal(mail.subject, "Xác nhận email")
        assert.equal(
            mail.text,
            ["Xác nhận email", "", "Chào <b>Ada</b>", "", "Nhấn nút bên dưới.", "", "Xác nhận: https://app.test/confirm?token=t1&next=%2F", "", "Bỏ qua thư này nếu không phải bạn.", "", "-- Acme <&>"].join("\n"),
        )
        assert.match(mail.html, /<html lang="vi">/u)
        assert.ok(mail.html.includes("Acme &lt;&amp;&gt;"), "the brand name is escaped")
        assert.ok(mail.html.includes("Chào &lt;b&gt;Ada&lt;/b&gt;"), "a paragraph carries no markup")
        assert.ok(mail.html.includes(`href="https://app.test/confirm?token=t1&amp;next=%2F"`), "the link is escaped in the attribute")
        assert.ok(mail.html.includes("background:#112233"), "the accent colours the button")
        assert.ok(!mail.html.includes("<b>Ada"), "no user markup survives")
    })

    it("falls back to the default accent for a malformed one and to the subject for the heading", () => {
        const mail = renderTransactional({ lang: "en", paragraphs: base.paragraphs, brand: { name: "Acme", accent: "red; background:url(x)" }, subject: "Line one\nLine two" })
        assert.equal(mail.subject, "Line one Line two")
        assert.ok(mail.html.includes(`color:${DEFAULT_ACCENT}`))
        assert.ok(mail.html.includes("<h1 style=\"margin:0 0 16px;font-size:20px;\">Line one Line two</h1>"))
        assert.ok(!mail.html.includes("<a "))
        assert.ok(!mail.text.includes("http"))
    })

    it("refuses a button whose link is not an absolute web link", () => {
        assert.throws(() => renderTransactional({ ...base, action: { label: "Go", url: "javascript:alert(1)" } }), MailError)
    })
})
