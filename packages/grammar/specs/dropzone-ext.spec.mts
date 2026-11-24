/**
 * The upload extension `@starci/grammar/core/ext/dropzone` (owner rule: apps take EVERY upload with it): each state of the zone, the
 * rows and their three glyphs, the refusal reasons in words, folder flattening with relative paths, the app's words over the English
 * defaults, the lazy load, and the boundary (core never imports the extension; react-dropzone only inside it, an optional peer).
 *
 *   node --import ./specs/support/register.mts --test specs/dropzone-ext.spec.mts
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
    DEFAULT_DROPZONE_LABELS,
    Dropzone,
    acceptedTypesOf,
    fileKindOf,
    flattenEntries,
    formatBytes,
    rejectionsOf,
    relativePathOf,
    resolveDropzoneLabels,
    type DropEntry,
    type DropzoneItem,
    type DropzoneLabels,
} from "../src/core/ext/dropzone/index.ts"
import { DropzoneView, type DropzoneViewProps } from "../src/core/ext/dropzone/DropzoneView.tsx"
import DropzoneZone from "../src/core/ext/dropzone/DropzoneZone.tsx"
import { draggedCountOf, filesFromEvent, toDropzoneFiles } from "../src/core/ext/dropzone/files.ts"

const src = fileURLToPath(new URL("../src/", import.meta.url))
const ext = join(src, "core", "ext", "dropzone")
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|css)$/.test(name) ? [path] : []
    })
const rel = (path: string): string => relative(src, path).replaceAll("\\", "/")

const view = (overrides: Partial<DropzoneViewProps> = {}): string =>
    renderToStaticMarkup(createElement(DropzoneView, {
        phase: "idle",
        labels: DEFAULT_DROPZONE_LABELS,
        target: "Reports",
        acceptedTypes: ["PNG", "PDF"],
        limits: { maxSize: "10 MB", maxFiles: 5 },
        draggedCount: 0,
        rejections: [],
        items: [],
        folders: true,
        isDisabled: false,
        onRetry: undefined,
        onChooseFiles: () => undefined,
        onChooseFolder: () => undefined,
        ...overrides,
    }))

const zoneOf = (html: string): string => /<div[^>]*data-grammar-dropzone-state="[^"]*"[^>]*>/.exec(html)?.[0] ?? ""
const announced = (html: string): string => /data-grammar-dropzone-announce="true">([^<]*)</.exec(html)?.[1] ?? ""

test("idle: a dashed zone named by its title, the 24px cloud icon, the accepted-types line and the border-look choose buttons", () => {
    const html = view()
    const zone = zoneOf(html)
    assert.match(zone, /data-grammar-dropzone-state="idle"/)
    assert.match(zone, /role="group"/)
    assert.match(zone, /aria-labelledby="[^"]+-title"/)
    assert.match(html, /data-usage="control"/, "the cloud icon is the control usage")
    assert.match(html, /Drag and drop files or folders here/)
    assert.match(html, /PNG, PDF, up to 10 MB each/)
    assert.match(html, /<button[^>]*button--outline[^>]*>[^]*?Choose files/, "the picker is the outline (border) look, never the primary")
    assert.match(html, /Choose folder/)
    assert.doesNotMatch(html, /button--primary/)
    assert.equal(announced(html), "")
    assert.equal(view({ folders: false }).includes("Choose folder"), false)
})

test("drag-over: the info soft state, the drop title with the target and the dragged count, announced, with no buttons", () => {
    const html = view({ phase: "over", draggedCount: 3 })
    assert.match(zoneOf(html), /data-grammar-dropzone-state="over"/)
    assert.match(html, /Drop to upload to Reports/)
    assert.match(html, /3 items/)
    assert.doesNotMatch(html, /Choose files/)
    assert.equal(announced(html), "Drop to upload to Reports. 3 items")
    assert.match(view({ phase: "over", draggedCount: 1, target: undefined }), /Drop to upload<\/div>[^]*1 item</)
})

test("rejected: the danger soft state says each reason in words, and the pickers stay to try again", () => {
    const html = view({ phase: "rejected", rejections: [{ reason: "too-large", count: 2 }, { reason: "wrong-type", count: 1 }] })
    assert.match(zoneOf(html), /data-grammar-dropzone-state="rejected"/)
    assert.match(html, /Some files were not added/)
    assert.match(html, /2 files are too big: the limit is 10 MB\./)
    assert.match(html, /1 file is not a type this accepts\./)
    assert.match(html, /Choose files/)
    assert.match(announced(html), /^Some files were not added 2 files are too big/)
    assert.match(view({ phase: "rejected", rejections: [{ reason: "too-many", count: 7 }] }), /Too many files \(7\): up to 5 at a time\./)
    assert.match(view({ phase: "rejected", rejections: [{ reason: "too-many", count: 2 }], limits: { maxSize: undefined, maxFiles: 1 } }), /one at a time/)
})

test("rejection reasons: too many refuses the whole drop alone; otherwise each file counts once under its first reason", () => {
    assert.deepEqual(rejectionsOf([]), [])
    assert.deepEqual(rejectionsOf([{ errors: [{ code: "too-many-files" }] }, { errors: [{ code: "too-many-files" }, { code: "file-too-large" }] }]), [{ reason: "too-many", count: 2 }])
    assert.deepEqual(
        rejectionsOf([{ errors: [{ code: "file-invalid-type" }] }, { errors: [{ code: "file-too-large" }, { code: "file-invalid-type" }] }, { errors: [{ code: "file-too-large" }] }]),
        [{ reason: "too-large", count: 2 }, { reason: "wrong-type", count: 1 }],
    )
    assert.deepEqual(rejectionsOf([{ errors: [{ code: "something-new" }] }]), [{ reason: "wrong-type", count: 1 }])
})

const items: readonly DropzoneItem[] = [
    { id: "a", name: "photos/a.jpg", status: "done" },
    { id: "b", name: "report.pdf", type: "application/pdf", status: "uploading", progress: 42.4 },
    { id: "c", name: "notes.txt", status: "waiting" },
    { id: "d", name: "big.zip", status: "error", progress: 70 },
]

test("rows: a 20px file-type icon (beside text, the icon size table), the name, a success Progress (running is success, owner 2026-11-24), and an inline status of the three glyphs (the circle spins while uploading)", () => {
    const html = view({ items, onRetry: () => undefined })
    const rows = html.split('<li class="starci-core-dropzone-row"').slice(1)
    assert.equal(rows.length, 4)
    for (const row of rows) {
        assert.match(row, /data-usage="control"/)
        assert.match(row, /data-grammar-progress-tone="success"/)
        assert.match(row, /<span class="starci-type-caption[^"]*"|data-role="caption"/, "the status sits in a 12px caption line, so its glyph is 12px (text-sized)")
    }
    assert.match(rows[0] ?? "", /data-grammar-status-glyph="done"[^]*Done/)
    assert.match(rows[0] ?? "", /aria-valuenow="100"/)
    assert.match(rows[1] ?? "", /data-grammar-status-glyph="running"[^]*42%/)
    assert.match(rows[1] ?? "", /aria-valuenow="42"/)
    assert.match(rows[2] ?? "", /data-grammar-status-glyph="waiting"[^]*Waiting/)
    assert.match(rows[3] ?? "", /data-grammar-status-glyph="error"[^]*Failed[^]*Retry/)
    assert.doesNotMatch(rows.slice(0, 3).join(""), /Retry/)
    assert.doesNotMatch(view({ items }), /Retry/, "no retry without onRetry")
    assert.match(html, /<ul class="starci-core-dropzone-list" aria-label="Uploads">/)
    assert.equal(announced(html), "1 done, 1 uploading, 1 waiting, 1 failed")
})

test("file kinds pick the row icon from the MIME type, else the extension", () => {
    assert.equal(fileKindOf("a.JPG"), "image")
    assert.equal(fileKindOf("clip", "video/mp4"), "video")
    assert.equal(fileKindOf("x.pdf"), "pdf")
    assert.equal(fileKindOf("sheet.xlsx"), "sheet")
    assert.equal(fileKindOf("bundle.tar.gz"), "archive")
    assert.equal(fileKindOf("README"), "file")
})

test("labels: every word comes from labels; the app's words win and the rest keep the English default", () => {
    const vi: Partial<DropzoneLabels> = {
        title: "Kéo thả tệp hoặc thư mục vào đây",
        chooseFiles: "Chọn tệp",
        chooseFolder: "Chọn thư mục",
        acceptedTypes: (types, maxSize) => `${types.join(", ")}, tối đa ${maxSize ?? ""}`,
        dropTo: (target) => `Thả để tải lên ${target ?? ""}`,
        dragged: (count) => `${count} mục`,
        done: "Xong",
        waiting: "Chờ",
        error: "Lỗi",
        retry: "Thử lại",
    }
    const labels = resolveDropzoneLabels(vi)
    assert.equal(labels.rejectedTitle, DEFAULT_DROPZONE_LABELS.rejectedTitle)
    const idle = view({ labels })
    assert.match(idle, /Kéo thả tệp hoặc thư mục vào đây/)
    assert.match(idle, /PNG, PDF, tối đa 10 MB/)
    assert.match(idle, /Chọn tệp/)
    assert.match(idle, /Chọn thư mục/)
    assert.match(view({ labels, phase: "over", draggedCount: 2 }), /Thả để tải lên Reports[^]*2 mục/)
    const rows = view({ labels, items, onRetry: () => undefined })
    for (const word of ["Xong", "Chờ", "Lỗi", "Thử lại", "42%"]) assert.match(rows, new RegExp(word))
    assert.deepEqual(resolveDropzoneLabels(undefined), { ...DEFAULT_DROPZONE_LABELS })
})

/** A fake entry of the drag-and-drop entries API: a folder hands out its children in batches of two, as Chromium does in batches. */
const fileEntry = (fullPath: string): DropEntry => {
    const name = fullPath.split("/").at(-1) ?? fullPath
    return { isFile: true, isDirectory: false, name, fullPath, file: (success) => success(new File(["x"], name, { type: "text/plain" })) }
}
const folderEntry = (fullPath: string, children: readonly DropEntry[]): DropEntry => {
    let offset = 0
    return {
        isFile: false,
        isDirectory: true,
        name: fullPath.split("/").at(-1) ?? fullPath,
        fullPath,
        createReader: () => ({ readEntries: (success) => { const batch = children.slice(offset, offset + 2); offset += 2; success(batch) } }),
    }
}

