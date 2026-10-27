import { Meter, Region, RelativeTime, SectionHeader, SurfaceCard, Text, type PresentationState } from "@starci/grammar/core"
import { useId } from "react"
import type { DataSlot, SlotLabels, ToneLabel } from "../../../modules/types"
import { SlotView } from "../../composites/SlotView"
import { StatusWord } from "../../leaves/StatusWord"

/** One provider, resolved for drawing. */
export interface ProviderView {
    readonly id: string
    readonly name: string
    readonly circuit: ToneLabel
    readonly meterTone: PresentationState
    readonly usage: number
    readonly usageText: string
    readonly quotaLabel: string
    readonly windows: string
    /** When the provider frees up again, as a countdown; null when nothing resets. */
    readonly reset: { readonly at: string; readonly template: string; readonly fallback: string } | null
    readonly running: string
}

/** Copy the connected block resolves. */
export interface ProvidersBlockLabels {
    readonly title: string
    readonly fact: string
    readonly locale: string
    readonly slot: SlotLabels
}

/** Complete input of ProvidersBlockBase. */
export interface ProvidersBlockBaseProps {
    readonly props: {
        readonly providers: DataSlot<readonly ProviderView[]>
        readonly labels: ProvidersBlockLabels
    }
    readonly on: { readonly retry: () => void }
}

const placeholderProvider = (id: string): ProviderView => ({
    id,
    name: " ",
    circuit: { label: " ", tone: "neutral" },
    meterTone: "neutral",
    usage: 0,
    usageText: "",
    quotaLabel: id,
    windows: "",
    reset: null,
    running: "",
})

const PROVIDERS_PLACEHOLDER: readonly ProviderView[] = ["p0", "p1", "p2", "p3"].map(placeholderProvider)

const ProviderCard = ({ provider, locale, isSkeleton }: { readonly provider: ProviderView; readonly locale: string; readonly isSkeleton: boolean }) => (
    <SurfaceCard label={provider.name} headingLevel={3} height="fill" labelEnd={<StatusWord status={provider.circuit} isSkeleton={isSkeleton} />}>
        <div className="app-pair">
            <Meter
                label={provider.quotaLabel}
                value={provider.usage}
                tone={provider.meterTone}
                valueLabel={provider.usageText}
                isLabelHidden
                isSkeleton={isSkeleton}
            />
            <Text as="p" size="xs" tone="muted" isSkeleton={isSkeleton}>
                {provider.windows}
                {provider.reset === null ? null : (
                    <>
                        {" · "}
                        <RelativeTime
                            dateTime={provider.reset.at}
                            locale={locale}
                            mode="countdown"
                            template={provider.reset.template}
                            size="xs"
                            tone="muted"
                            fallback={provider.reset.fallback}
                        />
                    </>
                )}
            </Text>
            <Text as="p" size="xs" isSkeleton={isSkeleton}>
                {provider.running}
            </Text>
        </div>
    </SurfaceCard>
)

/** Pure half: each provider's circuit, quota windows, peak usage and running seats against its cap. */
export const ProvidersBlockBase = (props: ProvidersBlockBaseProps) => {
    const { labels } = props.props
    const heading = useId()
    return (
        <Region labelledBy={heading}>
            <div className="app-stack">
                <SectionHeader id={heading} level={2} title={labels.title} description={labels.fact} />
                <div className="app-grid">
                    <SlotView slot={props.props.providers} placeholder={PROVIDERS_PLACEHOLDER} labels={labels.slot} onRetry={props.on.retry}>
                        {(providers, isSkeleton) =>
                            providers.map((provider) => (
                                <ProviderCard key={provider.id} provider={provider} locale={labels.locale} isSkeleton={isSkeleton} />
                            ))
                        }
                    </SlotView>
                </div>
            </div>
        </Region>
    )
}
