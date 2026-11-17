// The Vite side of the gallery: an app's whole gallery is one config file, `export default defineGallery({ app, locale, allowedHosts })`. The plugin reads the pages, the
// flows and the design canvas at build and dev time, serves the shots and the canvas frames, and mounts the gallery app that this package compiles.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwind from "@tailwindcss/postcss"
import type { Plugin, UserConfig } from "vite"
import { galleryLocale } from "./labels.ts"
import { loadGallery, watchedPaths } from "./load.ts"
import type { Loaded } from "./load.ts"
import { buildModel } from "./model.ts"

export interface GalleryOptions {
    /** The app's name, shown in the title and the top bar. */
    readonly app: string
    /** The app's default locale (`vi` and `en` have a table; any other reads `en`). Default `en`. */
    readonly locale?: string
    /** The pages folder, relative to the gallery root. Default `pages`. */
    readonly pages?: string
    /** The design canvas folder, relative to the gallery root. Default `../.starcistacks/canvas`. */
    readonly canvas?: string
    /** The base URL of the dev app: a screen with a static route gets an "open on dev" link to `<devUrl><route>`. Omit when the app declares none. */
    readonly devUrl?: string
    /** The hosts the dev server answers besides localhost (the dev tunnel's gallery host). Default none. */
    readonly allowedHosts?: readonly string[]
}

const VIRTUAL_DATA = "virtual:starci-gallery/data"
const ENTRY = "/@starci-gallery/main.js"
const here = path.dirname(fileURLToPath(import.meta.url))
const MIME: Readonly<Record<string, string>> = { ".png": "image/png", ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8" }

/** The plugin: the data module, the app entry, the shots under `/__shots/` and the frames under `/__frames/`, in dev and in the build. */
export function gallery(options: GalleryOptions): Plugin {
    let root = process.cwd()
    let loaded: Loaded | null = null
    const settings = () => ({ root, pages: options.pages ?? "pages", canvas: options.canvas ?? "../.starcistacks/canvas" })
    const current = (): Loaded => (loaded ??= loadGallery(settings()))
    const shotPath = (id: string, width: string): string => path.resolve(root, settings().pages, ...id.split("/"), `${width}.png`)
    const data = (): string => {
        const { raw } = current()
        const model = buildModel(raw)
        const json = JSON.stringify({ app: options.app, locale: galleryLocale(options.locale), devUrl: options.devUrl ?? null, model }, (key, value: unknown) => (key === "noteMarkdown" ? undefined : value))
        return `export default ${json}`
    }
    const asset = (url: string): { body: Buffer | string; type: string } | null => {
        const { frames, frameCss } = current()
        const frame = /^\/__frames\/([^/]+)$/u.exec(url)?.[1]
        if (frame === "frames.css") return { body: frameCss, type: MIME[".css"] ?? "" }
        const doc = frame === undefined ? undefined : frames.find((one) => one.file === frame)
        if (doc) return { body: doc.html, type: MIME[".html"] ?? "" }
        const shot = /^\/__shots\/([^/]+)\/([^/]+)\/(1440|390)\.png$/u.exec(url)
        if (shot?.[1] !== undefined && shot[2] !== undefined && shot[3] !== undefined) {
            const file = shotPath(`${shot[1]}/${shot[2]}`, shot[3])
            return fs.existsSync(file) ? { body: fs.readFileSync(file), type: MIME[".png"] ?? "" } : null
        }
        return null
    }
    return {
        name: "starci-gallery",
        configResolved(config) {
            root = config.root
        },
        resolveId(id) {
            if (id === VIRTUAL_DATA) return `\0${VIRTUAL_DATA}`
            if (id === ENTRY) return path.join(here, "app", "main.js")
            return null
        },
        load(id) {
            return id === `\0${VIRTUAL_DATA}` ? data() : null
        },
        configureServer(server) {
            const watched = watchedPaths(settings())
            server.watcher.add(watched)
            const reload = (file: string): void => {
                if (!watched.some((one) => path.resolve(file).startsWith(one)) || file.endsWith(".png")) return
                loaded = null
                const module = server.moduleGraph.getModuleById(`\0${VIRTUAL_DATA}`)
                if (module) server.moduleGraph.invalidateModule(module)
                server.ws.send({ type: "full-reload" })
            }
            for (const event of ["add", "change", "unlink"] as const) server.watcher.on(event, reload)
            server.middlewares.use((request, response, next) => {
                const url = (request.url ?? "").split("?")[0] ?? ""
                const found = url.startsWith("/__") ? asset(decodeURIComponent(url)) : null
                if (!found) { next(); return; }
                response.setHeader("content-type", found.type)
                response.setHeader("cache-control", "no-cache")
                response.end(found.body)
            })
        },
        generateBundle() {
            const { raw, frames, frameCss } = current()
            this.emitFile({ type: "asset", fileName: "__frames/frames.css", source: frameCss })
            for (const frame of frames) this.emitFile({ type: "asset", fileName: `__frames/${frame.file}`, source: frame.html })
            for (const [id, screen] of Object.entries(raw.screens)) {
                for (const width of screen.shots) this.emitFile({ type: "asset", fileName: `__shots/${id}/${width}.png`, source: fs.readFileSync(shotPath(id, width)) })
            }
        },
    }
}

/**
 * The whole Vite config of an app's gallery: the plugin, Tailwind for the Grammar's stylesheet, and the dev server the stack expects (the IPv4 loopback, PROJECT-GALLERY-1 item 4;
 * the shots are many and copied in bulk, so the PNGs are not watched: reload the page after adding some).
 */
export function defineGallery(options: GalleryOptions): UserConfig {
    return {
        plugins: [gallery(options)],
        css: { postcss: { plugins: [tailwind()] } },
        resolve: { dedupe: ["react", "react-dom"] },
        server: {
            host: "127.0.0.1",
            allowedHosts: [...(options.allowedHosts ?? [])],
            watch: { ignored: ["**/*.png", "**/node_modules/**"], awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
        },
    }
}
