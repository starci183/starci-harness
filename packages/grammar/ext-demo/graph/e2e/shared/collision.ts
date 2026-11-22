import type { Page } from "@playwright/test"

/** The collision helpers every graph mode's spec shares: `measure` reads the page and reports every breach of the layout spec. */
export type Positions = Record<string, [number, number]>

export interface Hit {
    readonly rule: string
    readonly a: string
    readonly b: string
}

export interface Report {
    readonly hits: Hit[]
    readonly positions: Positions
}

/**
 * Measures the page and reports every breach of the layout spec (gaps are in graph units: screen pixels over the zoom of the view):
 * 1 a node within 8 of another node; 2 a label within 8 of a node, a frame border, a status chip or another label; 3 an edge through a node or a frame header, or
 * across a frame it does not start or end at; 4 an edge end (its hollow circle, its open triangle) more than 2 off its port; 5 the spine off one x centre by more
 * than 2; 6 a decision whose branches are not symmetric about it within 4; 7 a loop edge that leaves its frame; 8 more edge crossings than allowed; 9 a scroll at
 * desktop width, a first view not at 100%, or the running step (or every node) out of the view; 11 a back edge more than one card and its gutter (320) outside
 * the box of its two ends; plus text over an edge. The positions come back for rule 10, the snapshot.
 */
