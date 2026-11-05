/**
 * The tones an app added to Core's built-in ones, empty until an app declares one. An app merges into it from "@starci/grammar/common", which
 * re-exports it: `declare module "@starci/grammar/common" { interface GrammarToneRegistry { info: true } }`. It lives in a module of its own, which
 * imports nothing, so a component that reads the app's tones (tones.ts) never reaches the renderers the common entry exports (the tier direction).
 */
// An empty interface is the point: it is the declaration an app's augmentation merges into.
export interface GrammarToneRegistry {}
