import type { ResolveHook } from "node:module"

/** The resolve hook behind `canon-fe-source.ts`: `@starci/eslint-canon-fe` and its `lib/*.mjs` subpaths load from `../eslint-canon-fe/src`. */
const SIBLING = new URL("../../eslint-canon-fe/src/", import.meta.url)
const PREFIX = "@starci/eslint-canon-fe"

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
  if (specifier === PREFIX) return { url: new URL("index.ts", SIBLING).href, shortCircuit: true }
  const lib = /^@starci\/eslint-canon-fe\/lib\/([\w-]+)\.(?:mjs|js)$/.exec(specifier)
  if (lib) return { url: new URL(`lib/${lib[1]}.ts`, SIBLING).href, shortCircuit: true }
  return nextResolve(specifier, context)
}
