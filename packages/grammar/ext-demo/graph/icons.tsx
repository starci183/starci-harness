import type { ReactElement, SVGProps } from "react"

/** Outline subject icons for the demo (24px grid, 2px stroke), passed to the nodes through their `icon` slot as an app would pass its own. */
/** Like any icon set an app passes (Heroicons), each icon takes the props Grammar's Icon hands it (its class, aria-hidden). */
const Icon = ({ children, ...props }: SVGProps<SVGSVGElement> & { readonly children: ReactElement | readonly ReactElement[] }): ReactElement => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        {children}
    </svg>
)

export const PhoneIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </Icon>
)
export const ClockIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
    </Icon>
)
export const CalendarIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M4 11h16" />
    </Icon>
)
export const BoltIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </Icon>
)
export const MailIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
    </Icon>
)
export const UserIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
)
export const ChatIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12" />
    </Icon>
)
export const TruckIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
    </Icon>
)
export const BoxIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </Icon>
)
export const CardIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M7 15h3" />
    </Icon>
)
export const DocIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />
    </Icon>
)
export const BellIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
    </Icon>
)
export const FlagIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <path d="M5 21V4h12l-2 4 2 4H5" />
    </Icon>
)
export const SearchIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
    </Icon>
)
export const BranchIcon = (props: SVGProps<SVGSVGElement>): ReactElement => (
    <Icon {...props}>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="9" r="2" />
        <path d="M6 7v10M18 11c0 4-6 3-12 6" />
    </Icon>
)
