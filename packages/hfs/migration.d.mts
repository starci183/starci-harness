// Parsed-input boundary, by design: while the hand-written JavaScript moves to TypeScript one directory at a
// time, an import whose target is not a .mts source yet resolves here as `any`. Removed when the last directory
// converts; from then on it would mask real type errors. Never shipped (not in package.json files).
declare module "*.mts" {
	const unconverted: any
	export = unconverted
}
declare module "*.mjs" {
	const unconverted: any
	export = unconverted
}
