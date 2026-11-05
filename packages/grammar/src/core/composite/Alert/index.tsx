"use client"

import { useRegionOwnsBusy, withRegionLoading } from "../../regionScope.js"
import { Alert as HeroAlert, Spinner as HeroSpinner } from "@heroui/react"
import { ChevronRightIcon } from "@heroicons/react/16/solid"
import { useState, type ReactNode } from "react"
import type { PresentationState } from "../../../common/state.js"
import { vendorStatusFor } from "../../overlayScope.js"
import { Button } from "../../leaf/Button/index.js"
import type { ButtonIntentProps } from "../../buttonIntent.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import type { NoChildren } from "../../tier.js"

export type AlertUrgency = "polite" | "assertive"
/** @deprecated An Alert has one look, the tone's soft pair; both values render it. Removed in the next release. */
export type AlertAppearance = "surface" | "soft"

export type AlertAction = {
    readonly label: string
    readonly onAction: () => void
    /**
     * Optional start glyph of the action Button (e.g. a power glyph on "Enable"), drawn by `Icon`
     * `usage="leading"` as the Button's `startContent`. Decorative: the label stays the name.
     */
    readonly icon?: IconSource
    /**
     * `button` (default): a pill button at the end. `row`: the whole banner is the one press target (an invisible button over the row,
     * a chevron at its end, the action's `label` as its name), for a banner that opens what it announces ("3 to approve").
     */
    readonly kind?: "button" | "row"
}

type AlertBase = {
    readonly title: string
    readonly description?: ReactNode
    /**
     * Render-neutral meaning of the banner. Default `informative`. `accent` is the brand: the accent soft pair, for a welcome or
     * "new" band that announces no status (it reads and acts as `informative`).
     */
    readonly tone?: PresentationState | "accent"
    /** A mark in place of the tone's glyph: an `Avatar` (who asks) or an `IconTile`. */
    readonly leading?: ReactNode
    readonly action?: AlertAction
    /**
     * How the banner is announced when it appears. Default: `assertive` (`role="alert"`) for a
     * `negative` tone, `polite` (`role="status"`) for everything else.
     */
    readonly urgency?: AlertUrgency
    /** @deprecated No effect: every Alert is drawn on its tone's soft tint. Remove the prop; it is dropped in the next release. */
    readonly appearance?: AlertAppearance
    /**
     * Unresolved banner (knowledge STATE-8): the same anatomy in the neutral tone, not announced (no status role), its
     * glyph, title, description and actions laid out unseen under shimmers, so it keeps the ready box (skeleton parity).
     */
    readonly isLoading?: boolean
}

/** A dismissible banner must name its close action; a permanent one has neither prop. */
type Dismissible = {
    readonly dismissLabel: string
    readonly onDismiss?: () => void
}

type Permanent = {
    readonly dismissLabel?: never
    readonly onDismiss?: never
}

export type AlertProps = NoChildren & AlertBase & (Dismissible | Permanent)

/**
 * The action Button variant an Alert tone takes, as HeroUI v3's own Alert examples pair them: the accent
 * Alert carries a `primary` Button ("Refresh"), the danger Alert a `danger` Button ("Retry"). HeroUI has no
 * success or warning Button variant, so every other tone keeps `secondary`.
 *
 * | tone (PresentationState) | vendor status | action variant |
 * | ------------------------ | ------------- | -------------- |
 * | informative              | accent        | primary        |
 * | negative                 | danger        | danger         |
 * | affirmative              | success       | secondary      |
 * | cautionary               | warning       | secondary      |
 * | neutral / pending / unavailable | default | secondary      |
 */
const alertActionIntentFor = (tone: PresentationState): ButtonIntentProps => {
    const status = vendorStatusFor(tone)
    if (status === "accent") return { intent: "commit" }
    if (status === "danger") return { intent: "destructive", step: "confirm" }
    return { intent: "alternative" }
}

/**
 * COMPOSITE - `Alert`: an inline, in-flow banner about the region it sits in.
 *
 * Its one look is the tone's soft pair (owner ruling `alert-soft-pair`): the background is `--<tone>-soft` at full strength, the
 * glyph, title and description are `--<tone>-soft-foreground`, with no shadow and no border. Tones map to the pair
 * as informative -> info (accent where the theme has no info pair), affirmative -> success, cautionary -> warning, negative -> danger, and neutral, pending and
 * unavailable -> default.
 *
 * It is not an overlay: it takes layout space and stays until resolved or dismissed. Dismissal is
 * uncontrolled (the banner removes itself) and `onDismiss` reports it. Tone is echoed on
 * `data-grammar-tone`; the vendor status supplies the default glyph, `pending` swaps it for a spinner.
 * The action Button's intent follows the tone (`alertActionIntentFor`, after HeroUI's Alert examples):
 * informative (accent) -> `commit`, negative (danger) -> a confirmed `destructive`, every other tone -> `alternative`.
 * Below 30rem a `button` action stacks under the text, full width, in that same intent; a dismiss stays beside the text.
 * Contract: root FEEDBACK-3 (status/alert urgency on the owner); actions FEEDBACK-2 (recovery in place).
 */
