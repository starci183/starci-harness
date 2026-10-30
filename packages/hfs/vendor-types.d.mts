// Ambient types for the one runtime dependency that ships no wired declarations: libpg-query's package.json
// names only `main: wasm/index.cjs`, so `import pg from 'libpg-query'` resolves the CommonJS entry but TypeScript
// finds no .d.cts for it. This names its own wasm/index.d.ts surface as the module's shape, so callers get the
// real types the package ships rather than `any`.
declare module 'libpg-query' {
	const pg: typeof import('libpg-query/wasm/index.js')
	export = pg
}
