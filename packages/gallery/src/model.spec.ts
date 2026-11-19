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
import { effectiveView } from "./views.ts"
import { buildModel, devPath, splitState, statusOf } from "./model.ts"

const EXPLAIN = (title: string, route: string, area: string): string =>
    `---\ntitle: ${title}\nroute: ${route}\narea: ${area}\n---\nMục tiêu: xem khách. Thao tác: \`contacts\`.\n\n## Đầu trang\nVì sao: tên trang.\nLuật: HIERARCHY-1\nGrammar: \`Page\`\n`

const FRAGMENT = `<section class="page" id="customers-list" data-pid="customers/list" data-route="/customers" data-title="Khách hàng">
  <div class="row"><div class="frame"><div class="lbl">x · 1440</div><div class="scr w1440 zoom" style="height:900px"><div>shell</div></div></div>
  <div class="frame"><div class="scr w390"><div>phone</div></div></div>
  <div class="note"><div class="fm">title: Khách hàng · route: /customers · area: customers</div><p class="intro"><b>Concept.</b> Mục tiêu: a. Thao tác: <code>x</code>.</p><h4>Đầu trang</h4><p>Vì sao: y</p><p>Grammar: <code>Page</code></p></div></div>
</section>`

const section = (pid: string): string =>
    `<section class="page" id="${pid.replace("/", "-")}" data-pid="${pid}" data-route="/billing" data-title="Hóa đơn"><div class="frame"><div class="scr w1440" style="height:700px"><div>x</div></div></div><div class="note"><div class="fm">title: Hóa đơn · route: /billing · area: billing</div><h4>Đầu trang</h4><p>Vì sao: y</p><p>Grammar: <code>Page</code></p></div></section>`
/** A frame and a shot (no design.json entry), and a frame alone. */
const BILLING = `${section("billing/invoices")}${section("billing/plans")}`

/** A gallery with five screens: a matching one, a built one with a stale shot, a drafted one with frame only, and two states of one page. */
function fixture(): { root: string; sha: (file: string) => string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "starci-gallery-"))
    const write = (file: string, text: string | Buffer): void => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), text)
    }
    const png = (name: string): Buffer => Buffer.from(`png ${name}`)
    for (const [id, route] of [["customers/list", "/customers"], ["customers/list-empty", "/customers"], ["customers/detail", "/customers/[id]"], ["inbox/today", "/inbox"], ["billing/invoices", "/billing"]] as const) {
        const [area = ""] = id.split("/")
        write(`gallery/pages/${id}/explain.md`, EXPLAIN(id, route, area))
        write(`gallery/pages/${id}/1440.png`, png(id))
        write(`gallery/pages/${id}/390.png`, png(id))
    }
    write("gallery/pages/orphan/shot/1440.png", png("orphan"))
    write("gallery/pages/inbox/notes/explain.md", EXPLAIN("inbox/notes", "/inbox/notes", "inbox"))
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
    write(".starcistacks/canvas/pages/02-billing.html", BILLING)
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
    assert.equal(statusOf(undefined, undefined), "none", "nothing exists")
    assert.equal(statusOf(undefined, undefined, true, true), "unrecorded", "a frame and a shot with no record: coded, not recorded")
    assert.equal(statusOf(undefined, undefined, true, false), "codedOnly", "a shot with no frame")
    assert.equal(statusOf(undefined, undefined, false, true), "drawn", "a frame with no shot")
    assert.equal(statusOf({ status: "approved" }, undefined, true, true), "notBuilt", "a design.json entry is the record, whatever is on disk")
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
    assert.deepEqual(model.areas.map((area) => area.area), ["billing", "customers", "inbox"])
    assert.equal(model.screens["customers/list"]?.status, "matches")
    assert.equal(model.screens["customers/list-empty"]?.status, "stale", "built, but its shots are not the recorded sha")
    assert.equal(model.screens["customers/list-loading"]?.status, "notBuilt", "designed, no folder, no shot")
    assert.equal(model.screens["customers/detail"]?.status, "stale", "an approved screen that records shots")
    assert.equal(model.screens["inbox/today"]?.status, "codedOnly")
    assert.equal(model.screens["inbox/notes"]?.status, "none")
    assert.equal(model.screens["billing/invoices"]?.status, "unrecorded")
    assert.equal(model.screens["billing/plans"]?.status, "drawn")
    assert.equal(model.screens["orphan/shot"], undefined, "a folder with no explain.md and no design is hidden")
    assert.deepEqual(model.counts, { total: 8, matches: 1, differs: 0, stale: 2, unrecorded: 2, notCoded: 3, hidden: 1 })
    const { total, matches, differs, stale, unrecorded, notCoded } = model.counts
    assert.equal(matches + differs + stale + unrecorded + notCoded, total, "every screen is counted once")
    assert.deepEqual(model.pages["customers/list"], ["customers/list", "customers/list-empty", "customers/list-loading"], "the page and its states in table order")
    assert.deepEqual(model.flows, [{ name: "onboarding", screens: ["customers/list", "customers/list-empty"] }])
    assert.equal(model.screens["customers/list"].route, "/customers")
    assert.equal(model.screens["customers/list-loading"].explain, null)
})

