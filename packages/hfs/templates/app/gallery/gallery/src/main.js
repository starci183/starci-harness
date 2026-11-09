const T = {{galleryLabels}}
const files = import.meta.glob("/shots/**/*.png", { eager: true, query: "?url", import: "default" })
const parse = (path, url) => {
    const rel = path.replace("/shots/", "")
    const [area, ...rest] = rel.split("/")
    const name = (rest.join("/") || area).replace(/\.png$/, "")
    const [page, width = "", stage = ""] = name.split("__")
    return { area: rest.length ? area : "other", page, width, stage, url, name }
}
const shots = Object.entries(files).map(([p, u]) => parse(p, u))
const areas = [...new Set(shots.map((s) => s.area))].sort()
const state = { area: areas[0] ?? "", q: "", width: "all" }
const app = document.querySelector("#app")
const el = (tag, attrs = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), attrs)
    n.append(...kids)
    return n
}
const render = () => {
    app.replaceChildren()
    const side = el("aside", {}, el("h1", { textContent: document.title }))
    for (const a of areas) {
        const b = el(
            "button",
            { className: "area" + (a === state.area ? " on" : "") },
            a,
            el("span", { className: "chip", textContent: String(shots.filter((s) => s.area === a).length) }),
        )
        b.onclick = () => {
            state.area = a
            render()
        }
        side.append(b)
    }
    const main = el("main")
    const input = el("input", { placeholder: T.search, value: state.q })
    input.oninput = () => {
        state.q = input.value
        renderList(list)
    }
    const seg = el("div", { className: "seg" })
    for (const w of ["all", "1440", "390"]) {
        const b = el("button", { className: w === state.width ? "on" : "", textContent: w === "all" ? T.all : w })
        b.onclick = () => {
            state.width = w
            render()
        }
        seg.append(b)
    }
    const list = el("div")
    main.append(el("div", { className: "bar" }, input, seg), list)
    app.append(el("div", { className: "shell" }, side, main))
    renderList(list)
}
const renderList = (list) => {
    list.replaceChildren()
    const items = shots.filter(
        (s) =>
            s.area === state.area &&
            (state.width === "all" || s.width === state.width) &&
            s.page.toLowerCase().includes(state.q.toLowerCase()),
    )
    if (!items.length) {
        list.append(
            el("p", {
                className: "empty",
                textContent: T.empty,
            }),
        )
        return
    }
    const pages = [...new Set(items.map((s) => s.page))].sort()
    for (const p of pages) {
        const pair = el("div", { className: "pair" })
        for (const s of items
            .filter((i) => i.page === p)
            .sort((a, b) => (a.width + a.stage).localeCompare(b.width + b.stage))) {
            const img = el("img", { src: s.url, loading: "lazy", alt: s.name })
            const card = el(
                "div",
                { className: "shot" },
                img,
                el(
                    "div",
                    { className: "cap" },
                    el("b", { textContent: s.width || "-" }),
                    " · ",
                    el("span", {
                        className: s.stage,
                        textContent: s.stage === "after" ? T.after : s.stage === "before" ? T.before : s.stage,
                    }),
                ),
            )
            card.onclick = () => {
                const lb = el("div", { className: "lb" }, el("img", { src: s.url }))
                lb.onclick = () => lb.remove()
                document.body.append(lb)
            }
            pair.append(card)
        }
        list.append(el("section", { className: "page" }, el("h2", { textContent: p }), pair))
    }
}
render()
