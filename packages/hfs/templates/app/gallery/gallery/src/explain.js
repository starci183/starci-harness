// Reads one explain.md: a front matter (title, route, area) and one "## <Region>" per visible region, each with the lines
// "Vì sao:", "Luật:" and "Grammar:". A region is a bug when it lacks a Vì sao or Grammar value, or when a value starts with
// CHƯA RÕ or SAI. `starci app check` judges the same file by the same rules (HFS_APP_GALLERY_*): managed by `starci app sync`.
export const FIELDS = ["Vì sao", "Luật", "Grammar"]
const REQUIRED = ["Vì sao", "Grammar"]
const UNCLEAR = /^(?:CHƯA RÕ|SAI)(?![\p{L}\p{N}])/u
const fieldPattern = (field) => new RegExp(`^\\s*(?:[-*]\\s*)?\\*{0,2}${field}\\*{0,2}:\\*{0,2}[ \\t]*`, "iu")
const PATTERNS = FIELDS.map((field) => [field, fieldPattern(field)])

export const parseExplain = (markdown) => {
    let body = markdown.normalize("NFC").replace(/\r\n/gu, "\n")
    const meta = {}
    const front = /^---\n([\s\S]*?)\n---\n?/u.exec(body)
    if (front) {
        for (const line of front[1].split("\n")) {
            const pair = /^(\w+):\s*(.*)$/u.exec(line)
            if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/gu, "").trim()
        }
        body = body.slice(front[0].length)
    }
    const regions = []
    const intro = []
    let current = null
    let last = null
    for (const line of body.split("\n")) {
        const heading = /^##\s+(.+?)\s*$/u.exec(line)
        if (heading) {
            current = { name: heading[1], fields: {}, problems: [] }
            regions.push(current)
            last = null
            continue
        }
        if (!current) {
            intro.push(line)
            continue
        }
        const hit = PATTERNS.find(([, pattern]) => pattern.test(line))
        if (hit) {
            current.fields[hit[0]] = line.replace(hit[1], "").trim()
            last = hit[0]
        } else if (last && line.trim()) {
            current.fields[last] = `${current.fields[last] ?? ""} ${line.trim()}`.trim()
        }
    }
    for (const region of regions) {
        for (const field of FIELDS) {
            const value = region.fields[field]
            if (REQUIRED.includes(field) && !value) region.problems.push({ kind: "missing", field })
            else if (value && UNCLEAR.test(value)) region.problems.push({ kind: "unclear", field })
        }
    }
    return { meta, intro: intro.join("\n").trim(), regions }
}

// The only widths a screen is shot at; a state or an agent variant is its own screen folder.
export const SHOT_WIDTHS = ["1440", "1920", "390"]

const plain = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

// links.json of a screen: an array, or { links: [...] }, of { to: "<area>/<screen>", x, y, w, h } hotspots (fractions of the shot); null when malformed.
export const linkList = (json) => {
    const list = Array.isArray(json) ? json : plain(json) && Array.isArray(json.links) ? json.links : null
    return list && list.every((link) => plain(link) && typeof link.to === "string" && link.to) ? list : null
}

// flows.json: { "<name>": ["<area>/<screen>", ...] } or [{ name, screens }]; null when malformed.
export const flowList = (json) => {
    const entries = Array.isArray(json)
        ? json.map((flow) => (plain(flow) ? [flow.name, flow.screens] : [undefined, undefined]))
        : plain(json)
          ? Object.entries(json)
          : null
    const ok =
        entries &&
        entries.every(
            ([name, screens]) =>
                typeof name === "string" &&
                name &&
                Array.isArray(screens) &&
                screens.every((id) => typeof id === "string" && id),
        )
    return ok ? entries.map(([name, screens]) => ({ name, screens })) : null
}
