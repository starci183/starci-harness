import {
    CheckCircleIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline"
import { toast as heroToast } from "@heroui/react"
import type { ReactNode } from "react"

/** The options a status toast takes: HeroUI's, minus the variant the status already names. */
type StatusToastOptions = Parameters<typeof heroToast.success>[1]

/** The one indicator of each status, from the app's one icon set; HeroUI's toast variant colours it through currentColor. */
const INDICATOR: Record<"success" | "danger" | "warning" | "info", ReactNode> = {
    success: <CheckCircleIcon className="size-6" />,
    danger: <XCircleIcon className="size-6" />,
    warning: <ExclamationTriangleIcon className="size-6" />,
    info: <InformationCircleIcon className="size-6" />,
}

/** The app's toast: HeroUI's, with the four status methods wrapped. */
type AppToast = typeof heroToast

/** The app's toast: HeroUI's imperative toast, callable as it is, with the four status methods wrapped to inject the status indicator; the region is mounted by the providers. */
export const toast: AppToast = Object.assign(
    (message: ReactNode, options?: Parameters<typeof heroToast>[1]) => heroToast(message, options),
    heroToast,
    {
        success: (message: ReactNode, options?: StatusToastOptions) =>
            heroToast.success(message, { indicator: INDICATOR.success, ...options }),
        danger: (message: ReactNode, options?: StatusToastOptions) =>
            heroToast.danger(message, { indicator: INDICATOR.danger, ...options }),
        warning: (message: ReactNode, options?: StatusToastOptions) =>
            heroToast.warning(message, { indicator: INDICATOR.warning, ...options }),
        info: (message: ReactNode, options?: StatusToastOptions) =>
            heroToast.info(message, { indicator: INDICATOR.info, ...options }),
    },
)
