// Overlay and feedback renderers added to the Common contract (conflict-free component-lane layout).
// Every overlay portals into the nearest `.grammar-common-root`, so each visual family's scope still
// applies to it; see `src/core/overlayScope.tsx`.
import { AlertDialog } from "../core/frame/AlertDialog/index.js"
import { Dialog } from "../core/frame/Dialog/index.js"
import { Drawer } from "../core/frame/Drawer/index.js"
import { DropdownMenu } from "../core/branch/DropdownMenu/index.js"
import { Popover } from "../core/frame/Popover/index.js"
import { Toast, Toaster } from "../core/composite/Toast/index.js"
import { Alert } from "../core/composite/Alert/index.js"
import { CloseButton } from "../core/leaf/CloseButton/index.js"
import { Kbd } from "../core/leaf/Kbd/index.js"
import { Meter } from "../core/leaf/Meter/index.js"
import { ProgressCircle } from "../core/leaf/ProgressCircle/index.js"
import { Skeleton } from "../core/leaf/Skeleton/index.js"
import { Spinner } from "../core/leaf/Spinner/index.js"

export { AlertDialog, type AlertDialogProps } from "../core/frame/AlertDialog/index.js"
export { Dialog, type DialogProps, type DialogSize, type OverlayFooter } from "../core/frame/Dialog/index.js"
export { Drawer, type DrawerPlacement, type DrawerProps } from "../core/frame/Drawer/index.js"
export {
    DropdownMenu,
    type DropdownMenuEntry,
    type DropdownMenuItem,
    type DropdownMenuItemTone,
    type DropdownMenuPlacement,
    type DropdownMenuProps,
    type DropdownMenuSection,
    type DropdownMenuSelection,
} from "../core/branch/DropdownMenu/index.js"
export { Popover, type PopoverPlacement, type PopoverProps } from "../core/frame/Popover/index.js"
export {
    DEFAULT_TOAST_TIMEOUT,
    Toast,
    Toaster,
    createToastQueue,
    toastQueue,
    toastTimeoutFor,
    type ToastAction,
    type ToasterPlacement,
    type ToasterProps,
    type ToastOptions,
    type ToastProps,
    type ToastQueue,
    type ToastRecord,
} from "../core/composite/Toast/index.js"
export { Alert, type AlertAction, type AlertAppearance, type AlertProps, type AlertUrgency } from "../core/composite/Alert/index.js"
export { CloseButton, type CloseButtonProps, type CloseButtonSize } from "../core/leaf/CloseButton/index.js"
export { KBD_NAMED_KEYS, Kbd, type KbdNamedKey, type KbdProps } from "../core/leaf/Kbd/index.js"
export { Meter, type MeterProps, type MeterSegments, type MeterSize } from "../core/leaf/Meter/index.js"
export { ProgressCircle, type ProgressCircleProps, type ProgressCircleSize } from "../core/leaf/ProgressCircle/index.js"
export { Skeleton, type SkeletonProps, type SkeletonRatio, type SkeletonShape, type SkeletonSize } from "../core/leaf/Skeleton/index.js"
export { Spinner, type SpinnerProps, type SpinnerSize, type SpinnerTone } from "../core/leaf/Spinner/index.js"
export { GRAMMAR_ROOT_SELECTOR, resolveOverlayContainer, type OverlayOpenState } from "../core/overlayScope.js"

/** Overlay and feedback renderers merged into `COMMON_GRAMMAR_COMPONENTS`. */
export const COMMON_OVERLAYS_COMPONENTS = Object.freeze({
    Alert, AlertDialog, CloseButton, Dialog, Drawer, DropdownMenu, Kbd, Meter, Popover,
    ProgressCircle, Skeleton, Spinner, Toast, Toaster,
} as const)
