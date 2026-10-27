import { CloudIcon } from "@heroicons/react/24/outline"
import { Alert, EmptyNotice, Region, SectionHeader } from "@starci/grammar/core"
import { useId } from "react"
import { useOverview } from "../../api/client"
import type { Overview } from "@contract"
import { OVERVIEW } from "../../app/labels"
import { OverviewHeader } from "./OverviewHeader"
import { ProviderCard, ProviderCardSkeleton } from "./ProviderCard"
import { RecentEvents } from "./RecentEvents"
import { WorkflowsTable } from "./WorkflowsTable"

const SKELETON_PROVIDERS = [0, 1, 2, 3] as const

const Providers = ({ overview, isLoading }: { readonly overview?: Overview; readonly isLoading: boolean }) => {
    if (isLoading) return SKELETON_PROVIDERS.map(index => <ProviderCardSkeleton key={index} index={index} />)
    if (overview === undefined || overview.providers.length === 0) {
        return <EmptyNotice iconSource={CloudIcon} message={OVERVIEW.noProviders} description={OVERVIEW.noProvidersHint} />
    }
    return overview.providers.map(provider => <ProviderCard key={provider.provider} provider={provider} />)
}

/** Screen 1 · Tổng quan: providers' quota, every workflow, and the latest harness events. */
export const OverviewPage = () => {
    const { data, isLoading, error } = useOverview()
    const loading = isLoading && data === undefined
    const providersHeading = useId()
    return (
        <div className="app-page-stack">
            <OverviewHeader overview={data} isLoading={loading} />
            {error === null ? null : (
                <Alert
                    tone="negative"
                    title={OVERVIEW.loadError}
                    description={data === undefined ? error.message : `${error.message} · ${OVERVIEW.staleSuffix}`}
                />
            )}
            {error !== null && data === undefined ? null : (
                <>
                    <Region labelledBy={providersHeading}>
                        <div className="app-stack">
                            <SectionHeader id={providersHeading} level={2} title={OVERVIEW.providersTitle} description={OVERVIEW.providersFact} />
                            <div className="app-grid">
                                <Providers overview={data} isLoading={loading} />
                            </div>
                        </div>
                    </Region>
                    <WorkflowsTable workflows={data?.workflows ?? []} isLoading={loading} />
                    <RecentEvents events={data?.events ?? []} isLoading={loading} />
                </>
            )}
        </div>
    )
}
