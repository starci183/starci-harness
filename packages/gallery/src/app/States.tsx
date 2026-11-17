import type { ReactElement } from "react"
import { Tabs } from "@starci/grammar/core"
import type { Labels } from "../labels.ts"
import type { Model, Screen } from "../model.ts"

const stateLabel = (labels: Labels, state: Screen["state"]): string =>
    ({
        base: labels.stateBase,
        detail: labels.stateDetail,
        empty: labels.stateEmpty,
        "first-visit": labels.stateFirstVisit,
        loading: labels.stateLoading,
        error: labels.stateError,
        "no-match": labels.stateNoMatch,
        editing: labels.stateEditing,
    })[state]

/** The states of the screen's page (its sibling screen folders: `-empty`, `-loading`, `-error` …), one chip each; nothing when the page has one screen only. */
export function States({ screen, model, labels, onOpen }: { readonly screen: Screen; readonly model: Model; readonly labels: Labels; readonly onOpen: (id: string) => void }): ReactElement | null {
    const ids = model.pages[screen.page] ?? []
    if (ids.length < 2) return null
    return (
        <Tabs
            kind="filter"
            label={labels.states}
            selectedKey={screen.id}
            onSelect={onOpen}
            items={ids.map((id) => {
                const one = model.screens[id]
                return { id, label: one === undefined ? id : stateLabel(labels, one.state) }
            })}
        />
    )
}
