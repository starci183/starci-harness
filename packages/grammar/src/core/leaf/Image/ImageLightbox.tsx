"use client"

import { Modal as HeroModal } from "@heroui/react"
import { IconButton } from "../IconButton/index.js"
import { resolveTriggerlessOpenProps, useOverlayContainer } from "../../overlayScope.js"

export type ImageLightboxProps = {
    readonly isOpen: boolean
    readonly onOpenChange: (isOpen: boolean) => void
    readonly title: string
    readonly closeLabel: string
    readonly src: string
    readonly srcSet: string | undefined
    readonly sizes?: string
    readonly alt: string
}

/**
 * The enlarged picture of an `Image` with `zoom`: a modal over the page on the Grammar's overlay backdrop (the Dialog's
 * mechanics: focus trap and return, Escape and an outside press dismiss, page scroll locked, the portal inside the
 * nearest Grammar root). It holds the picture and one dismiss control, never a card or a form.
 */
export const ImageLightbox = ({ isOpen, onOpenChange, title, closeLabel, src, srcSet, sizes, alt }: ImageLightboxProps) => {
    const { anchor, container } = useOverlayContainer("ImageLightbox")
    return (
        <>
            {anchor}
            {container === null ? null : (
                <HeroModal.Backdrop
                    UNSTABLE_portalContainer={container}
                    isDismissable
                    data-grammar-overlay-backdrop="ImageLightbox"
                    className="starci-core-overlay-backdrop"
                    {...resolveTriggerlessOpenProps(undefined, { isOpen, onOpenChange })}
                >
                    <HeroModal.Container placement="center" size="full" scroll="inside" data-size="full" data-contract="MOTION-2" className="starci-core-lightbox-container">
                        <HeroModal.Dialog
                            aria-label={title}
                            data-tier="leaf"
                            data-component="ImageLightbox"
                            data-grammar-overlay-surface="lightbox"
                            data-contract="FOCUS-3 LAYOUT-4"
                            className="starci-core-lightbox"
                        >
                            {({ close }) => (
                                <>
                                    <span className="starci-core-lightbox-close"><IconButton intent="dismiss" label={closeLabel} onPress={close} /></span>
                                    <img
                                        alt={alt}
                                        className="starci-core-lightbox-image"
                                        decoding="async"
                                        src={src}
                                        {...(srcSet === undefined ? {} : { srcSet })}
                                        sizes={sizes ?? "100vw"}
                                    />
                                </>
                            )}
                        </HeroModal.Dialog>
                    </HeroModal.Container>
                </HeroModal.Backdrop>
            )}
        </>
    )
}
