import { cn } from "@heroui/react"
import type { ComponentPropsWithoutRef } from "react"

export type PageContainerProps = Omit<ComponentPropsWithoutRef<"div">, "className"> & {
    readonly measure?: "reading" | "narrow" | "product" | "full"
    /** Additional rule ids a composing branch already knows apply to this same element. */
    readonly ["data-contract"]?: string
}

/** Responsive page inset using the packaged StarCi measure scale, flush left: the measure limits the right edge only. */
/** What Page and PageHeader pass when they draw the container inside their own anatomy. */
export type PageContainerPartProps = PageContainerProps & { readonly className?: string | undefined }

/** Responsive page inset using the packaged StarCi measure scale, flush left: the measure limits the right edge only. */
export const PageContainerPart = ({ className, measure = "product", ...props }: PageContainerPartProps) => {
    const { "data-contract": composedContract, ...rest } = props
    return (
        <div
            {...rest}
            className={cn("starci-core-page-container", className)}
            data-contract={["MEASURE-1", composedContract].filter(Boolean).join(" ")}
            data-grammar-page-measure={measure}
            data-component="PageContainer"
            data-tier="frame"
        />
    )
}

/** Responsive page inset using the packaged StarCi measure scale, flush left: the measure limits the right edge only. */
export const PageContainer = (props: PageContainerProps) => <PageContainerPart {...props} />
