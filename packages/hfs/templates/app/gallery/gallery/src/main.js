import { flowList, linkList, parseExplain, SHOT_WIDTHS } from "./explain.js"

const T = {{galleryLabels}}
const fill = (text, values = {}) => text.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? ""))
const images = import.meta.glob("/pages/**/*.png", { eager: true, query: "?url", import: "default" })
const texts = import.meta.glob(["/pages/**/explain.md", "/pages/**/links.json", "/flows.json"], {
    eager: true,
    query: "?raw",
    import: "default",
})

// tree[area][screen] = { images: { width: url }, explain, links }: one folder per screen, pages/<area>/<screen>/ (one agent, one state).
const tree = {}
const ensure = (area, screen) => ((tree[area] ??= {})[screen] ??= { images: {}, explain: null, links: [] })
let flows = []
for (const [path, url] of Object.entries(images)) {
    const [area, screen, file] = path.replace("/pages/", "").split("/")
    if (file) ensure(area, screen).images[file.replace(/\.png$/u, "")] = url
}
for (const [path, raw] of Object.entries(texts)) {
    if (path === "/flows.json") {
        try {
            flows = flowList(JSON.parse(raw)) ?? []
        } catch {
            flows = []
        }
        continue
    }
    const [area, screen, file] = path.replace("/pages/", "").split("/")
    if (file === "explain.md") ensure(area, screen).explain = parseExplain(raw)
    else {
        try {
            ensure(area, screen).links = linkList(JSON.parse(raw)) ?? []
        } catch {
            ensure(area, screen).links = []
        }
    }
}

// Only screens with an explain.md are shown; the gate (starci app check) fails on the others.
const shown = {}
let hidden = 0
for (const [area, screens] of Object.entries(tree)) {
    for (const [name, screen] of Object.entries(screens)) {
        if (screen.explain) (shown[area] ??= {})[name] = screen
        else hidden++
    }
}
const unclearRegions = (screen) => screen.explain.regions.filter((region) => region.problems.length).length
const isBad = (screen) => !screen.explain.regions.length || unclearRegions(screen) > 0
const areas = Object.keys(shown).sort()
const totals = { shown: 0, regions: 0, badRegions: 0, hidden }
for (const area of areas) {
    for (const screen of Object.values(shown[area])) {
        totals.shown++
        totals.regions += screen.explain.regions.length
        totals.badRegions += unclearRegions(screen)
    }
}

