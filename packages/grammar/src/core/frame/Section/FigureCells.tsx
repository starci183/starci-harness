"use client"

import { Link as HeroLink } from "@heroui/react"
import type { CSSProperties } from "react"
import type { Figure } from "../../surfaceCardData.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import { Icon } from "../../leaf/Icon/index.js"
import { glyphSource } from "../../leaf/Icon/glyphs.js"
import { Sparkline } from "../../composite/Sparkline/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"

const TREND_WORDS = { up: "Up", down: "Down", flat: "No change" } as const
const TREND_MARKS = { up: "▲", down: "▼", flat: "–" } as const

/** Whether the change is good (success), bad (danger) or neutral, from its direction and which way is good. */
const trendTone = (item: Figure): "success" | "danger" | "neutral" => {
    if (item.trend === undefined || item.trend === "flat") return "neutral"
    const good = (item.trendSense ?? "higher-is-better") === "higher-is-better" ? "up" : "down"
    return item.trend === good ? "success" : "danger"
}

const PLACEHOLDER_FIGURES: readonly Figure[] = [1, 2, 3].map((n) => ({ id: `loading-${n}`, term: " ", value: "0000" }))

/** A figures owner with no known items uses the same three-cell loading shape. Bands keep their supplied shape. */
export const figureItems = (items: readonly Figure[], isLoading: boolean): readonly Figure[] =>
    isLoading && items.length === 0 ? PLACEHOLDER_FIGURES : items

/**
 * The strip a `Section kind="figures"` holds, drawn as a ribbon wherever it stands (the page, a pane, a drawer): two to five key figures as
 * touching cells, a `--border` hairline on its top and bottom edges, vertical hairlines between the cells, open ends, no radius and no
 * fill. It answers its own width, not the viewport's: one row from 40rem, 2 x 2 from 18rem, one column below.
 * A real `<dl>`: the term, then the figure and its unit, then its meta as a second `<dd>` of the same term.
 */
export const FigureCells = ({ items, isLoading, isDisabled = false }: { readonly items: readonly Figure[]; readonly isLoading: boolean; readonly isDisabled?: boolean }) => {
    const pending = (value: string | number) => <SkeletonPlaceholder>{value}</SkeletonPlaceholder>
    return (
        <dl
            className="starci-core-description-list"
            data-contract="HIERARCHY-3 TRUTH-1"
            data-grammar-description-layout="stat-strip"
            data-grammar-description-divided="true"
            data-grammar-figures-placement="ribbon"
            data-grammar-figure-count={items.length}
            {...(isLoading ? { "aria-busy": true, "data-loading": "true" } : {})}
        >
            {items.map((item) => {
                const follows = item.href !== undefined && !isLoading && !isDisabled && item.isDisabled !== true
                return (
                <div key={item.id} className="starci-core-description-pair" style={{ "--starci-core-figure-chars": String(item.value).length } as CSSProperties} data-grammar-description-pair="true" data-grammar-figure-destination={item.href === undefined ? undefined : "true"}>
                    <dt className="starci-core-description-term starci-core-description-stat-term">
                        {item.icon === undefined ? null : <IconTile source={item.icon} size="sm" tone="neutral" />}
                        <span>{item.term}</span>
                        {/* The pressable cue (0.48.0): a figure that leads somewhere ends its term with the quiet chevron a pressable row ends with, so a link reads as one before a hover. */}
                        {follows ? <span className="starci-core-figure-cue" data-grammar-figure-cue="true" aria-hidden="true"><Icon source={glyphSource("chevron-end")} usage="chip" /></span> : null}
                    </dt>
                    <dd className="starci-core-description-value starci-core-description-figure" data-contract="FONT-5">
                        <span className="starci-core-description-figure-value">{isLoading ? pending(item.value) : item.value}</span>
                        {item.unit === undefined ? null : <span className="starci-core-description-unit">{item.unit}</span>}
                        {!follows || item.href === undefined ? null : (
                            <HeroLink
                                aria-label={`${item.term}: ${String(item.value)}${item.unit === undefined ? "" : ` ${String(item.unit)}`}`}
                                className="starci-core-figure-link"
                                data-grammar-figure-link="true"
                                href={item.href}
                                {...(item.onFollow === undefined ? {} : { onPress: () => item.onFollow?.() })}
                            />
                        )}
                    </dd>
                    {item.meta === undefined ? null : (
                        <dd className="starci-core-description-meta" data-contract="FONT-2">
                            {item.trend === undefined || isLoading ? null : (
                                <>
                                    <span className="starci-core-description-trend" data-grammar-trend={item.trend} data-grammar-trend-tone={trendTone(item)} aria-hidden="true">{TREND_MARKS[item.trend]}</span>
                                    <span className="starci-core-visually-hidden">{item.trendLabel ?? TREND_WORDS[item.trend]}{". "}</span>
                                </>
                            )}
                            {isLoading ? pending(item.meta) : item.meta}
                        </dd>
                    )}
                    {item.trendLine === undefined ? null : (
                        <dd className="starci-core-description-trend-line">
                            <Sparkline label={item.trendLineLabel ?? item.term} values={item.trendLine} isLoading={isLoading} />
                        </dd>
                    )}
                </div>
                )
            })}
        </dl>
    )
}
