/** A run of a compared value: `changed` is the part that differs from the other side, which a compare tints. */
export interface CompareSegment { readonly text: string; readonly changed: boolean }

const run = (text: string, changed: boolean): CompareSegment[] => (text === "" ? [] : [{ text, changed }])

/**
 * Splits `expected` and `received` into what they share and what differs: the common start and the common end stay plain, the
 * middle of each side is `changed`. Equal values have no changed part.
 */
export const compareSegments = (expected: string, received: string): { readonly expected: CompareSegment[]; readonly received: CompareSegment[] } => {
    let head = 0
    const shortest = Math.min(expected.length, received.length)
    while (head < shortest && expected[head] === received[head]) head += 1
    let tail = 0
    while (tail < shortest - head && expected[expected.length - 1 - tail] === received[received.length - 1 - tail]) tail += 1
    const sides = (text: string): CompareSegment[] => [
        ...run(text.slice(0, head), false),
        ...run(text.slice(head, text.length - tail), true),
        ...run(text.slice(text.length - tail), false),
    ]
    return { expected: sides(expected), received: sides(received) }
}
