/**
 * The built-in tech logos of a diagram: `techIcons` maps the name a node gives with Mermaid's `R@{ icon: "redis" }` to a monochrome mark, so every app draws
 * the same logos. A mark fills with `currentColor` (the node's ink, never a brand colour), is hidden from a screen reader (the node's words name it) and fills
 * the one-line box `.starci-graph-diagram-icon` gives it. The brand paths are vendored from simple-icons (`techIconPaths.ts`); `database` and `service` are
 * Grammar's own outline marks for a store or a program no logo names.
 */
import type { ReactElement, ReactNode } from "react"
import { TECH_ICON_PATHS } from "./techIconPaths.js"

const brand = (path: string): ReactElement => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={path} />
    </svg>
)

const outline = (children: ReactNode): ReactElement => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {children}
    </svg>
)

/** Other names a technology goes by, each drawing the logo of its canonical name. */
const ALIASES: Readonly<Record<string, string>> = {
    postgres: "postgresql",
    pg: "postgresql",
    mongo: "mongodb",
    nodejs: "nodedotjs",
    node: "nodedotjs",
    kafka: "apachekafka",
    k8s: "kubernetes",
    nextjs: "nextdotjs",
    next: "nextdotjs",
    golang: "go",
    nest: "nestjs",
    elastic: "elasticsearch",
    ts: "typescript",
    js: "javascript",
}

const BRANDS: Readonly<Record<string, ReactElement>> = Object.fromEntries(Object.entries(TECH_ICON_PATHS).map(([name, path]) => [name, brand(path)]))

/**
 * The icon names a node may use and what each draws: the simple-icons logos (`postgresql`, `mongodb`, `mysql`, `redis`, `express`, `nestjs`, `nodedotjs`,
 * `docker`, `kubernetes`, `rabbitmq`, `apachekafka`, `nginx`, `graphql`, `typescript`, `javascript`, `go`, `python`, `react`, `nextdotjs`, `elasticsearch`,
 * `minio`), a few aliases (`postgres`, `nodejs`, `kafka`, `k8s`, ...) and the generic `database` and `service`. `MermaidDiagram` uses it for every name
 * its `icons` prop does not give.
 */
export const techIcons: Readonly<Record<string, ReactNode>> = {
    ...BRANDS,
    ...Object.fromEntries(Object.entries(ALIASES).flatMap(([alias, name]) => (BRANDS[name] === undefined ? [] : [[alias, BRANDS[name]]]))),
    database: outline(
        <>
            <ellipse cx={12} cy={5.5} rx={7.5} ry={2.8} />
            <path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-13" />
            <path d="M4.5 12c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8" />
        </>,
    ),
    service: outline(
        <>
            <rect x={3.5} y={4} width={17} height={6.5} rx={1.5} />
            <rect x={3.5} y={13.5} width={17} height={6.5} rx={1.5} />
            <path d="M7 7.25h.01M7 16.75h.01" />
        </>,
    ),
}

/** The icons a diagram draws: the built-in logos with the app's own on top, which win over a built-in of the same name. */
export const withTechIcons = (icons: Readonly<Record<string, ReactNode>> | undefined): Readonly<Record<string, ReactNode>> => ({ ...techIcons, ...icons })