const state = { view: "screens", area: areas[0] ?? "", screen: null, q: "", onlyBugs: false, width: "1440" }
const app = document.querySelector("#app")
const el = (tag, attrs = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), attrs)
    node.append(...kids)
    return node
}
const badge = (text) => el("span", { className: "badge", textContent: text })
const escape = (text) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
const inline = (text) =>
    escape(text)
        .replace(/`([^`]+)`/gu, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/gu, "<b>$1</b>")
const screenOf = (id) => {
    const [area, name] = id.split("/")
    return shown[area]?.[name] ?? null
}
const thumbOf = (screen) => screen.images["1440"] ?? Object.values(screen.images)[0]
const open = (id) => {
    const [area, name] = id.split("/")
    if (!screenOf(id)) return
    state.view = "screens"
    state.area = area
    state.screen = name
    render()
}
const zoom = (url) => {
    const box = el("div", { className: "lb" }, el("img", { src: url }))
    box.onclick = () => box.remove()
    document.body.append(box)
}

const render = () => {
    app.replaceChildren()
    const side = el("aside", {}, el("h1", { textContent: document.title }))
    const tabs = el("div", { className: "seg tabs" })
    for (const [view, label] of [
        ["screens", T.screensTab],
        ["flows", T.flowsTab],
    ]) {
        const button = el("button", { className: view === state.view ? "on" : "", textContent: label })
        button.onclick = () => {
            state.view = view
            state.screen = null
            render()
        }
        tabs.append(button)
    }
    side.append(tabs)
    for (const area of areas) {
        const screens = Object.values(shown[area])
        const bad = screens.filter(isBad).length
        const button = el(
            "button",
            { className: "area" + (state.view === "screens" && area === state.area ? " on" : "") },
            area,
            el("span", { className: "chip" + (bad ? " red" : ""), textContent: `${bad}/${screens.length}` }),
        )
        button.onclick = () => {
            state.view = "screens"
            state.area = area
            state.screen = null
            render()
        }
        side.append(button)
    }
    const summary = el("div", { className: "summary" + (totals.badRegions ? "" : " ok") }, fill(T.summary, totals))
    const main = el("main", {}, summary)
    main.append(state.view === "flows" ? renderFlows() : state.screen ? renderScreen() : renderList())
    app.append(el("div", { className: "shell" }, side, main))
}

const renderList = () => {
    if (!areas.length) return el("p", { className: "empty", textContent: T.empty })
    const input = el("input", { placeholder: T.search, value: state.q })
    const check = el("input", { type: "checkbox", checked: state.onlyBugs })
    const only = el("label", { className: "only" }, check, ` ${T.onlyBugs}`)
    const cards = el("div", { className: "cards" })
    const fillCards = () => {
        cards.replaceChildren()
        const names = Object.keys(shown[state.area] ?? {})
            .sort()
            .filter(
                (name) => name.includes(state.q.toLowerCase()) && (!state.onlyBugs || isBad(shown[state.area][name])),
            )
        if (!names.length) cards.append(el("p", { className: "empty", textContent: T.noPages }))
        for (const name of names) {
            const screen = shown[state.area][name]
            const thumb = thumbOf(screen)
            const caption = el("div", { className: "cap" }, el("b", { textContent: name }))
            if (!screen.explain.regions.length) caption.append(badge(T.noRegions))
            else if (unclearRegions(screen))
                caption.append(badge(fill(T.unclearRegions, { n: unclearRegions(screen) })))
            else caption.append(el("span", { className: "ok", textContent: `✓ ${T.explained}` }))
            const card = el(
                "button",
                { className: "card" },
                thumb ? el("img", { src: thumb, loading: "lazy" }) : el("div"),
                caption,
            )
            card.onclick = () => {
                state.screen = name
                render()
            }
            cards.append(card)
        }
    }
    input.oninput = () => {
        state.q = input.value
        fillCards()
    }
    check.onchange = () => {
        state.onlyBugs = check.checked
        fillCards()
    }
    fillCards()
    return el("div", {}, el("div", { className: "bar" }, input, only), cards)
}

// A shot with its hotspots: each links.json entry is a box (fractions of the shot) that opens the screen it points at.
const shotWithLinks = (screen, url) => {
    const box = el("div", { className: "shotbox" }, el("img", { src: url }))
    for (const link of screen.links) {
        const spot = el("a", { className: "hotspot", title: fill(T.openScreen, { to: link.to }) })
        spot.style.left = `${(link.x ?? 0) * 100}%`
        spot.style.top = `${(link.y ?? 0) * 100}%`
        spot.style.width = `${(link.w ?? 0) * 100}%`
        spot.style.height = `${(link.h ?? 0) * 100}%`
        spot.onclick = (event) => {
            event.stopPropagation()
            open(link.to)
        }
        box.append(spot)
    }
    return box
}

const renderScreen = () => {
    const screen = shown[state.area][state.screen]
    const back = el("button", { className: "back", textContent: `← ${state.area}` })
    back.onclick = () => {
        state.screen = null
        render()
    }
    const widths = SHOT_WIDTHS.filter((width) => screen.images[width])
    if (!widths.includes(state.width)) state.width = widths[0] ?? ""
    const seg = el("div", { className: "seg" })
    for (const width of widths) {
        const button = el("button", { className: width === state.width ? "on" : "", textContent: width })
        button.onclick = () => {
            state.width = width
            render()
        }
        seg.append(button)
    }
    const shots = el("div", { className: "shots" })
    const url = screen.images[state.width]
    if (!url) shots.append(el("p", { className: "empty", textContent: T.noImages }))
    else {
        const figure = el(
            "figure",
            {},
            shotWithLinks(screen, url),
            el("figcaption", { textContent: `${state.area}/${state.screen} · ${state.width}` }),
        )
        figure.onclick = () => zoom(url)
        shots.append(figure)
    }
    const { meta, intro, regions } = screen.explain
    const explain = el(
        "section",
        { className: "explain" },
        el("h2", { textContent: meta.title || state.screen }),
        el("p", {
            className: "meta",
            textContent: fill(T.meta, { route: meta.route ?? "-", area: meta.area ?? state.area }),
        }),
    )
    if (intro) explain.append(el("p", { innerHTML: inline(intro) }))
    if (!regions.length) explain.append(badge(T.noRegions))
    for (const region of regions) {
        const box = el(
            "div",
            { className: "region" + (region.problems.length ? " bad" : "") },
            el("h3", { textContent: region.name }),
        )
        for (const problem of region.problems) {
            box.append(
                badge(fill(problem.kind === "missing" ? T.problemMissing : T.problemUnclear, { field: problem.field })),
            )
        }
        for (const field of ["Vì sao", "Luật", "Grammar"]) {
            if (region.fields[field]) {
                box.append(el("p", { innerHTML: `<span class="k">${field}</span> ${inline(region.fields[field])}` }))
            }
        }
        explain.append(box)
    }
    return el(
        "div",
        {},
        el("div", { className: "bar" }, back, el("h2", { textContent: state.screen }), seg),
        el("div", { className: "split" }, shots, explain),
    )
}

// The flow map: each named flow of flows.json as its ordered screens joined by arrows, then every link of every links.json as an edge.
const renderFlows = () => {
    const edges = []
    for (const area of areas) {
        for (const [name, screen] of Object.entries(shown[area])) {
            for (const link of screen.links) edges.push([`${area}/${name}`, link.to])
        }
    }
    if (!flows.length && !edges.length) return el("p", { className: "empty", textContent: T.noFlows })
    const node = (id) => {
        const screen = screenOf(id)
        const thumb = screen ? thumbOf(screen) : null
        const card = el(
            "button",
            { className: "flownode" + (screen ? "" : " missing") },
            thumb ? el("img", { src: thumb, loading: "lazy" }) : el("div"),
            el("span", { textContent: id }),
        )
        card.onclick = () => open(id)
        return card
    }
    const wrap = el("div", {})
    for (const flow of flows) {
        const row = el("div", { className: "flowrow" })
        flow.screens.forEach((id, index) => {
            if (index) row.append(el("span", { className: "arrow", textContent: "→" }))
            row.append(node(id))
        })
        wrap.append(el("section", { className: "flow" }, el("h2", { textContent: flow.name }), row))
    }
    if (edges.length) {
        const list = el("section", { className: "flow" }, el("h2", { textContent: T.linksHeading }))
        for (const [from, to] of edges) {
            const row = el(
                "div",
                { className: "flowrow" },
                node(from),
                el("span", { className: "arrow", textContent: "→" }),
                node(to),
            )
            list.append(row)
        }
        wrap.append(list)
    }
    return wrap
}
render()