export const measure = (page: Page, allowed: number): Promise<Report> =>
    page.evaluate((maxCrossings) => {
        interface Box {
            l: number
            t: number
            r: number
            b: number
        }
        type Pt = readonly [number, number]
        const hits: { rule: string; a: string; b: string }[] = []
        /** Rule 11: how far a back edge may run outside the box of its two ends, in graph units: one card (280) and its gutter (40). */
        const BACK_DETOUR = 320
        const positions: Record<string, [number, number]> = {}
        const canvas = document.querySelector(".react-flow")
        if (canvas === null) return { hits, positions }
        const meta = (window as unknown as { graphStory?: { spine: string[]; decisions: { id: string; left: string; right: string }[] } }).graphStory
        const viewport = canvas.querySelector(".react-flow__viewport")
        const zoom = viewport === null ? 1 : new DOMMatrix(getComputedStyle(viewport).transform).a
        const u = (units: number): number => units * zoom
        const rect = (r: DOMRect): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })
        const grow = (b: Box, by: number): Box => ({ l: b.l - by, t: b.t - by, r: b.r + by, b: b.b + by })
        const meet = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
        const inside = (p: Pt, b: Box, pad: number): boolean => p[0] > b.l + pad && p[0] < b.r - pad && p[1] > b.t + pad && p[1] < b.b - pad
        const contains = (outer: Box, inner: Box): boolean => inner.l >= outer.l - 1 && inner.r <= outer.r + 1 && inner.t >= outer.t - 1 && inner.b <= outer.b + 1
        const near = (p: Pt, q: Pt, tol: number): boolean => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol

        const nodes = [...canvas.querySelectorAll<HTMLElement>(".react-flow__node")].map((el) => {
            const head = el.querySelector(".starci-graph-container-head")
            const id = el.dataset.id ?? ""
            const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)
            positions[id] = [Math.round(Number(m?.[1] ?? 0)), Math.round(Number(m?.[2] ?? 0))]
            return {
                el,
                id,
                box: rect(el.getBoundingClientRect()),
                frame: el.querySelector(".starci-graph-container") !== null,
                head: head === null ? null : rect(head.getBoundingClientRect()),
                diamond: el.querySelector('[data-shape="diamond"]') !== null,
                ports: el.querySelector(".starci-graph-ports") !== null || el.querySelector(".starci-graph-entity") !== null,
            }
        })
        const byId = new Map(nodes.map((node) => [node.id, node]))
        const cards = nodes.filter((node) => !node.frame)
        const frames = nodes.filter((node) => node.frame)

        const edges = [...canvas.querySelectorAll<SVGGElement>(".react-flow__edge")].map((group) => {
            const path = group.querySelector<SVGPathElement>(".react-flow__edge-path")
            const own = group.querySelector("[data-edge-source]")
            const points: Pt[] = []
            const matrix = path?.getScreenCTM()
            if (path !== null && matrix !== null && matrix !== undefined) {
                const length = path.getTotalLength()
                for (let at = 0; at < length + 3; at += 3) {
                    const p = path.getPointAtLength(Math.min(at, length)).matrixTransform(matrix)
                    points.push([p.x, p.y])
                }
            }
            const circle = group.querySelector(".starci-graph-edge-dot")
            const arrow = group.querySelector(".starci-graph-edge-arrow")
            const c = circle === null ? undefined : rect(circle.getBoundingClientRect())
            const a = arrow === null ? undefined : rect(arrow.getBoundingClientRect())
            return {
                id: group.dataset.id ?? "",
                points,
                source: own?.getAttribute("data-edge-source") ?? "",
                target: own?.getAttribute("data-edge-target") ?? "",
                back: group.classList.contains("starci-graph-edge--back"),
                dot: c === undefined ? undefined : ([(c.l + c.r) / 2, (c.t + c.b) / 2] as Pt),
                tip: a,
            }
        })

        const pills = [...canvas.querySelectorAll<HTMLElement>(".starci-graph-edge-pill")].map((el) => ({ el, box: rect(el.getBoundingClientRect()), edge: el.getAttribute("data-edge") ?? "", name: `pill:${el.textContent.slice(0, 20)}` }))
        const chips = [...canvas.querySelectorAll<HTMLElement>(".starci-graph-status")].map((el) => ({ el, box: rect(el.getBoundingClientRect()), edge: "", name: `chip:${el.textContent.slice(0, 20)}` }))
        const labels = [...pills, ...chips]

        // the zoom controls cover nothing at the first view, and text is never under 13px (at any width)
        const controls = canvas.querySelector('.starci-graph-zoom')
        const view = rect(canvas.getBoundingClientRect())
        if (controls !== null) {
            const cover = rect(controls.getBoundingClientRect())
            // At a phone's first view the spine stands clear of the buttons; a branch beside it is panned into view by hand, so only the spine and what it carries are checked there.
            const narrow = window.innerWidth < 1000
            const onSpine = new Set(meta?.spine ?? [])
            const checked = narrow && onSpine.size > 0 ? nodes.filter((node) => onSpine.has(node.id) && !node.frame) : nodes
            for (const node of checked) if (meet(cover, node.box) && meet(view, node.box)) hits.push({ rule: 'controls cover node', a: node.id, b: '' })
            for (const label of labels) if (!(narrow && onSpine.size > 0) && meet(cover, label.box) && meet(view, label.box)) hits.push({ rule: 'controls cover label', a: label.name, b: '' })
            if (narrow && onSpine.size > 0) for (const chip of chips) if (nodes.some((node) => onSpine.has(node.id) && node.el.contains(chip.el)) && meet(cover, chip.box) && meet(view, chip.box)) hits.push({ rule: 'controls cover chip', a: chip.name, b: '' })
        }
        // The words of a card are core Text roles: the name label.item (14px), the line under it label.field (13px); a Badge and the status (the core's InlineStatus in a caption line, the chip size) are the core's own sizes.
        for (const el of canvas.querySelectorAll('.starci-graph-node-text [data-component=Text]')) {
            const size = Number.parseFloat(getComputedStyle(el).fontSize)
            if (size < 13 || (el.matches('.starci-graph-node-text > :first-child') && size !== 14)) hits.push({ rule: 'text size', a: String(size), b: el.getAttribute("class") ?? el.tagName })
        }
        // the core Badges of a graph (chips, tags, ports, the words on a line) are 13px too
        for (const el of canvas.querySelectorAll('[data-component=Badge]')) {
            const size = Number.parseFloat(getComputedStyle(el).fontSize)
            if (size < 13) hits.push({ rule: 'badge text size', a: String(size), b: el.textContent.slice(0, 20) })
        }
        // a phone sees the same graph; its layout is checked once, at desktop size
        if (window.innerWidth < 1000) return { hits, positions }

        // 1
        for (let i = 0; i < nodes.length; i += 1)
            for (let j = i + 1; j < nodes.length; j += 1) {
                const a = nodes[i]
                const b = nodes[j]
                if (a === undefined || b === undefined || contains(a.box, b.box) || contains(b.box, a.box)) continue
                if (meet(grow(a.box, u(4) - 0.01), grow(b.box, u(4) - 0.01))) hits.push({ rule: "1 node gap", a: a.id, b: b.id })
            }

        // 2
        for (let i = 0; i < labels.length; i += 1)
            for (let j = i + 1; j < labels.length; j += 1) {
                const a = labels[i]
                const b = labels[j]
                if (a !== undefined && b !== undefined && meet(grow(a.box, u(4) - 0.01), grow(b.box, u(4) - 0.01))) hits.push({ rule: "2 label gap", a: a.name, b: b.name })
            }
        for (const pill of pills) {
            for (const node of cards) if (meet(grow(pill.box, u(8) - 0.01), node.box)) hits.push({ rule: "2 label near node", a: pill.name, b: node.id })
            for (const frame of frames) {
                const inner = grow(frame.box, -u(8))
                if (meet(pill.box, grow(frame.box, u(8))) && !contains(inner, pill.box)) hits.push({ rule: "2 label near frame border", a: pill.name, b: frame.id })
            }
        }
        for (const chip of chips) for (const node of cards) if (!node.el.contains(chip.el) && meet(grow(chip.box, u(8) - 0.01), node.box)) hits.push({ rule: "2 chip near node", a: chip.name, b: node.id })
        for (const label of labels)
            for (const edge of edges) if (edge.id !== label.edge && edge.points.some((p) => inside(p, label.box, 0.5))) hits.push({ rule: "text over edge", a: label.name, b: edge.id })

        for (const edge of edges) {
            // 3
            for (const node of cards) if (edge.points.some((p) => inside(p, node.box, u(4)))) hits.push({ rule: "3 edge through node", a: edge.id, b: node.id })
            for (const frame of frames) {
                const ends = edge.source === frame.id || edge.target === frame.id
                const within = edge.points.some((p) => inside(p, frame.box, u(3)))
                const without = edge.points.some((p) => !inside(p, grow(frame.box, u(3)), 0))
                if (ends ? within : within && without) hits.push({ rule: "3 edge across frame", a: edge.id, b: frame.id })
                const head = frame.head
                if (head !== null && !ends && edge.points.some((p) => inside(p, head, 1))) hits.push({ rule: "3 edge through frame header", a: edge.id, b: frame.id })
            }
            // 4: the hollow circle at the out port, the tip of the open triangle at the in port
            const s = byId.get(edge.source)
            const t = byId.get(edge.target)
            const tol = u(1)
            const dot = edge.dot
            if (s !== undefined && !s.frame && !s.ports && dot !== undefined) {
                const cx = (s.box.l + s.box.r) / 2
                const cy = (s.box.t + s.box.b) / 2
                const ports: Pt[] = edge.back ? [[s.box.l, cy], [s.box.r, cy]] : s.diamond ? [[s.box.l, cy], [s.box.r, cy], [cx, s.box.b]] : [[cx, s.box.b]]
                if (!ports.some((p) => near(dot, p, tol))) hits.push({ rule: "4 edge off its out port", a: edge.id, b: s.id })
            }
            const last = edge.points[edge.points.length - 1]
            if (t !== undefined && !t.frame && !t.ports && last !== undefined) {
                const cx = (t.box.l + t.box.r) / 2
                const cy = (t.box.t + t.box.b) / 2
                // the line ends 10 short of the port, where the open triangle starts
                const ports: Pt[] = edge.back ? [[t.box.l - u(10), cy], [t.box.r + u(10), cy]] : [[cx, t.box.t - u(10)]]
                if (!ports.some((p) => near(last, p, tol))) hits.push({ rule: "4 edge off its in port", a: edge.id, b: t.id })
            }
            // 7
            if (edge.back) {
                const a = byId.get(edge.source)
                const b = byId.get(edge.target)
                const frame = frames.find((f) => a !== undefined && b !== undefined && contains(f.box, a.box) && contains(f.box, b.box))
                if (frame !== undefined && edge.points.some((p) => !inside(p, frame.box, 0))) hits.push({ rule: "7 loop edge leaves its frame", a: edge.id, b: frame.id })
                // 11: a back edge runs near the steps it joins: no point of it lies further than one card and its gutter (280 + 40) outside the box of its two ends
                if (a !== undefined && b !== undefined && edge.points.length > 0) {
                    const span = { l: Math.min(a.box.l, b.box.l), t: Math.min(a.box.t, b.box.t), r: Math.max(a.box.r, b.box.r), b: Math.max(a.box.b, b.box.b) }
                    const xs = edge.points.map((p) => p[0])
                    const ys = edge.points.map((p) => p[1])
                    const detour = Math.max(span.l - Math.min(...xs), Math.max(...xs) - span.r, span.t - Math.min(...ys), Math.max(...ys) - span.b)
                    if (detour > u(BACK_DETOUR)) hits.push({ rule: "11 back edge detour", a: edge.id, b: `${String(Math.round(detour / zoom))} > ${String(BACK_DETOUR)}` })
                }
            }
        }

        // 5
        const centres = (meta?.spine ?? []).flatMap((id) => {
            const node = byId.get(id)
            return node === undefined ? [] : [{ id, x: (node.box.l + node.box.r) / 2 }]
        })
        if (centres.length > 1 && Math.max(...centres.map((c) => c.x)) - Math.min(...centres.map((c) => c.x)) > u(2)) hits.push({ rule: "5 spine drift", a: centres.map((c) => `${c.id}:${String(Math.round(c.x))}`).join(" "), b: "" })

        // 6
        for (const d of meta?.decisions ?? []) {
            const c = byId.get(d.id)
            const l = byId.get(d.left)
            const r = byId.get(d.right)
            if (c === undefined || l === undefined || r === undefined) continue
            const cx = (c.box.l + c.box.r) / 2
            const lx = (l.box.l + l.box.r) / 2
            const rx = (r.box.l + r.box.r) / 2
            if (!(lx < cx && cx < rx) || Math.abs(cx - lx - (rx - cx)) > u(4)) hits.push({ rule: "6 decision asymmetric", a: d.id, b: `${String(Math.round(cx - lx))} vs ${String(Math.round(rx - cx))}` })
        }

        // 8
        const cross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
            const o = (p: Pt, q: Pt, r: Pt): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
            return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
        }
        let crossings = 0
        for (let i = 0; i < edges.length; i += 1)
            for (let j = i + 1; j < edges.length; j += 1) {
                const p = edges[i]?.points ?? []
                const q = edges[j]?.points ?? []
                let found = false
                for (let a = 1; a < p.length && !found; a += 1)
                    for (let b = 1; b < q.length && !found; b += 1) {
                        const p0 = p[a - 1]
                        const p1 = p[a]
                        const q0 = q[b - 1]
                        const q1 = q[b]
                        if (p0 !== undefined && p1 !== undefined && q0 !== undefined && q1 !== undefined && cross(p0, p1, q0, q1)) found = true
                    }
                if (found) crossings += 1
            }
        if (crossings > maxCrossings) hits.push({ rule: "8 crossings", a: `${String(crossings)} > ${String(maxCrossings)}`, b: "" })

        // 9
        {
            const doc = document.documentElement
            if (doc.scrollHeight > window.innerHeight + 1 || doc.scrollWidth > window.innerWidth + 1) hits.push({ rule: "9 page scrolls", a: `${String(doc.scrollHeight)} > ${String(window.innerHeight)}`, b: "" })
            // The first view is the graph at 100% on every screen (never fitted): the running step, when there is one, stands wholly in view, and so does at least one node.
            if (Math.abs(zoom - 1) > 0.001) hits.push({ rule: "9 first view not at 100%", a: String(zoom), b: "" })
            const running = nodes.find((node) => !node.frame && node.el.querySelector('[data-status="running"]') !== null)
            if (running !== undefined && !contains(grow(view, 1), running.box)) hits.push({ rule: "9 running step out of view", a: running.id, b: "" })
            if (!nodes.some((node) => contains(grow(view, 1), node.box))) hits.push({ rule: "9 no node in view", a: "", b: "" })
        }
        return { hits, positions }
    }, allowed)

