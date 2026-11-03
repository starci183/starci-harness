import type { ReactNode } from "react"
import { EmptyNotice, Page } from "@starci/grammar/common"

/** What the {{pascal}} workbench draws: its title and the words of its empty state. */
export interface {{pascal}}WorkbenchViewProps {
    readonly title: string
    readonly emptyTitle: string
    readonly emptyBody: string
}

/** Draws the {{pascal}} workbench with Grammar alone; it owns no class string, colour or visual of its own. */
export const {{pascal}}WorkbenchView = (props: {{pascal}}WorkbenchViewProps): ReactNode => (
    <Page header={{ title: props.title }}>
        <EmptyNotice message={props.emptyTitle} description={props.emptyBody} />
    </Page>
)
