/**
 * The app declaration of a fixture: a product is one app repository whose hfs.json declares both sides, so a back-end fixture
 * declares its be side (`fields`: apps, optionalSlots, connections, reads) beside the smallest front end.
 */

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

const OTHER: Readonly<Record<"be" | "fe", SideDeclaration>> = { be: { apps: [{ name: "core", kind: "api" }] }, fe: { grammar: "core", apps: [{ name: "web", kind: "next" }] } }

/**
 * The app hfs.json of a fixture about `side`, beside the smallest other side.
 * @param side - The side the fixture is about.
 * @param fields - Its apps, optionalSlots, connections and reads.
 * @returns The app hfs.json object.
 */
export const appDeclaration = (side: "be" | "fe", fields: SideDeclaration): AppDeclaration => ({
    hfs: 3,
    kind: "app",
    project: "fixture",
    sides: { ...OTHER, [side]: { ...(side === "fe" ? { grammar: "core" } : {}), ...fields } },
})
