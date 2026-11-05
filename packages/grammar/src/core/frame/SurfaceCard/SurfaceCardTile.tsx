import { EllipsisHorizontalIcon } from "@heroicons/react/16/solid"
import { ButtonPlacementProvider } from "../../buttonIntent.js"
import { DropdownMenu } from "../../branch/DropdownMenu/index.js"
import { Avatar } from "../../leaf/Avatar/index.js"
import { Badge } from "../../leaf/Badge/index.js"
import { Button } from "../../leaf/Button/index.js"
import { IconButton } from "../../leaf/IconButton/index.js"
import { IconTile } from "../../leaf/IconTile/index.js"
import { Image } from "../../leaf/Image/index.js"
import { Label, type SurfaceHeadingLevel } from "../../leaf/Label/index.js"
import { SkeletonPlaceholder } from "../../leaf/Skeleton/index.js"
import type { BadgeData, ItemAction, TileData, TileMark, TilePoster } from "../../surfaceCardData.js"
import { tileClassName } from "./classNames.js"

const TileMarkView = ({ mark, isLoading }: { readonly mark: TileMark; readonly isLoading: boolean }) => {
    if (isLoading) return <span className="starci-core-tile-mark" data-grammar-tile-mark="skeleton"><SkeletonPlaceholder shape="block"><span className="starci-core-tile-mark-fill" /></SkeletonPlaceholder></span>
    if (mark.logo !== undefined) {
        return <span className="starci-core-tile-mark" data-grammar-tile-mark="logo"><Image src={mark.logo.src} alt={mark.logo.alt} aspect="square" fit="contain" plate="none" /></span>
    }
    if (mark.icon !== undefined) return <span className="starci-core-tile-mark" data-grammar-tile-mark="icon"><IconTile source={mark.icon} size="md" /></span>
    return <span className="starci-core-tile-mark" data-grammar-tile-mark="avatar"><Avatar {...mark.avatar} size="control" isDecorative /></span>
}

const TilePosterView = ({ poster, isLoading }: { readonly poster: TilePoster; readonly isLoading: boolean }) => (
    <div className="starci-core-tile-poster" data-grammar-tile-poster={poster.image === undefined ? "absent" : "image"} data-aspect={poster.aspect ?? "landscape"}>
        {isLoading ? (
            <SkeletonPlaceholder shape="region"><span className="starci-core-tile-poster-fill" /></SkeletonPlaceholder>
        ) : poster.image === undefined ? (
            <span className="starci-core-tile-poster-absence">{poster.absence}</span>
        ) : <Image {...poster.image} aspect={poster.aspect ?? "landscape"} fit={poster.fit ?? "cover"} />}
    </div>
)

const TileBadge = ({ badge, isLoading }: { readonly badge: BadgeData; readonly isLoading: boolean }) => (
    badge.isDot === true
        ? <Badge isDot tone={badge.tone ?? "neutral"} isLoading={isLoading}>{badge.label}</Badge>
        : <Badge tone={badge.tone ?? "neutral"} isLoading={isLoading}>{badge.label}</Badge>
)

const TileAction = ({ action, isLoading, isDisabled }: { readonly action: ItemAction; readonly isLoading: boolean; readonly isDisabled: boolean }) => (
    action.href === undefined
        ? <Button size="sm" intent={action.intent ?? "neutral"} isDisabled={isDisabled || action.isDisabled === true} isPending={action.isPending === true} isLoading={isLoading} onPress={action.press}>{action.label}</Button>
        : <Button size="sm" intent={action.intent ?? "neutral"} isDisabled={isDisabled || action.isDisabled === true} isPending={action.isPending === true} isLoading={isLoading} href={action.href}>{action.label}</Button>
)

/** The one tile face, shared by compact identities and media peers; the card shell owns its surface and busy region. */
export const SurfaceCardTile = ({ data, headingId, headingLevel, isLoading, isDisabled }: {
    readonly data: TileData
    readonly headingId: string
    readonly headingLevel: SurfaceHeadingLevel
    readonly isLoading: boolean
    readonly isDisabled: boolean
}) => (
    <div className={tileClassName} data-grammar-tile="true" data-grammar-tile-media={data.poster === undefined ? "false" : "true"}>
        {data.poster === undefined ? null : <TilePosterView poster={data.poster} isLoading={isLoading} />}
        {data.mark === undefined || data.poster !== undefined ? null : <TileMarkView mark={data.mark} isLoading={isLoading} />}
        <div className="starci-core-tile-copy" data-contract="GAP-1" data-grammar-tile-copy-beside-mark={data.mark !== undefined && data.poster === undefined ? "true" : undefined}>
            <Label as={`h${headingLevel}`} id={headingId} isLoading={isLoading}>{data.name}</Label>
            {data.byline === undefined ? null : (
                <span className="starci-core-tile-byline" data-grammar-tile-byline="true" data-contract="TONE-2 FONT-2">{isLoading ? <SkeletonPlaceholder>{data.byline}</SkeletonPlaceholder> : data.byline}</span>
            )}
            {data.badges === undefined ? null : (
                <span className="starci-core-tile-badges" data-contract="GAP-2">
                    {data.badges.map((badge) => <TileBadge key={badge.label} badge={badge} isLoading={isLoading} />)}
                </span>
            )}
            {data.description === undefined ? null : (
                <span className="starci-core-tile-description" data-contract="TONE-2 FONT-2">{isLoading ? <SkeletonPlaceholder>{data.description}</SkeletonPlaceholder> : data.description}</span>
            )}
            {data.facts === undefined ? null : (typeof data.facts === "string" ? [data.facts] : data.facts).map((line) => (
                <span key={line} className="starci-core-tile-description" data-grammar-tile-facts="true" data-contract="TONE-2 FONT-2">{isLoading ? <SkeletonPlaceholder>{line}</SkeletonPlaceholder> : line}</span>
            ))}
        </div>
        <ButtonPlacementProvider placement="item">
            <div className="starci-core-tile-foot" data-contract="GAP-2" {...(data.figure === undefined ? {} : { "data-grammar-tile-figure": "true" })}>
                {data.figure !== undefined
                    ? <span className="starci-core-tile-figure" data-grammar-tile-figure-value="true" data-contract="FONT-2">{isLoading ? <SkeletonPlaceholder>{data.figure}</SkeletonPlaceholder> : data.figure}</span>
                    : data.badge === undefined ? <span /> : <TileBadge badge={data.badge} isLoading={isLoading} />}
                <span className="starci-core-tile-actions" data-contract="GAP-2">
                    {data.action === undefined ? null : <TileAction action={data.action} isLoading={isLoading} isDisabled={isDisabled} />}
                    {data.menu === undefined ? null : (
                        <span className="starci-core-tile-menu">
                            {isLoading || isDisabled ? (
                                <IconButton label={data.menu.label} source={EllipsisHorizontalIcon} size="sm" intent="neutral" isLoading={isLoading} isDisabled={isDisabled} />
                            ) : (
                                <DropdownMenu
                                    placement="bottom end"
                                    entries={data.menu.entries}
                                    trigger={<IconButton label={data.menu.label} source={EllipsisHorizontalIcon} size="sm" intent="neutral" />}
                                />
                            )}
                        </span>
                    )}
                </span>
            </div>
        </ButtonPlacementProvider>
    </div>
)
