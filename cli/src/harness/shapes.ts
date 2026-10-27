/**
 * The shape-slot law across files (contexts/code/fe function.md FE-FUNCTION-2, README "Data status of a region"): every
 * member of a unit's `XShape` union is drawn by a story whose args set `shape` to it, every `DataSlot` field of a pure
 * half's `props` is drawn loading by a story (the skeleton story, built from the slot's placeholder by SlotView), no
 * story names a shape its unit's union lacks, and no story sets the retired `state` key (owner ruling 2026-10-28: the
 * input is `shape`, the union `XShape`). This file holds the model and the verdict; shapes-parse.ts reads the source.
 */

/** A value of a story's args as far as reading the source without running it can tell. */
export type StaticValue =
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "boolean"; readonly value: boolean }
    | { readonly kind: "object"; readonly entries: ReadonlyMap<string, StaticValue> }
    /** A call of the slot owner's `loadingSlot(...)`: a slot in its loading status. */
    | { readonly kind: "loading" }
    /** An identifier that names no constant of the file: an import, such as the story's component. */
    | { readonly kind: "ref"; readonly name: string }
    | { readonly kind: "opaque" }

/** One place in the scanned source: a path relative to the app root, `/`-separated, and a 1-based line. */
export interface SourcePlace {
    readonly file: string
    readonly line: number
}

/** One member of an `XShape` union. */
export interface ShapeMember extends SourcePlace {
    readonly name: string
}

/** An exported `XShape` of a pure half or of modules/types: the drawn shapes of unit X. */
export interface ShapeUnion extends SourcePlace {
    readonly unit: string
    /** The alias as exported: `XShape`, or the retired `XState` of a pure half. */
    readonly name: string
    /** True when the pure half still exports the retired `XState` name; the union is then red, not read as an alias. */
    readonly renamed: boolean
    readonly members: readonly ShapeMember[]
    /** Members the reader could not take as string literals; the union is then not a shape vocabulary. */
    readonly unliteral: readonly SourcePlace[]
}

/** One `DataSlot<T>` field in the `props` of a pure half's `XBaseProps`. */
export interface SlotField extends SourcePlace {
    readonly name: string
}

/** A pure half's contract: the unit and the data slots its `props` carries. */
export interface BaseContract extends SourcePlace {
    readonly unit: string
    readonly slots: readonly SlotField[]
}

/** One story export of a CSF file, its args merged over the meta's. */
export interface StoryArgs extends SourcePlace {
    readonly story: string
    /** The unit its meta's `component` draws (`XBase` and `X` both name X), or null when the meta names none. */
    readonly unit: string | null
    readonly args: StaticValue
}

/** Why the shape-slot check is red. */
export type StoriesCode =
    | "STORY_SHAPE_MISSING"
    | "STORY_SKELETON_MISSING"
    | "STORY_SHAPE_UNKNOWN"
    | "STORY_SHAPE_UNREAD"
    | "STORY_STATE_RENAMED"
    | "SHAPE_UNION_NOT_LITERAL"
    | "SHAPE_UNION_RENAMED"

/** One red finding, at the line that owns it. */
export interface StoriesFinding extends SourcePlace {
    readonly code: StoriesCode
    readonly unit: string
    readonly message: string
}

/** What one front-end app holds for the check. */
export interface AppShapes {
    readonly root: string
    readonly unions: readonly ShapeUnion[]
    readonly bases: readonly BaseContract[]
    readonly stories: readonly StoryArgs[]
}

/** The entry `key` of an object value, if the value is an object that has it. */
export const entryOf = (value: StaticValue | undefined, key: string): StaticValue | undefined =>
    value?.kind === "object" ? value.entries.get(key) : undefined

/** Story args merge over meta args the way Storybook combines them: plain objects deeply, anything else replaced. */
export const mergeValues = (base: StaticValue | undefined, over: StaticValue | undefined): StaticValue | undefined => {
    if (over === undefined) return base
    if (base?.kind !== "object" || over.kind !== "object") return over
    const entries = new Map(base.entries)
    for (const [key, value] of over.entries) entries.set(key, mergeValues(entries.get(key), value) ?? value)
    return { kind: "object", entries }
}