test("the canvas frames are served per width, and the note of a fragment is the explain.md it copies", () => {
    const { root } = fixture()
    const loaded = loadGallery({ root, pages: "pages", canvas: "../.starcistacks/canvas" })
    assert.deepEqual(loaded.frames.map((frame) => frame.file), ["customers__list__1440.html", "customers__list__390.html", "billing__invoices__1440.html", "billing__plans__1440.html"])
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

test("a comparison needs both sides: a screen with only a design or only a shot shows that one", () => {
    assert.equal(effectiveView("diff", true, true), "diff")
    assert.equal(effectiveView("side", true, false), "design")
    assert.equal(effectiveView("onion", false, true), "shot")
    assert.equal(effectiveView("slider", false, false), "slider")
})

const LENS_KEYS = ["order", "layout", "actionable", "live", "words", "states", "truth"]
const round = (n: number, verdict: string): string => `    - n: ${String(n)}\n      at: 2026-11-19T12:00:00Z\n      lenses:\n${LENS_KEYS.map((lens) => `        ${lens}: { verdict: ${verdict}${verdict === "pass" ? "" : ", notes: da sua"} }`).join("\n")}\n`
const SCREEN_YAML = (audit: string): string =>
    `schema: 1\nscreen: agents/agent\ntitle: Một agent\nroute: /agents/[key]\narea: agents\nsummary: Trang của một agent.\ncode:\n  - features/pages/AgentProfilePage\nsections:\n  - id: header\n    title: Dải đầu trang\n    shows: Tên agent\n    why: Cần biết agent đang làm gì\n    actions: [Tạm dừng]\n    states:\n      loading: Skeleton\n      empty: null\n    needsApi: [Số liệu hôm nay]\n  - id: body\n    title: Thân\n    why: CHƯA RÕ\nconsidered:\n  - option: Gộp vào dải đầu\n    chosen: false\n    why: Quá dày\n${audit}`

test("screen.yaml is the description of a screen: sections, options and audit are read, and a legacy explain.md is read only when there is no screen.yaml", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "starci-gallery-yaml-"))
    const write = (file: string, text: string): void => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), text)
    }
    write("gallery/pages/agents/agent/screen.yaml", SCREEN_YAML(`audit:\n  builder: { agent: a }\n  auditor: { agent: b }\n  rounds:\n${round(1, "fixed")}${round(2, "pass")}  escalate: null\n`))
    write("gallery/pages/agents/agent/explain.md", EXPLAIN("ignored", "/x", "agents"))
    write("gallery/pages/agents/old/screen.yaml", SCREEN_YAML("audit: null\n").replace("agents/agent", "agents/old"))
    write("gallery/pages/agents/open/screen.yaml", SCREEN_YAML(`audit:\n  builder: { agent: a }\n  auditor: { agent: b }\n  rounds:\n${round(1, "pass")}${round(2, "open")}  escalate: null\n`))
    write("gallery/pages/agents/few/screen.yaml", SCREEN_YAML(`audit:\n  builder: { agent: a }\n  auditor: { agent: b }\n  rounds:\n${round(1, "pass")}  escalate: null\n`))
    write("gallery/pages/agents/legacy/explain.md", EXPLAIN("Cũ", "/legacy", "agents"))
    const model = buildModel(loadGallery({ root: path.join(root, "gallery"), pages: "pages", canvas: "../.starcistacks/canvas" }).raw)
    const agent = model.screens["agents/agent"]
    assert.equal(agent?.title, "Một agent", "the yaml wins over the explain.md beside it")
    assert.equal(agent.route, "/agents/[key]")
    assert.equal(agent.doc?.sections[0]?.needsApi[0], "Số liệu hôm nay")
    assert.deepEqual(agent.doc.sections[0].states, [["loading", "Skeleton"], ["empty", null]])
    assert.equal(agent.doc.considered[0]?.chosen, false)
    assert.equal(agent.doc.audit?.rounds.length, 2)
    assert.equal(agent.auditFlag, null, "two rounds and none open: the audit stands")
    assert.equal(agent.problems, 1, "the section saying CHƯA RÕ is still flagged")
    assert.equal(agent.flagged, true)
    assert.deepEqual(model.screens["agents/old"]?.auditFlag, { kind: "none", open: [] }, "audit: null is grandfathered and flagged")
    assert.equal(model.screens["agents/open"]?.auditFlag?.kind, "open")
    assert.equal(model.screens["agents/few"]?.auditFlag?.kind, "few")
    assert.equal(model.screens["agents/legacy"].doc, null, "a screen with only an explain.md is read by the older reader")
    assert.equal(model.screens["agents/legacy"].title, "Cũ")
    assert.equal(model.screens["agents/legacy"].auditFlag, null)
})
