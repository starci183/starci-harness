/**
 * The key of a mermaid figure in `diagrams`: a 53-bit hash of its source text (cyrb53), so the same diagram gets the same key on the
 * importer, the server and the browser, with no crypto API.
 */
export const diagramKey = (code: string): string => {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let index = 0; index < code.length; index += 1) {
        const char = code.charCodeAt(index)
        h1 = Math.imul(h1 ^ char, 2654435761)
        h2 = Math.imul(h2 ^ char, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
    return `m${value.toString(36)}`
}
