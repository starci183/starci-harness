"use client"

import { useId, useState } from "react"
import { Tabs } from "../../branch/Tabs/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Link } from "../../leaf/Link/index.js"
import { Select } from "../../branch/Select/index.js"
import { SearchField } from "../../leaf/SearchField/index.js"
import { TextAction } from "../../leaf/TextAction/index.js"
import { Pagination } from "../../composite/Pagination/index.js"
import type { FilterFields, FooterZone, HeaderZone, SearchFields, SearchZoneFields, SelectZoneField, SwitchFields } from "../../surfaceCardData.js"
import { CustomZoneScope, TabsLineHost } from "../../zoneContext.js"
import { FigureCells, figureItems } from "./FigureCells.js"
import {
    surfaceZoneClassName,
    surfaceZoneRowClassName,
    surfaceZoneSearchOpenClassName,
    surfaceZoneSearchToggleClassName,
    surfaceZoneSearchWideClassName,
} from "./classNames.js"

/** The filter tabs of a zone: `Tabs kind="filter"` whose line is the zone's divider (the zone is a `TabsLineHost`). */
const FilterTabs = ({ filter }: { readonly filter: FilterFields }) => (
    <Tabs
        kind="filter"
        label={filter.label}
        items={filter.items}
        selectedKey={filter.selectedKey}
        onSelect={filter.onSelect}
        {...(filter.moreLabel === undefined ? {} : { moreLabel: filter.moreLabel })}
        {...(filter.overflowLabel === undefined ? {} : { overflowLabel: filter.overflowLabel })}
    />
)

const ZoneSearch = ({ search, isCompact, autoFocus = false }: { readonly search: SearchFields; readonly isCompact: boolean; readonly autoFocus?: boolean }) => (
    <SearchField
        label={search.label}
        isLabelHidden
        size="sm"
        measure={isCompact ? "compact" : "fill"}
        value={search.value}
        onValueChange={search.onChange}
        onClear={() => search.onChange("")}
        {...(search.placeholder === undefined ? {} : { placeholder: search.placeholder })}
        {...(search.clearLabel === undefined ? {} : { clearLabel: search.clearLabel })}
        {...(autoFocus ? { autoFocus: true } : {})}
    />
)

