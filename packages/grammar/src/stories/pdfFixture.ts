/**
 * A tiny PDF built in code for the PdfViewer stories (no file, no copyrighted content): two US Letter pages of plain Helvetica text and
 * a ruled box, the words generic. `fixtureText` lists each page's runs in drawing order, so a story can point a text highlight at them.
 */
type Run = { readonly text: string; readonly size: number; readonly x: number; readonly y: number }

const PAGES: readonly (readonly Run[])[] = [
    [
        { text: "Sample document", size: 24, x: 72, y: 700 },
        { text: "Page one of a generated fixture.", size: 12, x: 72, y: 660 },
        { text: "Item A ............ 120", size: 12, x: 72, y: 620 },
        { text: "Item B ............ 380", size: 12, x: 72, y: 600 },
        { text: "Total ............. 500", size: 14, x: 72, y: 560 },
        { text: "Prepared for the Grammar story.", size: 10, x: 72, y: 120 },
    ],
    [
        { text: "Second page", size: 24, x: 72, y: 700 },
        { text: "Terms: payment within 14 days.", size: 12, x: 72, y: 660 },
        { text: "Notes: nothing here is real.", size: 12, x: 72, y: 640 },
    ],
]

/** The text of each page as `pageTextOf` joins pdfjs's runs (each run its own line here). */
export const fixtureText: readonly string[] = PAGES.map((runs) => runs.map((run) => `${run.text}\n`).join(""))

const escape = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")

const contentOf = (runs: readonly Run[], index: number): string => {
    const text = runs.map((run) => `BT /F1 ${run.size} Tf ${run.x} ${run.y} Td (${escape(run.text)}) Tj ET`).join("\n")
    const box = index === 0 ? "\n0.6 G 1 w 66 548 300 36 re S" : ""
    return `${text}${box}`
}

/** The PDF's bytes: a catalog, a page tree, the pages, one font, one content stream per page, and a correct xref table. */
export const buildFixturePdf = (): Uint8Array => {
    const objects: string[] = []
    const pageIds = PAGES.map((_, index) => 4 + index * 2)
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${PAGES.length} >>`
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    PAGES.forEach((runs, index) => {
        const id = pageIds[index] ?? 0
        const stream = contentOf(runs, index)
        objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
        objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    })
    let body = "%PDF-1.4\n"
    const offsets: number[] = []
    for (let id = 1; id < objects.length; id += 1) {
        offsets[id] = body.length
        body += `${id} 0 obj\n${objects[id] ?? ""}\nendobj\n`
    }
    const xref = body.length
    body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
    for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`
    body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return new TextEncoder().encode(body)
}
