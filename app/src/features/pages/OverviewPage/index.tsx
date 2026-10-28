import { PageContainer } from "@starci/grammar/core"
import { EventsBlock } from "../../../components/blocks/EventsBlock"
import { OverviewHeaderBlock } from "../../../components/blocks/OverviewHeaderBlock"
import { ProvidersBlock } from "../../../components/blocks/ProvidersBlock"
import { WorkflowsTableBlock } from "../../../components/blocks/WorkflowsTableBlock"

/** Screen 1 · Tổng quan: the header band, then providers' quota, every workflow and the latest harness events; each region reads alone. */
export const OverviewPage = () => (
    <>
        <OverviewHeaderBlock />
        <PageContainer measure="full" className="app-page-body app-page-stack">
            <ProvidersBlock />
            <WorkflowsTableBlock />
            <EventsBlock />
        </PageContainer>
    </>
)
