"use client"

import { Accordion } from "@heroui/react"
import { type Key, type ReactNode, useId } from "react"
import { SurfaceNesting, useSurfaceNesting } from "../../surfaceContext.js"
import { VerticalScrollRegion } from "../../composite/VerticalScrollRegion/index.js"
import { DEFAULT_SURFACE_HEADING_LEVEL, Label, type SurfaceHeadingLevel } from "../../primitive/Label/index.js"
import { surfaceLabelClassName } from "../SurfaceCard/classNames.js"
import { accordionBodyClassName, accordionCardClassName, accordionHeadingClassName, accordionPanelClassName, accordionRootClassName, accordionRowClassName, accordionScrollRegionClassName, getAccordionShellClassName, accordionTriggerClassName } from "./classNames.js"

export type SurfaceAccordionCardItem<Summary, Body> = {
    readonly id: string
    readonly isOpen: boolean
    readonly isDisabled?: boolean
    readonly summaryRender: Summary
    readonly bodyRender: Body
}

type SurfaceAccordionCardIdentityProps = {
    readonly label: string
    readonly ariaLabel?: string
} | {
    readonly label?: undefined
    readonly ariaLabel?: string
}

type SurfaceAccordionCardCommonProps<Summary, Body> = SurfaceAccordionCardIdentityProps & {
    /** Bounded surfaces derive their depth from context; unpainted disclosures inherit the enclosing surface. */
    readonly frame?: "bounded" | "unpainted"
    /**
     * Outline rank of the visible `label` (default 3). Pick the rank below the nearest heading
     * above this surface so the page never skips a level.
     */
    readonly headingLevel?: SurfaceHeadingLevel
    readonly renderSummary: (summary: Summary) => ReactNode
    readonly renderBody: (body: Body) => ReactNode
    /** Convenience capability: make the row region a HeroUI Vertical ScrollShadow. */
    readonly isScrollable?: boolean
}

export type SurfaceAccordionCardProps<Summary, Body> = SurfaceAccordionCardCommonProps<Summary, Body> & ({
    readonly items: ReadonlyArray<SurfaceAccordionCardItem<Summary, Body>>
    readonly onItemOpenChange: (id: string, isOpen: boolean) => void
    readonly isOpen?: never
    readonly isDisabled?: never
    readonly summaryRender?: never
    readonly bodyRender?: never
    readonly onOpenChange?: never
} | {
    readonly items?: never
    readonly onItemOpenChange?: never
    readonly isOpen: boolean
    readonly isDisabled?: boolean
    readonly summaryRender: Summary
    readonly bodyRender: Body
    readonly onOpenChange: (isOpen: boolean) => void
})

type SurfaceAccordionRowsProps<Summary, Body> = SurfaceAccordionCardCommonProps<Summary, Body> & {
    readonly items: ReadonlyArray<SurfaceAccordionCardItem<Summary, Body>>
    readonly onItemOpenChange: (id: string, isOpen: boolean) => void
}

