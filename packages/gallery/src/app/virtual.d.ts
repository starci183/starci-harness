declare module "virtual:starci-gallery/data" {
    const data: unknown
    export default data
}
declare module "virtual:starci-gallery/board" {
    import type { ComponentType } from "react"
    /** One lazy loader per board section that has its module: the module's default export draws the section in a named state. */
    export const sections: Readonly<Record<string, () => Promise<{ readonly default: ComponentType<{ readonly state: string }> }>>>
}
