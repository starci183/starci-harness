/** The declared contract of ./app.mjs: the app hfs.json of a fixture about one side. */

/** One side of an app declaration: its apps, connections, optional slots, reads and any other declared field. */
export interface SideDeclaration {
    readonly apps?: readonly { readonly name: string; readonly kind: string }[]
    readonly connections?: readonly { readonly name: string; readonly envPrefix: string; readonly owner?: string; readonly isolation?: string }[]
    readonly [field: string]: unknown
}

/** An app hfs.json object. */
export interface AppDeclaration {
    readonly hfs: number
    readonly kind: string
    readonly project: string
    readonly sides: Readonly<Record<string, SideDeclaration>>
    readonly [field: string]: unknown
}

/** The app hfs.json of a fixture about `side`, beside the smallest other side. */
export declare const appDeclaration: (side: "be" | "fe", fields: SideDeclaration) => AppDeclaration
