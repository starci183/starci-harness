/**
 * @starci/grammar/core/ext/markdown: one markdown pipeline built on Grammar core. This entry is isomorphic and holds no React: parse, the profiles, validate, the
 * compare split and the diagram key. `@starci/grammar/core/ext/markdown/react` draws, `@starci/grammar/core/ext/markdown/server` highlights with Shiki on the server and
 * `@starci/grammar/core/ext/markdown/prerender` turns mermaid into SVG at import time.
 */
export { parse, plainText, DIRECTIVE_NAMES, type ParseOptions } from "./parse.js"
export { PROFILES, PROFILE_NAMES, INLINE_CODE_MAX, profileOf, type Profile } from "./profiles.js"
export { validate, validateTree, isValid } from "./validate.js"
export { compareSegments, type CompareSegment } from "./compare.js"
export { diagramKey } from "./key.js"
export { readMeta, readLineList, type FenceMeta } from "./meta.js"
export type * from "./types.js"
