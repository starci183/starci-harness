# @starci/tsconfig

Seven TypeScript configs, all strict, all with `noImplicitAny`, and every strictness flag in `base.json` so that no preset (back end, front end, overlay) is looser than another. Install it from the npm registry at the exact version in the StarCi runtime's `knowledge/stack/pins.yaml` (see [`packages/README.md`](../README.md)).

| File | For | Adds to `base.json` |
|---|---|---|
| `base.json` | anything | `strict`, `noImplicitAny`, `strictNullChecks`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `allowUnusedLabels: false`, `isolatedModules`, `esModuleInterop`, `resolveJsonModule`, `skipLibCheck` |
| `be.json` | back end | `allowJs: false`, decorators and decorator metadata, `nodenext` module and resolution (CommonJS output, since a back end has no `"type": "module"`), ES2023, `noEmit` |
| `build.json` | back-end emit | `be.json` with `noEmit: false` |
| `next.json` | front-end app | `esnext` + `bundler`, `react-jsx`, DOM libs, `noEmit`, the `next` plugin |
| `e2e.json` | e2e typecheck overlay | `noEmit`, no incremental, no declarations |
| `package-esm.json` | a package built to `dist/` (ES modules) | `nodenext`, ES2023, `types: ["node"]`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`, declarations, `rootDir` `${configDir}/src`, `outDir` `${configDir}/dist` |
| `package-cjs.json` | a package built to `dist/` that jest or prettier loads with `require` | `package-esm.json` with `verbatimModuleSyntax` and `erasableSyntaxOnly` off, so a source writes `export =` and ES imports that compile to `require` |

`skipLibCheck` is the one flag that is on by design: checking the declaration files of `node_modules` reports errors in third-party typings (a package whose optional peer is absent, a `@types` package that assumes the DOM library) that no repository can fix. It lives only in `base.json`; no repository config restates it.

None of them sets `outDir`, `rootDir`, `baseUrl`, `paths`, `include` or `exclude`: TypeScript resolves those against the file
that declares them, so a shared file would point inside `node_modules`. The repository owns them, and for a back end the
repository owns exactly one of them, `paths`. The one exception is the two package presets: their `rootDir` and `outDir`
are written `${configDir}/src` and `${configDir}/dist`, which TypeScript (5.5 and later) resolves against the config that
extends the preset, so they never point inside `node_modules`. The package presets need TypeScript 5.8 or later
(`erasableSyntaxOnly`); the convention they serve is the build section of [`packages/README.md`](../README.md).

A back-end `tsconfig.json` is a managed file (`starci app sync` renders it, `starci app check` compares it, HFS_TS_STRICT names any flag it
lowers): the preset and the three aliases, nothing else.

```jsonc
// tsconfig.json (back end)
{
  "extends": "@starci/tsconfig/be.json",
  "compilerOptions": { "paths": { "@features/*": ["./src/features/*"], "@modules/*": ["./src/modules/*"], "@tests/*": ["./src/tests/*"] } }
}
```

`tsconfig.build.json` and `tsconfig.e2e.json` are managed too. They put an overlay preset after the repository config (TypeScript 5
`extends` array; later wins) and carry only the path-relative options a preset cannot hold (`outDir`, `include`, `exclude`).

```jsonc
// tsconfig.e2e.json
{ "extends": ["./tsconfig.json", "@starci/tsconfig/e2e.json"], "include": ["src/tests/e2e/**/*.ts"] }
```

`test:e2e` must be `npm run typecheck:e2e && jest --selectProjects e2e`: jest runs with `diagnostics: false`, so this
config is the one place e2e types are checked.
