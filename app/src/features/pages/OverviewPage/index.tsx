import { EventsBlock } from "../../../components/blocks/EventsBlock"
import { OverviewHeaderBlock } from "../../../components/blocks/OverviewHeaderBlock"
import { ProvidersBlock } from "../../../components/blocks/ProvidersBlock"
import { WorkflowsTableBlock } from "../../../components/blocks/WorkflowsTableBlock"

/** Screen 1 · Tổng quan: the header, providers' quota, every workflow and the latest harness events; each region reads alone. */
export const OverviewPage = () => (
    <div className="app-page-stack">
        <OverviewHeaderBlock />
        <ProvidersBlock />
        <WorkflowsTableBlock />
        <EventsBlock />
    </div>
)