test("folders: a dragged folder flattens into its files, depth first, each with its path relative to what was dropped", async () => {
    const dropped = [
        folderEntry("/album", [fileEntry("/album/a.jpg"), folderEntry("/album/2026", [fileEntry("/album/2026/b.jpg"), fileEntry("/album/2026/c.jpg"), fileEntry("/album/2026/d.jpg")]), fileEntry("/album/e.jpg")]),
        fileEntry("/loose.txt"),
    ]
    const files = await flattenEntries(dropped)
    assert.deepEqual(files.map(relativePathOf), ["album/a.jpg", "album/2026/b.jpg", "album/2026/c.jpg", "album/2026/d.jpg", "album/e.jpg", "loose.txt"])
    assert.deepEqual(toDropzoneFiles(files).map(({ path, file }) => [path, file.name]).at(1), ["album/2026/b.jpg", "b.jpg"])
})

test("events: a drop walks its folders, a drag before the drop only counts, a picked folder keeps webkitRelativePath", async () => {
    const item = (entry: DropEntry) => ({ kind: "file", type: "", webkitGetAsEntry: () => entry })
    const loose = new File(["y"], "plain.png", { type: "image/png" })
    const drop = { type: "drop", dataTransfer: { items: [item(folderEntry("/docs", [fileEntry("/docs/x.md")])), { kind: "file", type: "image/png", getAsFile: () => loose }, { kind: "string", type: "text/plain" }] } }
    const dropped = (await filesFromEvent(drop)) as File[]
    assert.deepEqual(dropped.map(relativePathOf), ["docs/x.md", "plain.png"])
    const enter = { type: "dragenter", dataTransfer: { items: [{ kind: "file", type: "image/png" }, { kind: "file", type: "" }, { kind: "string", type: "text/plain" }] } }
    assert.equal((await filesFromEvent(enter)).length, 2)
    assert.equal(draggedCountOf(enter), 2)
    assert.equal(draggedCountOf({}), 0)
    const picked = new File(["z"], "c.jpg")
    Object.defineProperty(picked, "webkitRelativePath", { value: "trip/day1/c.jpg" })
    const change = { type: "change", target: { files: [picked, new File(["w"], "solo.txt")] } }
    assert.deepEqual(((await filesFromEvent(change)) as File[]).map(relativePathOf), ["trip/day1/c.jpg", "solo.txt"])
})

