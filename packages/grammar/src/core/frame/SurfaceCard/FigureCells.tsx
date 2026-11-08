"use client"

import { Link as HeroLink } from "@heroui/react"
import type { CSSProperties } from "react"
import { usePaneContext } from "../../paneContext.js"
import type { Figure } from "../../surfaceCardData.js"
import { IconTile } from "../../leaf/IconTile/index.js"
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
 * The strip a `kind="figures"` holds: two to five key figures as touching cells, divided by lines, never on the
 * outer edge. It answers its own width, not the viewport's: one row from 40rem, 2 x 2 from 18rem, one column below.
 * Inside a Pane (a `Section kind="figures"` in a pane) the strip is one bordered row: the cells stay in one row down to 20rem of the
 * strip's own width (2 x 2 below it), the value at the 2xl step so four cells fit a 380px list pane (G9c-1).
 * A real `<dl>`: the term, then the figure and its unit, then its meta as a second `<dd>` of the same term.
 */
export const FigureCells = ({ items, isLoading, isDisabled = false }: { readonly items: readonly Figure[]; readonly isLoading: boolean; readonly isDisabled?: boolean }) => {
    const pending = (value: string | number) => <SkeletonPlaceholder>{value}</SkeletonPlaceholder>
    const placement = usePaneContext() === undefined ? "card" : "pane"
    return (
        <dl
            className="starci-core-description-list"
            data-contract="HIERARCHY-3 TRUTH-1"
            data-grammar-description-layout="stat-strip"
            data-grammar-description-divided="true"
            data-grammar-figures-placement={placement}
            {...(isLoading ? { "aria-busy": true, "data-loading": "true" } : {})}
        >
            {items.map((item) => (
                <div key={item.id} className="starci-core-description-pair" style={{ "--starci-core-figure-chars": String(item.value).length } as CSSProperties} data-grammar-description-pair="true" data-grammar-figure-destination={item.href === undefined ? undefined : "true"}>
                    <dt className="starci-core-description-term starci-core-description-stat-term">
                        {item.icon === undefined ? null : <IconTile source={item.icon} size="sm" tone="neutral" />}
                        <span>{item.term}</span>
                    </dt>
                    <dd className="starci-core-description-value starci-core-description-figure" data-contract="FONT-5">
                        <span className="starci-core-description-figure-value">{isLoading ? pending(item.value) : item.value}</span>
                        {item.unit === undefined ? null : <span className="starci-core-description-unit">{item.unit}</span>}
                        {item.href === undefined || isLoading || isDisabled || item.isDisabled === true ? null : (
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
            ))}
        </dl>
    )
}
