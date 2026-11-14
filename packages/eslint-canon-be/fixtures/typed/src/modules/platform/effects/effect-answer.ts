import type { EffectDeclaration, Effects } from "./effects.port"

/** Fixture: a helper of the effects piece that makes one act through `Effects.once` and answers what the act answered. */
export const onceAnswered = async <T>(effects: Effects, key: string, effect: EffectDeclaration, act: () => Promise<T>): Promise<T> => {
    const made: { answer?: T } = {}
    await effects.once(key, effect, { act: async () => { made.answer = await act() } })
    return made.answer as T
}
