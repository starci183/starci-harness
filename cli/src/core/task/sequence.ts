/**
 * Runs `each` over the items one after the other (never two at once) and returns the results in item order. The steps touch the
 * ledger, Orca or the work tree, so they must not overlap; a rejection ends the run and the later items are not started.
 */
export const mapInSequence = async <Item, Result>(items: readonly Item[], each: (item: Item) => Promise<Result>): Promise<Result[]> => {
    const results: Result[] = []
    await items.reduce<Promise<void>>(async (previous, item) => {
        await previous
        results.push(await each(item))
    }, Promise.resolve())
    return results
}