test("sizes and types read as people read them", () => {
    assert.equal(formatBytes(900), "900 B")
    assert.equal(formatBytes(10 * 1024 * 1024), "10 MB")
    assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GB")
    assert.deepEqual(acceptedTypesOf({ "image/*": [".png", ".jpg"], "application/pdf": [".pdf"] }), ["PNG", "JPG", "PDF"])
    assert.deepEqual(acceptedTypesOf({ "image/*": [] }), ["image"])
    assert.deepEqual(acceptedTypesOf(undefined), [])
    assert.equal(DEFAULT_DROPZONE_LABELS.acceptedTypes([], undefined), "Any file")
})

test("react-dropzone loads lazily: the page renders the Skeleton of the zone until it arrives, and isLoading is the same Skeleton", () => {
    const lazyHtml = renderToStaticMarkup(createElement(Dropzone, { onFiles: () => undefined, items }))
    assert.match(lazyHtml, /data-component="Dropzone" data-loading="true"/)
    assert.match(lazyHtml, /data-component="Skeleton"/)
    assert.equal(lazyHtml.split('class="starci-core-dropzone-row"').length - 1, 4, "the rows keep their count as skeletons")
    const loading = renderToStaticMarkup(createElement(Dropzone, { onFiles: () => undefined, isLoading: true }))
    assert.match(loading, /aria-busy="true"/)
    assert.doesNotMatch(loading, /Drag and drop/, "loading is all skeleton: no real words")
})

