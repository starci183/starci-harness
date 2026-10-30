// Parsed-input boundary, by design: while the hand-written JavaScript moves to TypeScript one directory at a
// time, an import whose target is not a .mts source yet resolves here as `any`. Shorthand declarations, so a named
// import from an unconverted file is `any` too (a block with `export =` refuses named imports, TS2305). Removed when
// the last directory converts; from then on it would mask real type errors. Never shipped (not in package.json files).
declare module "*.mts";
declare module "*.mjs";
