/**
 * The built-in info tone (Grammar 0.55.0, owner 2026-11-22: "Thêm info mà? Mặc định có info chứ? Là màu xanh, tất cả grammar kế thừa đều có info"):
 * a blue pair every family inherits, with AA contrast in both themes. RUNNING is no longer info: it is success (owner 2026-11-24, "Xanh lá toàn app").
 *
 *   node --import ./specs/support/register.mts --test specs/info-tone.spec.mts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { MARK_STATE_TONE } from "../src/core/statusMark.tsx"
import { contrast, oklchToLab, type Lab } from "./support/color.mts"

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
const css = read("common/tones-info.css")

/** The token values of the light (`:root`) and the dark (`.dark`) block of the info sheet. */
const block = (selector: RegExp): Record<string, Lab> => {
    const body = selector.exec(css)?.[1] ?? ""
    return Object.fromEntries([...body.matchAll(/(--info[a-z-]*): oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\);/gu)].map((match) => [match[1] ?? "", oklchToLab(Number(match[2]) / 100, Number(match[3]), Number(match[4]))]))
}

test("Grammar ships the four info tokens in light and dark, in the lowest layer, from the Common sheet every family imports", () => {
    assert.match(read("common/styles.css"), /@import "\.\/tones-info\.css";/)
    assert.match(css, /@layer starci-grammar-theme \{/)
    for (const theme of [block(/:root,[^{]*\{([^}]*)\}/u), block(/\.dark,[^{]*\{([^}]*)\}/u)]) {
        assert.deepEqual(Object.keys(theme).sort(), ["--info", "--info-foreground", "--info-soft", "--info-soft-foreground"])
    }
})

test("info is blue and keeps AA: the foreground on info and the soft foreground on soft reach 4.5:1 in both themes", () => {
    for (const [name, theme] of [["light", block(/:root,[^{]*\{([^}]*)\}/u)], ["dark", block(/\.dark,[^{]*\{([^}]*)\}/u)]] as const) {
        const on = contrast(theme["--info"] as Lab, theme["--info-foreground"] as Lab)
        const soft = contrast(theme["--info-soft"] as Lab, theme["--info-soft-foreground"] as Lab)
        assert.ok(on >= 4.5, `${name}: foreground on info is ${on.toFixed(2)}:1`)
        assert.ok(soft >= 4.5, `${name}: soft foreground on soft is ${soft.toFixed(2)}:1`)
        const [, a, b] = theme["--info"] as Lab
        const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
        assert.ok(hue >= 220 && hue <= 270, `${name}: info is blue (hue ${hue.toFixed(0)})`)
    }
})

test("running is success, never info nor the accent (owner 2026-11-24): the status-mark tone of running and the running ring read --success", () => {
    assert.equal(MARK_STATE_TONE.running, "success")
    assert.match(read("common/styles.css"), /\.starci-core-icon-tile-ring \{[^}]*border-block-start-color: var\(--success\)/u)
    assert.match(read("common/styles.css"), /\.starci-core-icon-tile\[data-tone="info"\]\[data-artwork="false"\]\[data-loading="false"\] \{\s*background: var\(--info-soft\);\s*color: var\(--info-soft-foreground\);/u)
})

test("every tone union of Grammar takes info", () => {
    const unions: ReadonlyArray<readonly [string, RegExp]> = [
        ["core/leaf/IconTile/index.tsx", /IconTileBuiltInTone = [^\n]*"info"/u],
        ["core/leaf/Badge/index.tsx", /BadgeBuiltInTone = [^\n]*"info"/u],
        ["core/leaf/StatusDot/index.tsx", /StatusDotBuiltInTone = [^\n]*"info"/u],
        ["core/leaf/Progress/index.tsx", /ProgressTone = [^\n]*"info"/u],
        ["core/composite/Legend/index.tsx", /LegendTone = [^\n]*"info"/u],
        ["core/composite/FunnelChart/index.tsx", /FunnelChartTone = [^\n]*"info"/u],
        ["core/composite/IntervalChart/index.tsx", /IntervalChartTone = [^\n]*"info"/u],
        ["core/composite/ProportionBar/index.tsx", /ProportionBarTone = [^\n]*"info"/u],
        ["core/frame/ScheduleGrid/index.tsx", /ScheduleTone = [^\n]*"info"/u],
        ["core/branch/DragItem/index.tsx", /DragItemTone = [^\n]*"info"/u],
        ["core/navigationBadgeTone.ts", /NavigationBadgeTone = [^\n]*"info"/u],
        ["core/surfaceCardData.ts", /RowEdgeTone = [^\n]*"info"/u],
    ]
    for (const [file, union] of unions) assert.match(read(file), union, file)
})
