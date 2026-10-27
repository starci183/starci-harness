import { Badge, Meter, RelativeTime, SurfaceCard, Text } from "@starci/grammar/core"
import type { ProviderStatus } from "@contract"
import { COMMON, LOCALE, OVERVIEW, PROVIDER_NAME } from "../../app/labels"
import { circuitView, nextReset, peakUsage, runningLine, windowsLine } from "./format"

/** One provider's circuit, quota windows, peak usage and running seats against its cap. */
export const ProviderCard = ({ provider }: { readonly provider: ProviderStatus }) => {
    const name = PROVIDER_NAME[provider.provider]
    const circuit = circuitView(provider)
    const reset = nextReset(provider)
    const resetVerb = provider.circuit === "open" ? OVERVIEW.reopen : OVERVIEW.reset
    const usage = peakUsage(provider)
    return (
        <SurfaceCard
            label={name}
            headingLevel={3}
            height="fill"
            labelEnd={
                <Badge tone={circuit.tone} isDot>
                    {circuit.label}
                </Badge>
            }
        >
            <div className="app-pair">
                <Meter label={OVERVIEW.providerQuota(name)} value={usage} tone={circuit.meter} valueLabel={`${usage}%`} isLabelHidden />
                <Text as="p" size="xs" tone="muted">
                    {windowsLine(provider)}
                    {reset === null ? null : (
                        <>
                            {" · "}
                            <RelativeTime
                                dateTime={reset}
                                locale={LOCALE}
                                mode="countdown"
                                template={`${resetVerb} {time}`}
                                size="xs"
                                tone="muted"
                                fallback={`${resetVerb} ${COMMON.dash}`}
                            />
                        </>
                    )}
                </Text>
                <Text as="p" size="xs">
                    {runningLine(provider)}
                </Text>
            </div>
        </SurfaceCard>
    )
}

/** Same footprint while the first overview is loading. */
export const ProviderCardSkeleton = ({ index }: { readonly index: number }) => (
    <SurfaceCard ariaLabel={OVERVIEW.providerSkeleton(index)} height="fill">
        <div className="app-pair">
            <Meter label={OVERVIEW.providerSkeleton(index)} value={0} isLabelHidden isSkeleton />
            <Text as="p" size="xs" isSkeleton />
            <Text as="p" size="xs" isSkeleton />
        </div>
    </SurfaceCard>
)
