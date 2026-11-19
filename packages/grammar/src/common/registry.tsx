"use client"

import {
    Badge, Button, CalendarDay, Code, MessageBubble, MessageCard, MessageStatus, PaneGrid, Pane, PaneSection, PaneHeader, PaneDrawerOpener, PageIntro, Inset, DisclosureList, PrimaryRailLayout, Board, ScheduleGrid, BarChart, Sparkline, ProportionBar, ChoiceChips, Divider, Sublabel, EmptyNotice, FencedCodeBlock, Freestyle, Custom, GrammarRoot,
    EntryFrame, Heading, HorizontalScrollRegion, Icon, IconButton, IconTile, Input,
    Markdown, MarkdownArticle, MarkdownTableFrame, Mascot, MediaFrame,
    NavLandmark, OtpInput, Page, PinnedActionBar, PressableField,
    Progress, Quote, RelativeTime, Section, Sidebar, StateMark, StatusDot,
    Stack, Cluster, Grid, Reveal, Marquee, CountUp, ExpandableText, StickyStory,
    SurfaceCard, Tabs, Terminal, Text,
    TextAction, Tooltip, VerticalScrollRegion, WorkspaceShell,
} from "./renderers.js"
import { FunnelChart, IntervalChart, Legend } from "./renderers.js"
import { COMMON_FORMS_COMPONENTS } from "./renderers-forms.js"
import { COMMON_OVERLAYS_COMPONENTS } from "./renderers-overlays.js"
import { COMMON_NAVIGATION_COMPONENTS } from "./renderers-navigation.js"
import { COMMON_SHELL_COMPONENTS } from "./renderers-shell.js"
import type { ComponentProps, ComponentType, ElementType } from "react"

export type GrammarComponentRenderer<Props> = ComponentType<Props>
type GrammarRendererRegistry = Readonly<Record<string, ElementType>>
type CompatibleReplacements<Common extends GrammarRendererRegistry> = {
    readonly [Name in keyof Common]?: GrammarComponentRenderer<ComponentProps<Common[Name]>>
}
type ExtensionWithoutCommonCollisions<Common extends GrammarRendererRegistry, Extensions extends GrammarRendererRegistry> =
    Extensions & { readonly [Name in Extract<keyof Extensions, keyof Common>]: never }

export const COMMON_GRAMMAR_COMPONENTS = Object.freeze({
    IntervalChart, FunnelChart, Legend,
    Badge, Button, CalendarDay, Code, MessageBubble, MessageCard, MessageStatus, PaneGrid, Pane, PaneSection, PaneHeader, PaneDrawerOpener, PageIntro, Inset, DisclosureList, PrimaryRailLayout, Board, ScheduleGrid, BarChart, Sparkline, ProportionBar, ChoiceChips, Divider, Sublabel, EmptyNotice, FencedCodeBlock, Freestyle, Custom, GrammarRoot,
    EntryFrame, Heading, HorizontalScrollRegion, Icon, IconButton, IconTile, Input,
    Markdown, MarkdownArticle, MarkdownTableFrame, Mascot, MediaFrame,
    NavLandmark, OtpInput, Page, PinnedActionBar, PressableField,
    Progress, Quote, RelativeTime, Section, Sidebar, StateMark, StatusDot,
    Stack, Cluster, Grid, Reveal, Marquee, CountUp, ExpandableText, StickyStory,
    SurfaceCard, Tabs, Terminal, Text,
    TextAction, Tooltip, VerticalScrollRegion, WorkspaceShell,
    ...COMMON_FORMS_COMPONENTS,
    ...COMMON_OVERLAYS_COMPONENTS,
    ...COMMON_NAVIGATION_COMPONENTS,
    ...COMMON_SHELL_COMPONENTS,
} as const)
export type CommonGrammarComponentName = keyof typeof COMMON_GRAMMAR_COMPONENTS

export type GrammarFamilyStyles<FamilyId extends string> = {
    readonly entrypoint: `@starci/grammar/${string}/styles.css`
    readonly scope: { readonly attribute: "data-grammar-family"; readonly value: FamilyId }
}

export type GrammarFamilyContract<FamilyId extends string, Extensions extends GrammarRendererRegistry> = {
    readonly id: FamilyId
    readonly styles: GrammarFamilyStyles<FamilyId>
    readonly components: Readonly<typeof COMMON_GRAMMAR_COMPONENTS & Extensions>
    readonly scopeProps: Readonly<{ "data-grammar-family": FamilyId }>
}

/** Define one visual family over the stable Common semantic contract. */
export const defineGrammarFamily = <
    const FamilyId extends string,
    const Replacements extends CompatibleReplacements<typeof COMMON_GRAMMAR_COMPONENTS>,
    const Extensions extends GrammarRendererRegistry,
>(definition: {
    readonly id: FamilyId
    readonly styles: GrammarFamilyStyles<FamilyId>
    readonly components: {
        readonly replacements: Replacements
        readonly extensions: ExtensionWithoutCommonCollisions<typeof COMMON_GRAMMAR_COMPONENTS, Extensions>
    }
}): GrammarFamilyContract<FamilyId, Extensions> => {
    if (definition.styles.scope.value !== definition.id) {
        throw new TypeError("Grammar family CSS scope must match the family id")
    }
    for (const name of Object.keys(definition.components.replacements)) {
        if (!(name in COMMON_GRAMMAR_COMPONENTS)) throw new TypeError(`Cannot replace unknown Common component: ${name}`)
    }
    for (const name of Object.keys(definition.components.extensions)) {
        if (name in COMMON_GRAMMAR_COMPONENTS) throw new TypeError(`Grammar extension collides with Common component: ${name}`)
    }
    const mergedComponents: Record<string, ElementType> = {}
    Object.assign(
        mergedComponents,
        COMMON_GRAMMAR_COMPONENTS,
        definition.components.replacements,
        definition.components.extensions,
    )
    return Object.freeze({
        id: definition.id,
        styles: Object.freeze({ entrypoint: definition.styles.entrypoint, scope: Object.freeze({ ...definition.styles.scope }) }),
        components: Object.freeze(mergedComponents) as unknown as Readonly<typeof COMMON_GRAMMAR_COMPONENTS & Extensions>,
        scopeProps: Object.freeze({ "data-grammar-family": definition.id }),
    })
}
