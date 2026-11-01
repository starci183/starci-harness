"use client"

import { Accordion } from "@heroui/react"
import type { Key } from "react"
import type { AccordionData } from "../../surfaceCardData.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import {
    accordionBodyClassName,
    accordionHeadingClassName,
    accordionPanelClassName,
    accordionRootClassName,
    accordionRowClassName,
    accordionTriggerClassName,
} from "./accordionClassNames.js"

/** The disclosures a `kind="accordion"` holds: joined rows, each a title (and one muted meta) over a body. */
export const AccordionRows = ({ data, isLoading }: { readonly data: AccordionData; readonly isLoading: boolean }) => {
    const { items, onItemOpenChange } = data
    const expandedKeys = new Set(items.filter((item) => item.isOpen).map((item) => item.id))
    const onExpandedChange = (nextKeys: Set<Key>) => {
        const nextIds = new Set([...nextKeys].map(String))
        for (const item of items) {
            const nextOpen = nextIds.has(item.id)
            if (nextOpen !== item.isOpen) onItemOpenChange(item.id, nextOpen)
        }
    }
    return (
        <Accordion.Root
            allowsMultipleExpanded
            className={accordionRootClassName ?? ""}
            expandedKeys={expandedKeys}
            onExpandedChange={onExpandedChange}
            {...(isLoading ? { "aria-busy": true } : {})}
        >
            {items.map((item) => (
                <Accordion.Item
                    className={accordionRowClassName ?? ""}
                    data-contract="BOUNDARY-3"
                    data-grammar-accordion-row="true"
                    data-grammar-disclosure-state={item.isOpen ? "open" : "closed"}
                    id={item.id}
                    isDisabled={item.isDisabled === true || isLoading}
                    key={item.id}
                >
                    <Accordion.Heading className={accordionHeadingClassName ?? ""} data-contract="MARGIN-0">
                        <Accordion.Trigger className={accordionTriggerClassName ?? ""} data-contract="PADDING-4">
                            <span className="starci-core-accordion-summary">
                                <span className="starci-core-accordion-title">{isLoading ? <SkeletonPlaceholder>{item.title}</SkeletonPlaceholder> : item.title}</span>
                                {item.meta === undefined ? null : <span className="starci-core-accordion-meta" data-contract="TONE-2 FONT-2">{isLoading ? <SkeletonPlaceholder>{item.meta}</SkeletonPlaceholder> : item.meta}</span>}
                            </span>
                        </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel className={accordionPanelClassName ?? ""} data-contract="PADDING-0" role="region">
                        {/* Grammar draws its own inset element, so the shipped class and the data-contract stay on the same box. */}
                        <Accordion.Body>
                            <div className={accordionBodyClassName ?? ""} data-contract="PADDING-0 PADDING-3 PADDING-4 PADDING-5 TONE-1">
                                {item.body}
                            </div>
                        </Accordion.Body>
                    </Accordion.Panel>
                </Accordion.Item>
            ))}
        </Accordion.Root>
    )
}
