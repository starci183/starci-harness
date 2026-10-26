/**
 * Runs `step` over `items` one after another, each only after the previous one finished, and returns the answers in order.
 * For work that must not overlap (git commands in one repository, probes that share a port, ledger writes that follow each
 * other); a step that throws ends the run and the later items are not started.
 */
export const inOrder = async <T, R>(items: readonly T[], step: (item: T, index: number) => Promise<R>): Promise<R[]> => {
    const answers: R[] = []
    await items.reduce<Promise<void>>(async (previous, item, index) => {
        await previous
        answers.push(await step(item, index))
    }, Promise.resolve())
    return answers
}
