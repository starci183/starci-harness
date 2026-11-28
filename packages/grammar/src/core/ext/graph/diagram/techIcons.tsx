/**
 * The built-in tech logos of a diagram: `techIcons` maps the name a node gives with Mermaid's `R@{ icon: "redis" }` to a mark, so every app draws the same
 * logos. A mark fills with `currentColor`; the chip it stands in (`LogoChip`) sets that colour to the brand's own hex (`techIconColors`, simple-icons' `hex`)
 * when the hex keeps a 3:1 contrast against the chip in the theme in force, else leaves the node's ink (`logoInk.ts`). A mark is hidden from a screen reader
 * (the node's words name it). The brand paths and colours are vendored from simple-icons (`techIconPaths.ts`, CC0, no runtime dependency); `database` and
 * `service` are Grammar's own outline marks for a store or a program no logo names, always in the ink.
 *
 * Why simple-icons and not Iconify's `logos:` set: the full multi-colour originals would add a dependency (or vendored multi-path art under mixed
 * licences) and many of them carry their own dark ink, which vanishes on a dark node; one path per logo, one brand hex and a contrast fallback stays
 * small, CC0 and legible in light and dark alike.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react"
import { TECH_ICON_HEX, TECH_ICON_PATHS } from "./techIconPaths.js"

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

/** Each built-in logo name (aliases included) and its brand colour, `#` and six hex digits; `database` and `service` have none. */
export const techIconColors: Readonly<Record<string, string>> = {
    ...Object.fromEntries(Object.entries(TECH_ICON_HEX).map(([name, hex]) => [name, `#${hex}`])),
    ...Object.fromEntries(Object.entries(ALIASES).flatMap(([alias, name]) => (TECH_ICON_HEX[name] === undefined ? [] : [[alias, `#${TECH_ICON_HEX[name]}`]]))),
}

/**
 * The brand colour a node's icon name may take: the built-in logo's hex, unless the app's own `icons` draws that name (its own art keeps its own colours).
 */
export const brandColorOf = (name: string | undefined, icons: Readonly<Record<string, ReactNode>> | undefined): string | undefined =>
    name === undefined || icons?.[name] !== undefined ? undefined : techIconColors[name]

/**
 * A node's logo in its own small rounded chip (26px, the neutral tint of its node), the mark 18px inside it, before the node's words. `color` is the fill the
 * contrast rule chose (`logoPaint`): a brand hex, or undefined for the node's ink; `plate` turns the chip into the inverse plate (the foreground's tint) for
 * a brand colour that would vanish on the plain chip (Express black in the dark theme). Hidden from a screen reader: the node's words name it.
 */
export const LogoChip = ({ icon, color, plate = false }: { readonly icon: ReactNode; readonly color?: string | undefined; readonly plate?: boolean }): ReactElement => (
    <span
        className="starci-graph-diagram-chip starci-graph-diagram-icon"
        data-logo-fill={color === undefined ? "ink" : plate ? "plate" : "brand"}
        aria-hidden="true"
        style={color === undefined ? undefined : ({ color } satisfies CSSProperties)}
    >
        {icon}
    </span>
)

/** The names a reader knows each built-in logo by, for the brief card's "Tech" line (`techNameOf`). */
const TECH_NAMES: Readonly<Record<string, string>> = {
    postgresql: "PostgreSQL",
    mongodb: "MongoDB",
    mysql: "MySQL",
    mariadb: "MariaDB",
    redis: "Redis",
    express: "Express",
    nestjs: "NestJS",
    nodedotjs: "Node.js",
    docker: "Docker",
    kubernetes: "Kubernetes",
    rabbitmq: "RabbitMQ",
    apachekafka: "Kafka",
    nginx: "Nginx",
    graphql: "GraphQL",
    typescript: "TypeScript",
    javascript: "JavaScript",
    go: "Go",
    python: "Python",
    react: "React",
    nextdotjs: "Next.js",
    elasticsearch: "Elasticsearch",
    minio: "MinIO",
}

/**
 * The name of the technology an icon name stands for (`express` gives `Express`, the alias `kafka` gives `Kafka`); a name the Grammar does not know is
 * returned as written, and the generic `database` and `service` marks name no technology (undefined).
 */
export const techNameOf = (icon: string | undefined): string | undefined => {
    if (icon === undefined || icon === "database" || icon === "service") return undefined
    return TECH_NAMES[ALIASES[icon] ?? icon] ?? icon
}

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
