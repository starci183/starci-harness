import type { EffectDeclaration } from "@modules/platform/effects"
import type { JobProgressDeclaration } from "./job-progress.port"

/** Fixture: the declaration of one job of a chain. */
export interface JobDefinition<P extends object> {
    readonly name: string
    readonly queue: string
    readonly ladder: "background" | "waited"
    readonly payload: (value: unknown) => value is P
    onceKey(payload: P): string
    readonly next: ReadonlyArray<string>
    readonly effects: ReadonlyArray<EffectDeclaration>
    readonly progress?: JobProgressDeclaration<P> | undefined
}

/** Fixture: declares a job. */
export const defineJob = <P extends object>(definition: JobDefinition<P>): JobDefinition<P> => Object.freeze(definition)
