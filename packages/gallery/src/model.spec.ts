// The data of the gallery: the tree, the statuses, the counts and the states of a fixture gallery with its design.json and canvas fragment.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { introClauses, noteToMarkdown, parseExplain } from "./explain.ts"
import { capitalize } from "./labels.ts"
import { loadGallery } from "./load.ts"
import { buildModel, devPath, splitState, statusOf } from "./model.ts"

const EXPLAIN = (title: string, route: string, area: string): string =>
    `---\ntitle: ${title}\nroute: ${route}\narea: ${area}\n---\nMục tiêu: xem khách. Thao tác: \`contacts\`.\n\n## Đầu trang\nVì sao: tên trang.\nLuật: HIERARCHY-1\nGrammar: \`Page\`\n`

const FRAGMENT = `<section class="page" id="customers-list" data-pid="customers/list" data-route="/customers" data-title="Khách hàng">
  <div class="row"><div class="frame"><div class="lbl">x · 1440</div><div class="scr w1440 zoom" style="height:900px"><div>shell</div></div></div>
  <div class="frame"><div class="scr w390"><div>phone</div></div></div>
  <div class="note"><div class="fm">title: Khách hàng · route: /customers · area: customers</div><p class="intro"><b>Concept.</b> Mục tiêu: a. Thao tác: <code>x</code>.</p><h4>Đầu trang</h4><p>Vì sao: y</p><p>Grammar: <code>Page</code></p></div></div>
</section>`

/** A gallery with five screens: a matching one, a built one with a stale shot, a drafted one with frame only, and two states of one page. */
function fixture(): { root: string; sha: (file: string) => string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "starci-gallery-"))
    const write = (file: string, text: string | Buffer): void => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), text)
    }
    const png = (name: string): Buffer => Buffer.from(`png ${name}`)
    for (const [id, route] of [["customers/list", "/customers"], ["customers/list-empty", "/customers"], ["customers/detail", "/customers/[id]"], ["inbox/today", "/inbox"]] as const) {
        const [area = ""] = id.split("/")
        write(`gallery/pages/${id}/explain.md`, EXPLAIN(id, route, area))
        write(`gallery/pages/${id}/1440.png`, png(id))
        write(`gallery/pages/${id}/390.png`, png(id))
    }
    write("gallery/pages/orphan/shot/1440.png", png("orphan"))
    write("gallery/flows.json", JSON.stringify({ onboarding: ["customers/list", "customers/list-empty"] }))
    const sha = (id: string): string => createHash("sha256").update(png(id)).digest("hex")
    write(
        ".starcistacks/canvas/design.json",
        JSON.stringify({
            areas: ["customers"],
            pages: {
                "customers/list": { status: "matches", approvedAt: "2026-11-17T09:30:00+07:00", shots: { "1440": sha("customers/list"), "390": sha("customers/list") } },
                "customers/list-empty": { status: "built", shots: { "1440": "0".repeat(64), "390": "0".repeat(64) } },
                "customers/list-loading": { status: "approved", approvedAt: "2026-11-17T09:30:00+07:00" },
                "customers/detail": { status: "approved", approvedAt: "2026-11-17T09:30:00+07:00", shots: { "1440": sha("customers/detail") } },
            },
        }),
    )
    write(".starcistacks/canvas/pages/01-customers-list.html", FRAGMENT)
    write(".starcistacks/canvas/tokens.css", ":root{--bg:#fff}")
    return { root: path.join(root, "gallery"), sha }
}

test("the state of a screen id is its longest known suffix; any other name is a page's own screen", () => {
    assert.deepEqual(splitState("customers/list-empty"), { page: "customers/list", state: "empty" })
    assert.deepEqual(splitState("customers/list-first-visit"), { page: "customers/list", state: "first-visit" })
    assert.deepEqual(splitState("customers/list-no-match"), { page: "customers/list", state: "no-match" })
    assert.deepEqual(splitState("customers/list"), { page: "customers/list", state: "base" })
    assert.deepEqual(splitState("customers/error"), { page: "customers/error", state: "base" }, "a state needs a page before it")
})