const AlertInner = (props: AlertProps) => {
    const { title, description, tone: readyTone = "informative", leading, action, urgency, isLoading = false } = props
    const ownsBusy = useRegionOwnsBusy()
    const tone: PresentationState | "accent" = isLoading ? "neutral" : readyTone
    const meaning: PresentationState = tone === "accent" ? "informative" : tone
    const unseen = (node: ReactNode) => isLoading ? <SkeletonPlaceholder>{node}</SkeletonPlaceholder> : node
    const [isDismissed, setIsDismissed] = useState(false)
    if (isDismissed) return null

    const resolvedUrgency = urgency ?? (meaning === "negative" ? "assertive" : "polite")
    const dismiss = () => {
        setIsDismissed(true)
        props.onDismiss?.()
    }

    return (
        <HeroAlert
            data-tier="composite"
            data-component="Alert"
            data-grammar-tone={tone}
            data-urgency={resolvedUrgency}
            data-contract="FEEDBACK-3"
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : { role: resolvedUrgency === "assertive" ? "alert" : "status" })}
            status={vendorStatusFor(meaning)}
            className="starci-core-alert"
        >
            {leading === undefined ? (
                <HeroAlert.Indicator className="starci-core-alert-indicator">
                    {meaning === "pending" ? <HeroSpinner aria-hidden="true" role="presentation" size="sm" color="current" /> : undefined}
                </HeroAlert.Indicator>
            ) : <span className="starci-core-alert-leading" data-grammar-alert-leading="true">{isLoading ? <SkeletonPlaceholder shape="block">{leading}</SkeletonPlaceholder> : leading}</span>}
            <HeroAlert.Content className="starci-core-alert-content">
                <HeroAlert.Title className="starci-core-alert-title">{unseen(title)}</HeroAlert.Title>
                {description === undefined ? null : (
                    <HeroAlert.Description className="starci-core-alert-description">{unseen(description)}</HeroAlert.Description>
                )}
            </HeroAlert.Content>
            {action === undefined && props.dismissLabel === undefined ? null : (
                <span className="starci-core-alert-actions" data-grammar-alert-actions="true" data-contract="FEEDBACK-2">
                    {action === undefined ? null : action.kind === "row" ? (
                        <>
                            <button type="button" className="starci-core-alert-row-press" onClick={action.onAction} disabled={isLoading}><span className="starci-core-alert-row-press-label">{action.label}</span></button>
                            <ChevronRightIcon aria-hidden="true" className="starci-core-alert-chevron" />
                        </>
                    ) : (
                        <Button
                            isLoading={isLoading}
                            size="sm"
                            width="fill-narrow"
                            {...alertActionIntentFor(meaning)}
                            onPress={action.onAction}
                            {...(action.icon === undefined ? {} : { startContent: <Icon source={action.icon} usage="leading" /> })}
                        >{action.label}</Button>
                    )}
                    {props.dismissLabel === undefined ? null : (
                        isLoading
                            ? <SkeletonPlaceholder shape="circle"><IconButton intent="dismiss" label={props.dismissLabel} size="sm" onPress={dismiss} /></SkeletonPlaceholder>
                            : <IconButton intent="dismiss" label={props.dismissLabel} size="sm" onPress={dismiss} />
                    )}
                </span>
            )}
        </HeroAlert>
    )
}

/**
 * COMPOSITE - `Alert`: an inline, in-flow banner about the region it sits in.
 *
 * Its one look is the tone's soft pair (owner ruling `alert-soft-pair`): the background is `--<tone>-soft` at full strength, the
 * glyph, title and description are `--<tone>-soft-foreground`, with no shadow and no border. Tones map to the pair
 * as informative -> info (accent where the theme has no info pair), affirmative -> success, cautionary -> warning, negative -> danger, and neutral, pending and
 * unavailable -> default.
 *
 * It is not an overlay: it takes layout space and stays until resolved or dismissed. Dismissal is
 * uncontrolled (the banner removes itself) and `onDismiss` reports it. Tone is echoed on
 * `data-grammar-tone`; the vendor status supplies the default glyph, `pending` swaps it for a spinner.
 * The action Button's intent follows the tone (`alertActionIntentFor`, after HeroUI's Alert examples):
 * informative (accent) -> `commit`, negative (danger) -> a confirmed `destructive`, every other tone -> `alternative`.
 * Below 30rem a `button` action stacks under the text, full width, in that same intent; a dismiss stays beside the text.
 * Contract: root FEEDBACK-3 (status/alert urgency on the owner); actions FEEDBACK-2 (recovery in place).
 */
export const Alert = withRegionLoading(AlertInner)