const SurfaceAccordionRows = <Summary, Body>({
    label,
    ariaLabel,
    frame = "bounded",
    headingLevel = DEFAULT_SURFACE_HEADING_LEVEL,
    items,
    renderSummary,
    renderBody,
    onItemOpenChange,
    isScrollable = false,
}: SurfaceAccordionRowsProps<Summary, Body>) => {
    const bounded = frame === "bounded"
    const depth = useSurfaceNesting() ? "nested" : "top"
    const headingId = useId()
    const accessibleName = ariaLabel ?? label
    const expandedKeys = new Set(items.filter((item) => item.isOpen).map((item) => item.id))

    const onExpandedChange = (nextKeys: Set<Key>) => {
        const nextIds = new Set([...nextKeys].map(String))
        for (const item of items) {
            const nextOpen = nextIds.has(item.id)
            if (nextOpen !== item.isOpen) onItemOpenChange(item.id, nextOpen)
        }
    }

    const content = (
        <section
            className={accordionCardClassName}
            data-grammar-surface-accordion-card={bounded ? "true" : undefined}
            data-grammar-nesting={bounded ? "surface" : undefined}
            data-component="SurfaceAccordionCard"
            data-tier="branch"
        >
            {label === undefined ? null : (
                <div className={surfaceLabelClassName} data-contract="GAP-2" data-grammar-surface-label="true">
                    <Label as={`h${headingLevel}`} depth={depth} id={headingId}>{label}</Label>
                </div>
            )}
            <div
                aria-label={label === undefined ? accessibleName : undefined}
                aria-labelledby={label === undefined ? undefined : headingId}
                className={getAccordionShellClassName(bounded)}
                data-contract={[
                    bounded ? "SURFACE-2" : "SURFACE-1",
                    bounded ? "OVERFLOW-2" : "OVERFLOW-1 OVERFLOW-2",
                    bounded ? depth === "nested" ? "BOUNDARY-5" : "BOUNDARY-6" : undefined,
                ].filter(Boolean).join(" ")}
                data-grammar-accordion-shell="true"
                data-grammar-frame={frame}
                data-grammar-scroll={isScrollable ? "contained" : "page"}
                data-grammar-surface={bounded ? "true" : undefined}
                data-grammar-surface-depth={bounded ? depth : undefined}
                data-surface-context={bounded ? depth === "nested" ? "nested" : "page" : undefined}
            >
                <VerticalScrollRegion
                    className={accordionScrollRegionClassName}
                    isScrollable={isScrollable}
                    {...(isScrollable ? (label === undefined ? (accessibleName === undefined ? {} : { "aria-label": accessibleName }) : { "aria-labelledby": headingId }) : {})}
                >
                    <Accordion.Root
                        allowsMultipleExpanded
                        className={accordionRootClassName ?? ""}
                        expandedKeys={expandedKeys}
                        onExpandedChange={onExpandedChange}
                    >
                        {items.map((item) => {
                            return (
                                <Accordion.Item
                                    className={accordionRowClassName ?? ""}
                                    data-contract="BOUNDARY-3"
                                    data-grammar-accordion-row="true"
                                    data-grammar-disclosure-state={item.isOpen ? "open" : "closed"}
                                    id={item.id}
                                    {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
                                    key={item.id}
                                >
                                    <Accordion.Heading className={accordionHeadingClassName ?? ""} data-contract="MARGIN-0">
                                        <Accordion.Trigger
                                            className={accordionTriggerClassName ?? ""}
                                            data-contract="PADDING-4"
                                        >
                                            {renderSummary(item.summaryRender)}
                                        </Accordion.Trigger>
                                    </Accordion.Heading>
                                    <Accordion.Panel className={accordionPanelClassName ?? ""} data-contract="PADDING-0" role="region">
                                        {/*
                                          * The vendor's `Body` puts a className on an inner node it
                                          * owns and every other prop on the outer one, which would
                                          * split the shipped rule from the claim that promises it.
                                          * Grammar draws its own inset element instead, so the class
                                          * and the `data-contract` stay on the same box.
                                          */}
                                        <Accordion.Body>
                                            <div className={accordionBodyClassName ?? ""} data-contract="PADDING-0 PADDING-3 PADDING-4 PADDING-5 TONE-1">
                                                {renderBody(item.bodyRender)}
                                            </div>
                                        </Accordion.Body>
                                    </Accordion.Panel>
                                </Accordion.Item>
                            )
                        })}
                    </Accordion.Root>
                </VerticalScrollRegion>
            </div>
        </section>
    )
    return bounded ? <SurfaceNesting>{content}</SurfaceNesting> : content
}

/** Draw one full-width joined disclosure surface whose reusable anatomy is owned by Core Grammar. */
export const SurfaceAccordionCard = <Summary, Body>(props: SurfaceAccordionCardProps<Summary, Body>) => props.items === undefined
    ? (
        <SurfaceAccordionRows
            {...(props.label === undefined ? {} : { label: props.label })}
            {...(props.ariaLabel === undefined ? {} : { ariaLabel: props.ariaLabel })}
            {...(props.frame === undefined ? {} : { frame: props.frame })}
            {...(props.headingLevel === undefined ? {} : { headingLevel: props.headingLevel })}
            items={[{
                id: "surface-accordion-item",
                isOpen: props.isOpen,
                ...(props.isDisabled === undefined ? {} : { isDisabled: props.isDisabled }),
                summaryRender: props.summaryRender,
                bodyRender: props.bodyRender,
            }]}
            renderSummary={props.renderSummary}
            renderBody={props.renderBody}
            onItemOpenChange={(_id, isOpen) => props.onOpenChange(isOpen)}
            {...(props.isScrollable === undefined ? {} : { isScrollable: props.isScrollable })}
        />
    )
    : (
        <SurfaceAccordionRows
            {...(props.label === undefined ? {} : { label: props.label })}
            {...(props.ariaLabel === undefined ? {} : { ariaLabel: props.ariaLabel })}
            {...(props.frame === undefined ? {} : { frame: props.frame })}
            {...(props.headingLevel === undefined ? {} : { headingLevel: props.headingLevel })}
            items={props.items}
            renderSummary={props.renderSummary}
            renderBody={props.renderBody}
            onItemOpenChange={props.onItemOpenChange}
            {...(props.isScrollable === undefined ? {} : { isScrollable: props.isScrollable })}
        />
    )
