# Changelog

## 1.1.0 - 2026-10-28

- Changed: the source is TypeScript (`src/index.ts`, `export =`), built to CommonJS in `dist/` (`npm run build`; `prepack` builds) with the `@starci/tsconfig` `package-cjs.json` preset; the package ships `dist/index.js` and the emitted `dist/index.d.ts` instead of the hand-written `index.cjs` and `index.d.cts`. The config, the specifier (`@starci/prettier-config`) and its type (`import("prettier").Config`) are unchanged.
- Changed: the spec is `test/config.spec.ts`, run on the built `dist/` after `typecheck`.
