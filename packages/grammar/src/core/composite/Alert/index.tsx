"use client"

import { useRegionOwnsBusy, withRegionLoading } from "../../regionScope.js"
import { Alert as HeroAlert, Spinner as HeroSpinner } from "@heroui/react"
import { CheckCircleIcon, ChevronRightIcon, ExclamationCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline"
import { useState, type ComponentType, type ReactNode, type SVGProps } from "react"
import { isPresentationState, PRESENTATION_STATES, type PresentationState } from "../../../common/state.js"
import type { CustomTone } from "../../../common/tones.js"
import { useCustomTone } from "../../useCustomTone.js"
import { vendorStatusFor } from "../../overlayScope.js"
import { Button, type ButtonLook } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { Icon, type IconSource } from "../../leaf/Icon/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import { RETRY_VARIANT } from "../../loadingState.js"
import type { NoChildren } from "../../tier.js"

export type AlertUrgency = "polite" | "assertive"

export type AlertAction = {
    readonly label: string
    readonly onAction: () => void
    /**
     * Optional start glyph of the action Button (e.g. a power glyph on "Enable"), drawn by `Icon`
     * `usage="leading"` as the Button's `startContent`. Decorative: the label stays the name. Only a `primary` action (`ALERT_ACTION_LOOK`)
     * wears it; the button-icon rule keeps every other action text only, so the glyph is not drawn there.
     */
    readonly icon?: IconSource
    /**
     * The action destroys something (delete, disconnect, stop for good): it draws `danger`, whatever the banner's tone. Default: not destructive
     * (a negative banner's "Try again" is a recovery, the `border` retry look).
     */
    readonly isDestructive?: boolean
    /**
     * `button` (default): a pill button at the end. `row`: the whole banner is the one press target (an invisible button over the row,
     * a chevron at its end, the action's `label` as its name), for a banner that opens what it announces ("3 to approve").
     */
    readonly kind?: "button" | "row"
}

/** The second decision of a banner that holds a form (0.46.2): a button beside the primary `action`, in the `border` look ("Reject" beside "Approve"). */
export type AlertSecondaryAction = {
    readonly label: string
    readonly onAction: () => void
}

type AlertBase = {
    readonly title: string
    readonly description?: ReactNode
    /**
     * Render-neutral meaning of the banner. Default `informative`. `accent` is the brand: the accent soft pair, for a welcome or
     * "new" band that announces no status (it reads and acts as `informative`). A tone the app declared in `GrammarToneRegistry` (an app's
     * `info`) paints its own soft pair and acts as a neutral notice.
     */
    readonly tone?: PresentationState | "accent" | CustomTone
    /** A mark in place of the tone's glyph: an `Avatar` (who asks) or an `IconTile`. */
    readonly leading?: ReactNode
    readonly action?: AlertAction
    /**
     * A second decision beside `action` (0.46.2), for a banner that asks the reader to decide: `border`, never a second primary. Needs `action` as a `button`.
     */
    readonly secondaryAction?: AlertSecondaryAction
    /**
     * A named slot for the fields the banner is about (0.46.2): a few lines of the draft (a `Section kind="list" layout="keyValue"`, a short form) drawn under the description,
     * inside the banner, above the actions. With a form the actions leave the end of the first row and stand on a row of their own under it, at the end. An Alert takes no
     * `children`; the slot is this prop. Not with an `action` of `kind: "row"` (the whole banner would be a press target around the fields).
     */
    readonly form?: ReactNode
    /**
     * How the banner is announced when it appears. Default: `assertive` (`role="alert"`) for a
     * `negative` tone, `polite` (`role="status"`) for everything else.
     */
    readonly urgency?: AlertUrgency
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
 * THE ALERT ACTION MAPPING (0.55.0): the look of a banner's `action` per tone, in ONE table so a tone can be flipped (owner: warning may become `border`).
 * A toned `primary` is SOLID in the banner's own colour (owner: "button phải là màu tương ứng, ko phải border"): `tone` fills it with `--<tone>`.
 * An action with `isDestructive` is `danger` on every tone. The second action (`secondaryAction`) and the dismiss are always `border`.
 *
 * | tone | action look |
 * | ---- | ----------- |
 * | informative | primary, tone info |
 * | accent | primary, tone accent |
 * | affirmative | primary, tone success |
 * | cautionary | primary, tone warning |
 * | negative | border (the one retry look, RETRY_VARIANT); danger when `isDestructive` |
 * | neutral / pending / unavailable / an app's own tone | border |
 */
export const ALERT_ACTION_LOOK: Readonly<Record<PresentationState | "accent", ButtonLook>> = Object.freeze({
    informative: { variant: "primary", tone: "info" },
    accent: { variant: "primary", tone: "accent" },
    affirmative: { variant: "primary", tone: "success" },
    cautionary: { variant: "primary", tone: "warning" },
    negative: { variant: RETRY_VARIANT },
    neutral: { variant: "border" },
    pending: { variant: "border" },
    unavailable: { variant: "border" },
})

const ALERT_BUILT_IN_TONES: readonly string[] = [...PRESENTATION_STATES, "accent"]

/** The look of an Alert's action: `danger` when it destroys, else its tone's row of `ALERT_ACTION_LOOK`; a loading banner's action is the border placeholder. */
const alertActionLook = (tone: PresentationState | "accent" | CustomTone, isDestructive: boolean, isLoading: boolean): ButtonLook => {
    if (isDestructive) return { variant: "danger" }
    if (isLoading) return { variant: "border" }
    return tone === "accent" || isPresentationState(tone) ? ALERT_ACTION_LOOK[tone] : { variant: "border" }
}

/**
 * COMPOSITE - `Alert`: an inline, in-flow banner about the region it sits in.
 *
 * Its one look is the tone's soft pair: the background is `--<tone>-soft` at full strength, the
 * bare 24px Heroicons glyph, title and description are `--<tone>-soft-foreground`, with no shadow and no border. Tones map to the pair
 * as informative -> info (accent where the theme has no info pair), affirmative -> success, cautionary -> warning, negative -> danger, and neutral, pending and
 * unavailable -> default.
 *
 * It is not an overlay: it takes layout space and stays until resolved or dismissed. Dismissal is
 * uncontrolled (the banner removes itself) and `onDismiss` reports it. Tone is echoed on
 * `data-grammar-tone`; the vendor status supplies the default glyph, `pending` swaps it for a spinner.
 * The action Button's look follows the tone (`ALERT_ACTION_LOOK`): informative, accent, affirmative and cautionary a `primary` solid in the
 * banner's colour, negative the `border` retry (or `danger` when `isDestructive`), every other tone `border`.
 * Below 30rem a `button` action stacks under the text, full width, in that same look; a dismiss stays beside the text.
 * Contract: root FEEDBACK-3 (status/alert urgency on the owner); actions FEEDBACK-2 (recovery in place).
 */
/**
 * The status mark of each meaning (owner 2026-11-22: "alert nói rõ là icon 24 soft-foreground trên nền soft thôi mà?"): the original Heroicons 24
 * outline glyph at its native 24px and stroke, in the banner's soft foreground on the soft box, with NO tile and no plate; pending's spinner is 24px.
 */
const ALERT_GLYPH: Readonly<Record<Exclude<PresentationState, "pending">, ComponentType<SVGProps<SVGSVGElement>>>> = {
    informative: InformationCircleIcon, affirmative: CheckCircleIcon, cautionary: ExclamationTriangleIcon, negative: ExclamationCircleIcon, neutral: InformationCircleIcon, unavailable: InformationCircleIcon,
}

/** The mark of a meaning, drawn as Heroicons ships it: 24 by 24, its own outline stroke, in the banner's ink. */
const AlertGlyph = ({ meaning }: { readonly meaning: Exclude<PresentationState, "pending"> }) => {
    const Glyph = ALERT_GLYPH[meaning]
    return <Glyph aria-hidden="true" focusable="false" width={24} height={24} className="starci-core-alert-glyph" data-grammar-alert-glyph={meaning} />
}

const AlertInner = (props: AlertProps) => {
    const { title, description, tone: readyTone = "informative", leading, action, secondaryAction, form, urgency, isLoading = false } = props
    if (form !== undefined && action?.kind === "row" && process.env.NODE_ENV !== "production") {
        throw new Error("Alert `form` cannot stand in a banner whose action is kind=\"row\": the whole banner would be one press target around the fields.")
    }
    const ownsBusy = useRegionOwnsBusy()
    const tone: PresentationState | "accent" | CustomTone = isLoading ? "neutral" : readyTone
    const custom = useCustomTone(tone, ALERT_BUILT_IN_TONES)
    const meaning: PresentationState = tone === "accent" ? "informative" : isPresentationState(tone) ? tone : "neutral"
    const actionLook = alertActionLook(tone, action?.isDestructive === true, isLoading)
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
            {...(form === undefined ? {} : { "data-grammar-alert-form": "true" })}
            ref={custom.ref as never}
            {...custom.attrs}
            data-urgency={resolvedUrgency}
            data-contract="FEEDBACK-3"
            {...(isLoading ? { "data-loading": "true", ...(ownsBusy ? {} : { "aria-busy": true }) } : { role: resolvedUrgency === "assertive" ? "alert" : "status" })}
            status={vendorStatusFor(meaning)}
            className="starci-core-alert"
        >
            {leading === undefined ? (
                <HeroAlert.Indicator className="starci-core-alert-indicator">
                    {meaning === "pending" ? <HeroSpinner aria-hidden="true" role="presentation" size="md" color="current" /> : <AlertGlyph meaning={meaning} />}
                </HeroAlert.Indicator>
            ) : <span className="starci-core-alert-leading" data-grammar-alert-leading="true">{isLoading ? <SkeletonPlaceholder shape="block">{leading}</SkeletonPlaceholder> : leading}</span>}
            <HeroAlert.Content className="starci-core-alert-content">
                <HeroAlert.Title className="starci-core-alert-title">{unseen(title)}</HeroAlert.Title>
                {description === undefined ? null : (
                    <HeroAlert.Description className="starci-core-alert-description">{unseen(description)}</HeroAlert.Description>
                )}
                {form === undefined ? null : <div className="starci-core-alert-form" data-grammar-alert-form-slot="true">{unseen(form)}</div>}
            </HeroAlert.Content>
            {action === undefined && secondaryAction === undefined && props.dismissLabel === undefined ? null : (
                <span className="starci-core-alert-actions" data-grammar-alert-actions="true" data-contract="FEEDBACK-2">
                    {secondaryAction === undefined ? null : (
                        <Button isLoading={isLoading} width="fill-narrow" size="sm" variant="border" onPress={secondaryAction.onAction}>{secondaryAction.label}</Button>
                    )}
                    {action === undefined ? null : action.kind === "row" ? (
                        <>
                            <button type="button" className="starci-core-alert-row-press" onClick={action.onAction} disabled={isLoading}><span className="starci-core-alert-row-press-label">{action.label}</span></button>
                            <ChevronRightIcon aria-hidden="true" className="starci-core-alert-chevron" />
                        </>
                    ) : (
                        <Button
                            isLoading={isLoading}
                            width="fill-narrow"
                            {...(actionLook.variant === "primary"
                                ? { variant: "primary" as const, ...(actionLook.tone === undefined ? {} : { tone: actionLook.tone }), ...(action.icon === undefined ? { size: "sm" as const } : { size: "md" as const, startContent: <Icon source={action.icon} usage="leading" /> }) }
                                : { variant: actionLook.variant ?? "border", size: "sm" as const })}
                            onPress={action.onAction}
                        >{action.label}</Button>
                    )}
                    {props.dismissLabel === undefined ? null : (
                        isLoading
                            ? <SkeletonPlaceholder shape="circle"><IconButton variant="border" label={props.dismissLabel} size="sm" onPress={dismiss} /></SkeletonPlaceholder>
                            : <IconButton variant="border" label={props.dismissLabel} size="sm" onPress={dismiss} />
                    )}
                </span>
            )}
        </HeroAlert>
    )
}

/**
 * COMPOSITE - `Alert`: an inline, in-flow banner about the region it sits in.
 *
 * Its one look is the tone's soft pair: the background is `--<tone>-soft` at full strength, the
 * bare 24px Heroicons glyph, title and description are `--<tone>-soft-foreground`, with no shadow and no border. Tones map to the pair
 * as informative -> info (accent where the theme has no info pair), affirmative -> success, cautionary -> warning, negative -> danger, and neutral, pending and
 * unavailable -> default.
 *
 * It is not an overlay: it takes layout space and stays until resolved or dismissed. Dismissal is
 * uncontrolled (the banner removes itself) and `onDismiss` reports it. Tone is echoed on
 * `data-grammar-tone`; the vendor status supplies the default glyph, `pending` swaps it for a spinner.
 * The action Button's look follows the tone (`ALERT_ACTION_LOOK`): informative, accent, affirmative and cautionary a `primary` solid in the
 * banner's colour, negative the `border` retry (or `danger` when `isDestructive`), every other tone `border`.
 * Below 30rem a `button` action stacks under the text, full width, in that same look; a dismiss stays beside the text.
 * Contract: root FEEDBACK-3 (status/alert urgency on the owner); actions FEEDBACK-2 (recovery in place).
 */
export const Alert = withRegionLoading(AlertInner)
