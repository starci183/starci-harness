/** The resolve hook behind `canon-fe-source.mjs`: `@starci/eslint-canon-fe` and its `lib/*.mjs` subpaths load from `../eslint-canon-fe/src`. */
const SIBLING = new URL("../../eslint-canon-fe/src/", import.meta.url)
const PREFIX = "@starci/eslint-canon-fe"

/** @type {import("node:module").ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === PREFIX) return { url: new URL("index.ts", SIBLING).href, shortCircuit: true }
  const lib = /^@starci\/eslint-canon-fe\/lib\/([\w-]+)\.(?:mjs|js)$/.exec(specifier)
  if (lib) return { url: new URL(`lib/${lib[1]}.ts`, SIBLING).href, shortCircuit: true }
  return nextResolve(specifier, context)
}
