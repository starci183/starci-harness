import type { ReactNode } from "react"
import { {{Name}} } from "@/features/layouts/{{Name}}"

type LayoutProps = { readonly children: ReactNode }

/** The {{segment}} segment's layout slot: it mounts {{Name}} around the routed page and nothing else. */
const Layout = (props: LayoutProps) => <{{Name}} content={props.children} />

export default Layout