/** A slot value in its loading status: `loadingSlot(...)` or an object whose `isLoading` is `true`. */
const isLoadingSlot = (value: StaticValue | undefined): boolean => {
    if (value?.kind === "loading") return true
    const flag = entryOf(value, "isLoading")
    return flag?.kind === "boolean" && flag.value
}

/** The unit a component identifier draws: `XBase` is the pure half of X. */
export const unitOfComponent = (name: string): string => (name.endsWith("Base") && name.length > "Base".length ? name.slice(0, -"Base".length) : name)

const finding = (code: StoriesCode, unit: string, place: SourcePlace, message: string): StoriesFinding => ({ code, unit, file: place.file, line: place.line, message })

const storiesOf = (app: AppShapes, unit: string): readonly StoryArgs[] => app.stories.filter((story) => story.unit === unit)

/** Every member of every union has a story that sets `shape` to it; a union of anything but string literals is red. */
const shapeFindings = (app: AppShapes): StoriesFinding[] =>
    app.unions.flatMap((union) => {
        if (union.renamed) return [finding("SHAPE_UNION_RENAMED", union.unit, union, `${union.name} is the retired name of the drawn shapes: rename it ${union.unit}Shape and the pure half's state input shape (owner ruling 2026-10-28)`)]
        const drawn = new Set(storiesOf(app, union.unit).flatMap((story) => {
            const shape = entryOf(story.args, "shape")
            return shape?.kind === "string" ? [shape.value] : []
        }))
        const unliteral = union.unliteral.map((place) => finding("SHAPE_UNION_NOT_LITERAL", union.unit, place, `${union.unit}Shape has a member that is not a string literal; a shape vocabulary is a string-literal union (FE-TYPING-2)`))
        const missing = union.members.filter((member) => !drawn.has(member.name)).map((member) =>
            finding("STORY_SHAPE_MISSING", union.unit, member, `shape "${member.name}" of ${union.unit}Shape has no story whose args set shape: "${member.name}"`))
        return [...unliteral, ...missing]
    })

/** Every `DataSlot` field of a pure half's props is loading in at least one story: the skeleton story drawn from its placeholder. */
const skeletonFindings = (app: AppShapes): StoriesFinding[] =>
    app.bases.flatMap((base) => {
        const stories = storiesOf(app, base.unit)
        return base.slots
            .filter((slot) => !stories.some((story) => isLoadingSlot(entryOf(entryOf(story.args, "props"), slot.name))))
            .map((slot) => finding("STORY_SKELETON_MISSING", base.unit, slot, `slot ${slot.name} of ${base.unit}Base is never drawn loading: add the skeleton story (args.props.${slot.name}: loadingSlot(), or isLoading: true)`))
    })

/** A story that still sets the retired `state` key: no alias, the key is renamed. */
const renamedFindings = (app: AppShapes): StoriesFinding[] =>
    app.stories.flatMap((story) =>
        entryOf(story.args, "state") === undefined
            ? []
            : [finding("STORY_STATE_RENAMED", story.unit ?? "(no component)", story, `story ${story.story} sets state, the retired name of a pure half's shape input: rename args.state to args.shape (owner ruling 2026-10-28)`)],
    )

/** Every shape a story names is a member of its unit's union, and readable as one. */
const strayFindings = (app: AppShapes): StoriesFinding[] =>
    app.stories.flatMap((story) => {
        const shape = entryOf(story.args, "shape")
        if (shape === undefined) return []
        const unit = story.unit ?? "(no component)"
        if (shape.kind !== "string") return [finding("STORY_SHAPE_UNREAD", unit, story, `story ${story.story} sets shape to something that is not a string literal; name the shape literally`)]
        const members = app.unions.filter((union) => union.unit === story.unit && !union.renamed).flatMap((union) => union.members.map((member) => member.name))
        if (members.includes(shape.value)) return []
        const known = members.length === 0 ? `${unit} exports no ${unit}Shape union` : `${unit}Shape is ${members.map((member) => `"${member}"`).join(" | ")}`
        return [finding("STORY_SHAPE_UNKNOWN", unit, story, `story ${story.story} sets shape: "${shape.value}", which is no shape of ${unit}: ${known}`)]
    })

/** The findings of one app, in file and line order. */
export const judgeShapes = (app: AppShapes): StoriesFinding[] =>
    [...shapeFindings(app), ...skeletonFindings(app), ...strayFindings(app), ...renamedFindings(app)].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