test("the live zone: react-dropzone's tab stop and hidden input on the Grammar drawing (Enter or Space opens the picker)", () => {
    const html = renderToStaticMarkup(createElement(DropzoneZone, { onFiles: () => undefined, accept: { "image/png": [".png"] }, maxSize: 1024 * 1024, target: "Reports" }))
    const zone = zoneOf(html)
    assert.match(zone, /tabindex="0"/)
    assert.match(zone, /role="group"/)
    assert.match(html, /<input[^>]*type="file"[^>]*data-grammar-dropzone-input="true"/)
    assert.match(html, /accept="image\/png,\.png"/)
    assert.match(html, /PNG, up to 1 MB each/)
    const single = renderToStaticMarkup(createElement(DropzoneZone, { onFiles: () => undefined, multiple: false }))
    assert.doesNotMatch(single, /Choose folder/, "one file at a time offers no folder picker")
    assert.doesNotMatch(zoneOf(renderToStaticMarkup(createElement(DropzoneZone, { onFiles: () => undefined, isDisabled: true }))), /tabindex="0"/)
})

test("core never imports the extension, react-dropzone is imported only inside it, and it is an optional peer", () => {
    for (const file of walk(src)) {
        if (file.startsWith(ext) || /[\\/]stories[\\/]/.test(file)) continue
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /from\s+["'][^"']*ext\/dropzone|import\s*\(\s*["'][^"']*ext\/dropzone/, `${rel(file)} imports the upload extension`)
        assert.doesNotMatch(text, /from\s+["']react-dropzone(?:\/[^"']*)?["']|import\s*\(\s*["']react-dropzone/, `${rel(file)} imports react-dropzone`)
    }
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, Record<string, unknown>>
    assert.equal(manifest["peerDependencies"]?.["react-dropzone"], "15.0.0")
    assert.deepEqual(manifest["peerDependenciesMeta"]?.["react-dropzone"], { optional: true })
    assert.equal(manifest["dependencies"]?.["react-dropzone"], undefined)
    assert.ok(manifest["exports"]?.["./core/ext/dropzone"], "the ./core/ext/dropzone subpath is exported")
    const zone = readFileSync(join(ext, "Dropzone.tsx"), "utf8")
    assert.match(zone, /lazy\(\(\) => import\("\.\/DropzoneZone\.js"\)\)/)
    assert.doesNotMatch(zone, /from\s+["']react-dropzone/, "the entry the page loads does not import react-dropzone")
})

test("no source of the extension holds a hex colour, a colour function or a shadow", () => {
    for (const file of [...walk(ext), join(src, "common", "components-dropzone.css")]) {
        const text = readFileSync(file, "utf8")
        assert.doesNotMatch(text, /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/, `${rel(file)} holds a hex colour`)
        assert.doesNotMatch(text, /(?:^|[^\w-])(?:rgba?|hsla?|oklch|oklab)\(/, `${rel(file)} holds a colour function`)
        assert.doesNotMatch(text, /box-shadow:\s*(?!none\b)[^\s;]/, `${rel(file)} draws a shadow`)
    }
})

test("the lint keeps react-dropzone inside src/core/ext/dropzone and recharts inside src/core/ext/recharts", async () => {
    const { libraryProblem } = await import("../scripts/lint/eslint-plugin.mts")
    assert.equal(libraryProblem("src/core/ext/dropzone/DropzoneZone.tsx", "react-dropzone"), null)
    assert.match(libraryProblem("src/core/leaf/Button/index.tsx", "react-dropzone") ?? "", /only src\/core\/ext\/dropzone imports it/)
    assert.match(libraryProblem("src/core/ext/recharts/BarChart.tsx", "react-dropzone") ?? "", /src\/core\/ext\/dropzone/)
    assert.match(libraryProblem("src/core/ext/dropzone/DropzoneZone.tsx", "recharts") ?? "", /only src\/core\/ext\/recharts imports it/)
    assert.equal(libraryProblem("src/core/leaf/Button/index.tsx", "react-dropzone-uploader"), null)
})
