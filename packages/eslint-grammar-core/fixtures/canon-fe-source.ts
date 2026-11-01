/**
 * Resolves `@starci/eslint-canon-fe` to the sibling package's source for every spec process of this package.
 *
 * Why: `.npmrc` sets `install-links=true`, so `npm install` copies `file:../eslint-canon-fe` into `node_modules` as it stood when
 * installed. That copy is a snapshot taken before `dist/` is built (it is untracked), so it has no `dist/lib/*.js`: the
 * `exports` of `@starci/eslint-canon-fe/lib/*.mjs` point at files that are not there, and every spec that imports a canon
 * helper fails to load. The copy is also stale (a worktree carries the sibling's current source, not the installed one).
 * Reading the sibling source makes the specs run from any worktree with no build and no relink, and tests what the branch
 * holds rather than an old install.
 */
import { register } from "node:module"

register("./canon-fe-source-hooks.ts", import.meta.url)
