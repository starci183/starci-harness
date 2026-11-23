"use client"

import { useRegionOwnsBusy, withRegionLoading } from "../../regionScope.js"
import { Alert as HeroAlert, Spinner as HeroSpinner } from "@heroui/react"
import { CheckCircleIcon, ChevronRightIcon, ExclamationCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline"
import { useState, type ComponentType, type ReactNode, type SVGProps } from "react"
import { isPresentationState, PRESENTATION_STATES, type PresentationState } from "../../../common/state.js"
import type { CustomTone } from "../../../common/tones.js"
import { useCustomTone } from "../../useCustomTone.js"
import { vendorStatusFor } from "../../overlayScope.js"
import { Button } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import type { NoChildren } from "../../tier.js"

export type AlertUrgency = "polite" | "assertive"

/**
 * What an Alert button does when pressed: a command (`onAction`) or a destination (`href`, an anchor: middle-click and copy-link work, as on a
 * Button with `href`). Exactly one of the two.
 */
export type AlertPress =
    | { readonly onAction: () => void; readonly href?: never }
    | { readonly href: string; readonly onAction?: never }

export type AlertAction = AlertPress & {
    readonly label: string
    /**
     * The action destroys something (delete, disconnect, stop for good): it draws `danger`, whatever the banner's tone. Default: not destructive
     * (a negative banner's "Try again" is a recovery, the tinted look like every other action of the banner).
     */
    readonly isDestructive?: boolean
    /**
     * `button` (default): a pill button at the end. `row`: the whole banner is the one press target (an invisible button over the row,
     * a chevron at its end, the action's `label` as its name), for a banner that opens what it announces ("3 to approve").
     */
    readonly kind?: "button" | "row"
}

/** The second decision of a banner that holds a form (0.46.2): a button beside `action` ("Reject" beside "Approve"), in the same tinted look. */
export type AlertSecondaryAction = AlertPress & {
    readonly label: string
}

/** One of several equal actions of a banner (`actions`, 0.55.1): a tinted button in the banner's tone, none of them primary. */
export type AlertActionItem = AlertPress & {
    readonly label: string
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

/** One main action, with an optional second decision beside it (0.46.2; `secondaryAction` needs `action` as a `button`). */
type OneAction = {
    readonly action?: AlertAction
    readonly secondaryAction?: AlertSecondaryAction
    readonly actions?: never
}

/**
 * Several EQUAL actions (0.55.1, owner 2026-11-23): "Message Ads / Message Care / Message Social" under one notice. Each is a tinted button in the banner's
 * tone, in the order given, and none is primary. Not with `action` or `secondaryAction`.
 */
type EqualActions = {
    readonly actions: readonly AlertActionItem[]
    readonly action?: never
    readonly secondaryAction?: never
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

export type AlertProps = NoChildren & AlertBase & (OneAction | EqualActions) & (Dismissible | Permanent)

const ALERT_BUILT_IN_TONES: readonly string[] = [...PRESENTATION_STATES, "accent"]

/**
 * THE ALERT ACTION LOOK (0.55.1, owner 2026-11-23, "Chốt, làm luôn"): a button inside a banner takes the BANNER'S TONE. Its fill is one step stronger than
 * the banner's soft background (a film of the banner's ink over it, `--starci-core-alert-action`), its label is the banner's strong text colour (the tone's
 * soft foreground) at the button label weight (500), its shape Grammar's button pill. Never a white or neutral button on a tinted banner, never a solid
 * primary: `action`, `secondaryAction` and every one of `actions` are the `border` rank painted in that tint, so none is primary. An action with
 * `isDestructive` stays `danger`. The paint is the stylesheet's (`.starci-core-alert .starci-core-button`), so a Button an app places anywhere in a
 * banner takes it too.
 */
const alertActionVariant = (isDestructive: boolean, isLoading: boolean): "border" | "danger" => isDestructive && !isLoading ? "danger" : "border"

/** The press of an Alert button: a destination when it has `href`, else a command. */
const pressOf = (item: AlertPress): { readonly href: string } | { readonly onPress: () => void } => item.href === undefined ? { onPress: item.onAction } : { href: item.href }

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
 * Its buttons take the banner's tone (0.55.1): a fill one step stronger than the soft background, the tone's strong text at weight 500, Grammar's pill;
 * none is primary, `isDestructive` is `danger`. Several equal actions go in `actions`.
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
    const { title, description, tone: readyTone = "informative", leading, action, secondaryAction, actions, form, urgency, isLoading = false } = props
    if (actions !== undefined && (action !== undefined || secondaryAction !== undefined) && process.env.NODE_ENV !== "production") {
        throw new Error("Alert `actions` (several equal actions) cannot stand beside `action` or `secondaryAction`: pass one or the other.")
    }
    if (form !== undefined && action?.kind === "row" && process.env.NODE_ENV !== "production") {
        throw new Error("Alert `form` cannot stand in a banner whose action is kind=\"row\": the whole banner would be one press target around the fields.")
    }
    const ownsBusy = useRegionOwnsBusy()
    const tone: PresentationState | "accent" | CustomTone = isLoading ? "neutral" : readyTone
    const custom = useCustomTone(tone, ALERT_BUILT_IN_TONES)
    const meaning: PresentationState = tone === "accent" ? "informative" : isPresentationState(tone) ? tone : "neutral"
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
            {action === undefined && secondaryAction === undefined && (actions === undefined || actions.length === 0) && props.dismissLabel === undefined ? null : (
                <span className="starci-core-alert-actions" data-grammar-alert-actions="true" data-contract="FEEDBACK-2">
                    {secondaryAction === undefined ? null : (
                        <Button isLoading={isLoading} width="fill-narrow" size="sm" variant="border" {...pressOf(secondaryAction)}>{secondaryAction.label}</Button>
                    )}
                    {actions?.map((item, index) => (
                        <Button key={`${String(index)}:${item.label}`} isLoading={isLoading} width="fill-narrow" size="sm" variant="border" {...pressOf(item)}>{item.label}</Button>
                    ))}
                    {action === undefined ? null : action.kind === "row" ? (
                        <>
                            {action.href === undefined || isLoading
                                ? <button type="button" className="starci-core-alert-row-press" onClick={action.onAction} disabled={isLoading}><span className="starci-core-alert-row-press-label">{action.label}</span></button>
                                : <a className="starci-core-alert-row-press" href={action.href}><span className="starci-core-alert-row-press-label">{action.label}</span></a>}
                            <ChevronRightIcon aria-hidden="true" className="starci-core-alert-chevron" />
                        </>
                    ) : (
                        <Button isLoading={isLoading} width="fill-narrow" size="sm" variant={alertActionVariant(action.isDestructive === true, isLoading)} {...pressOf(action)}>{action.label}</Button>
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
 * Its buttons take the banner's tone (0.55.1): a fill one step stronger than the soft background, the tone's strong text at weight 500, Grammar's pill;
 * none is primary, `isDestructive` is `danger`. Several equal actions go in `actions`.
 * Below 30rem a `button` action stacks under the text, full width, in that same look; a dismiss stays beside the text.
 * Contract: root FEEDBACK-3 (status/alert urgency on the owner); actions FEEDBACK-2 (recovery in place).
 */
export const Alert = withRegionLoading(AlertInner)