test("a status follows design.json: drafted and approved are not built, built and matches hold while the shots are the recorded ones, anything else is stale", () => {
    assert.equal(statusOf(undefined, undefined), "none")
    assert.equal(statusOf({ status: "approved" }, undefined), "notBuilt")
    assert.equal(statusOf({ status: "drafted" }, undefined), "notBuilt")
    assert.equal(statusOf({ status: "approved", shots: { "1440": "a" } }, undefined), "stale", "a shot record older than the approval")
    assert.equal(statusOf({ status: "built" }, undefined), "differs")
    assert.equal(statusOf({ status: "built" }, false), "stale")
    assert.equal(statusOf({ status: "matches" }, true), "matches")
    assert.equal(statusOf({ status: "matches" }, false), "stale")
})

test("the model joins pages, design.json and canvas frames: the tree, the dots, the counts and the states", () => {
    const { root } = fixture()
    const model = buildModel(loadGallery({ root, pages: "pages", canvas: "../.starcistacks/canvas" }).raw)
    assert.deepEqual(model.areas.map((area) => area.area), ["customers", "inbox"])
    assert.equal(model.screens["customers/list"]?.status, "matches")
    assert.equal(model.screens["customers/list-empty"]?.status, "stale", "built, but its shots are not the recorded sha")
    assert.equal(model.screens["customers/list-loading"]?.status, "notBuilt", "designed, no folder, no shot")
    assert.equal(model.screens["customers/detail"]?.status, "stale", "an approved screen that records shots")
    assert.equal(model.screens["inbox/today"]?.status, "none")
    assert.equal(model.screens["orphan/shot"], undefined, "a folder with no explain.md and no design is hidden")
    assert.deepEqual(model.counts, { total: 5, matches: 1, differs: 0, stale: 2, notBuilt: 1, hidden: 1 })
    assert.deepEqual(model.pages["customers/list"], ["customers/list", "customers/list-empty", "customers/list-loading"], "the page and its states in table order")
    assert.deepEqual(model.flows, [{ name: "onboarding", screens: ["customers/list", "customers/list-empty"] }])
    assert.equal(model.screens["customers/list"].route, "/customers")
    assert.equal(model.screens["customers/list-loading"].explain, null)
})

test("the canvas frames are served per width, and the note of a fragment is the explain.md it copies", () => {
    const { root } = fixture()
    const loaded = loadGallery({ root, pages: "pages", canvas: "../.starcistacks/canvas" })
    assert.deepEqual(loaded.frames.map((frame) => frame.file), ["customers__list__1440.html", "customers__list__390.html"])
    assert.ok(!loaded.frames[0]?.html.includes("zoom"), "the board's 50% zoom is dropped")
    assert.equal(loaded.raw.frames["customers/list"]?.heights["1440"], 900)
    const explain = parseExplain(loaded.raw.frames["customers/list"].noteMarkdown ?? "")
    assert.deepEqual(explain.meta, { title: "Khách hàng", route: "/customers", area: "customers" })
    assert.equal(explain.regions[0]?.name, "Đầu trang")
    assert.equal(explain.regions[0].fields.Grammar, "`Page`")
    assert.equal(noteToMarkdown("<p>a</p>"), "a")
})

test("a region lacking Vì sao or Grammar, or saying CHƯA RÕ, is a problem; the overview splits at its clauses", () => {
    const explain = parseExplain("## A\nVì sao: CHƯA RÕ\nGrammar: `X`\n## B\nVì sao: ok\n")
    assert.deepEqual(explain.regions[0]?.problems, [{ kind: "unclear", field: "Vì sao" }])
    assert.deepEqual(explain.regions[1]?.problems, [{ kind: "missing", field: "Grammar" }])
    assert.deepEqual(introClauses("Mục tiêu: a. Thao tác: b."), [{ label: "Mục tiêu", text: "a." }, { label: "Thao tác", text: "b." }])
    assert.deepEqual(introClauses("plain"), [{ label: null, text: "plain" }])
})

test("a dev link needs a static route", () => {
    assert.equal(devPath("/customers"), "/customers")
    assert.equal(devPath("/customers/[id]"), null)
    assert.equal(devPath(null), null)
})

test("a label is capitalized for display by the locale, diacritics included, and an empty one is left alone", () => {
    assert.equal(capitalize("agents", "en"), "Agents")
    assert.equal(capitalize("danh sách", "vi"), "Danh sách")
    assert.equal(capitalize("đăng nhập", "vi"), "Đăng nhập")
    assert.equal(capitalize("ép", "vi"), "Ép")
    assert.equal(capitalize("Đã có", "vi"), "Đã có")
    assert.equal(capitalize("", "vi"), "")
})
