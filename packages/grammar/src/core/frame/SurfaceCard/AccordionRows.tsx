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

/** The step mark of a row: a check, the current number, a warning triangle or a grey number, in a 24px circle; decorative, the words carry the state. */
const StepMark = ({ state, position, isLoading }: { readonly state: "done" | "current" | "problem" | "todo"; readonly position: number | undefined; readonly isLoading: boolean }) => (
    <span className="starci-core-accordion-step" data-grammar-step-state={isLoading ? "todo" : state} aria-hidden="true">
        {isLoading ? null : state === "done" ? (
            <svg viewBox="0 0 20 20" focusable="false"><path d="M5 10.5 8.25 14 15 6.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
        ) : state === "problem" ? (
            <svg viewBox="0 0 20 20" focusable="false"><path d="M10 4 18 17H2L10 4Zm0 4.5v4m0 2v.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>
        ) : <span>{position}</span>}
    </span>
)

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
                            <span className="starci-core-accordion-summary" {...(item.leading === undefined ? {} : { "data-grammar-accordion-leading": "true" })}>
                                {item.leading === undefined ? null : <StepMark state={item.leading.state} position={item.leading.position} isLoading={isLoading} />}
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