/** One trailing filter of a search zone: a small `Select` whose label is its accessible name, at its natural width. */
const ZoneSelect = ({ field }: { readonly field: SelectZoneField }) => (
    <div className="starci-core-surface-zone-select" data-grammar-zone-select="true">
        <Select
            label={field.label}
            isLabelHidden
            size="sm"
            options={field.options}
            value={field.value}
            onValueChange={field.onChange}
            {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
            {...(field.prefix === undefined ? {} : { prefix: field.prefix })}
        />
    </div>
)

/** The search zone: the search grows, each filter keeps its natural width; narrow, the filters wrap below the search. */
const SearchZone = ({ search }: { readonly search: SearchZoneFields }) => (
    <div className={surfaceZoneClassName} data-grammar-zone="search" data-grammar-zone-filters={search.filters === undefined || search.filters.length === 0 ? undefined : "true"}>
        <div className="starci-core-surface-zone-search-row">
            <div className="starci-core-surface-zone-search-grow"><ZoneSearch search={search} isCompact={false} /></div>
            {(search.filters ?? []).map((field, index) => <ZoneSelect key={`${field.label}-${index}`} field={field} />)}
        </div>
    </div>
)

/** The toolbar zone: filter tabs at the leading edge, a compact search at the trailing edge; narrow, the search is a button that opens a row. */
const ToolbarZone = ({ filter, search }: { readonly filter: FilterFields; readonly search: SearchFields }) => {
    const [isOpen, setIsOpen] = useState(false)
    const rowId = useId()
    return (
        <>
            <div className={surfaceZoneClassName} data-grammar-zone="toolbar" data-grammar-zone-line="tabs">
                <div className={surfaceZoneRowClassName}>
                    <div className="starci-core-surface-zone-lead"><FilterTabs filter={filter} /></div>
                    <div className="starci-core-surface-zone-trail">
                        <div className={surfaceZoneSearchWideClassName}><ZoneSearch search={search} isCompact /></div>
                        <div className={surfaceZoneSearchToggleClassName}>
                            <IconButton
                                glyph="search"
                                size="sm"
                                label={search.label}
                                isActive={isOpen}
                                aria-controls={rowId}
                                aria-expanded={isOpen}
                                onPress={() => setIsOpen((open) => !open)}
                            />
                        </div>
                    </div>
                </div>
            </div>
            {isOpen ? (
                <div className={`${surfaceZoneClassName} ${surfaceZoneSearchOpenClassName}`} data-grammar-zone="search" id={rowId}>
                    <ZoneSearch search={search} isCompact={false} autoFocus />
                </div>
            ) : null}
        </>
    )
}

/** The primary tabs of a switch zone: a pill in a track, no line. */
export const SwitchTabs = ({ switchFields }: { readonly switchFields: SwitchFields }) => (
    <Tabs
        appearance="primary"
        label={switchFields.label}
        items={switchFields.items}
        selectedKey={switchFields.selectedKey}
        onSelect={switchFields.onSelect}
    />
)

/** One header zone, drawn by its kind. The shell draws the divider after it (its bottom border); a tab strip's line IS that border. */
export const HeaderZoneView = ({ zone, isLoading }: { readonly zone: HeaderZone; readonly isLoading: boolean }) => {
    switch (zone.kind) {
        case "filter":
            return (
                <TabsLineHost>
                    <div className={surfaceZoneClassName} data-grammar-zone="filter" data-grammar-zone-line="tabs"><FilterTabs filter={zone} /></div>
                </TabsLineHost>
            )
        case "search":
            return <SearchZone search={zone} />
        case "toolbar":
            return <TabsLineHost><ToolbarZone filter={zone.filter} search={zone.search} /></TabsLineHost>
        case "switch":
            return (
                <div className={surfaceZoneClassName} data-grammar-zone="switch">
                    {zone.title === undefined ? null : <span className="starci-core-surface-zone-title">{zone.title}</span>}
                    <span className="starci-core-surface-zone-switch"><SwitchTabs switchFields={zone} /></span>
                </div>
            )
        case "figures":
            return <div className={surfaceZoneClassName} data-grammar-zone="figures"><FigureCells items={figureItems(zone.items, isLoading)} isLoading={isLoading} /></div>
        case "custom":
            return <div className={surfaceZoneClassName} data-grammar-zone="custom"><CustomZoneScope>{zone.children}</CustomZoneScope></div>
    }
}

/** One footer zone. The shell draws the divider before it (its top border). */
export const FooterZoneView = ({ zone }: { readonly zone: FooterZone }) => {
    switch (zone.kind) {
        case "more":
            return (
                <div className={surfaceZoneClassName} data-grammar-zone="more">
                    {zone.href === undefined
                        ? <TextAction appearance="route" size="sm" onPress={zone.press}>{zone.label}</TextAction>
                        : <Link href={zone.href}>{zone.label}</Link>}
                </div>
            )
        case "paging":
            return (
                <div className={surfaceZoneClassName} data-grammar-zone="paging">
                    <Pagination
                        label={zone.labels.nav}
                        page={zone.page}
                        pageCount={zone.pageCount}
                        onPageChange={zone.onPage}
                        previousLabel={zone.labels.previous}
                        nextLabel={zone.labels.next}
                        pageLabel={zone.labels.page}
                        {...(zone.labels.summary === undefined ? {} : { summary: zone.labels.summary })}
                    />
                </div>
            )
        case "custom":
            return <div className={surfaceZoneClassName} data-grammar-zone="custom"><CustomZoneScope>{zone.children}</CustomZoneScope></div>
    }
}
