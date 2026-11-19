import type { ReactElement } from "react"
import { ListBox, SearchField, StatusDot, Switch, Text } from "@starci/grammar/core"
import { useMemo, useState } from "react"
import { fill } from "../labels.ts"
import type { Labels } from "../labels.ts"
import type { Model } from "../model.ts"
import { cap } from "./cap.ts"
import { dotTone, statusLabel } from "./status.ts"

export interface TreeProps {
    readonly model: Model
    readonly labels: Labels
    readonly selected: string | null
    readonly onSelect: (id: string) => void
}

/** The areas and their screens, each screen with the dot of its status, narrowed by the search. */
export function Tree({ model, labels, selected, onSelect }: TreeProps): ReactElement {
    const [query, setQuery] = useState("")
    const [flaggedOnly, setFlaggedOnly] = useState(false)
    const flaggedTotal = useMemo(() => model.areas.reduce((sum, area) => sum + area.screens.filter((screen) => screen.flagged).length, 0), [model])
    const sections = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return model.areas
            .map((area) => ({
                id: `area:${area.area}`,
                label: area.screens.some((screen) => screen.flagged) ? `${cap(area.area)} · ${fill(labels.flaggedCount, { n: area.screens.filter((screen) => screen.flagged).length })}` : cap(area.area),
                items: area.screens
                    .filter((screen) => !flaggedOnly || screen.flagged)
                    .filter((screen) => needle === "" || screen.id.toLowerCase().includes(needle) || screen.title.toLowerCase().includes(needle))
                    .map((screen) => ({
                        id: screen.id,
                        label: cap(screen.title),
                        labelLeading: screen.status === "none" ? undefined : <StatusDot tone={dotTone(screen.status)} aria-label={statusLabel(labels, screen.status, screen.designStatus)} />,
                        description: screen.name,
                        descriptionLines: 1 as const,
                        size: "sm" as const,
                    })),
            }))
            .filter((section) => section.items.length > 0)
    }, [model, labels, query, flaggedOnly])
    return (
        <div className="sg-tree-body">
            <SearchField label={labels.search} isLabelHidden placeholder={labels.search} value={query} onValueChange={setQuery} onClear={() => { setQuery("") }} clearLabel={labels.clear} />
            {flaggedTotal === 0 ? null : <Switch label={`${labels.flaggedOnly} (${String(flaggedTotal)})`} size="control" isSelected={flaggedOnly} onSelectedChange={setFlaggedOnly} />}
            <ListBox
                label={labels.screens}
                sections={sections}
                size="sm"
                selectionMode="single"
                selectionIndicator="none"
                selectedIds={selected === null ? [] : [selected]}
                onSelectionChange={(ids) => { const next = ids[0]; if (next !== undefined) onSelect(next) }}
                emptyContent={<Text tone="muted">{labels.noScreens}</Text>}
            />
        </div>
    )
}
