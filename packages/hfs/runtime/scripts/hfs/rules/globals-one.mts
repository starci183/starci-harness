// globals-one.mts - R446: ONE GLOBAL STYLESHEET per web app. An app loads its CSS through exactly one globals entry, `src/app/globals.css`, which
// imports the Grammar stylesheet and the brand file; no route group, layout or component loads another stylesheet, so the marketing site and the
// console of one app share the same global CSS (contexts/code/fe/ui.md FE-CSS-4). Per `apps/<app>` of the front end (side-relative paths):
//   FE_GLOBALS_NOT_ONE         a tracked `.css` file under the app's `src/` besides `app/globals.css` and `modules/brand/brand.css` (a second global
//                              sheet, such as a `site.css` of a route group), or a TypeScript file of the app that imports a stylesheet other than
//                              `globals.css` (the brand file is imported by the globals, never by a layout or a module).
//   FE_GLOBALS_IMPORTS_MISSING an app with a route tree has no `src/app/globals.css`, or its globals `@import`s no Grammar stylesheet
//                              (`@starci/grammar/...`) or no `modules/brand/brand.css`.
// R61 (stylelint `globals-shape`, `globals-import-order`) judges what the globals hold; this rule judges that there is one and that it is the only door.
import path from 'node:path';
import { found, readText } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

export const FE_GLOBALS_NOT_ONE = 'FE_GLOBALS_NOT_ONE';
export const FE_GLOBALS_IMPORTS_MISSING = 'FE_GLOBALS_IMPORTS_MISSING';
const RULE = '(R446, contexts/code/fe/ui.md FE-CSS-4)';
const posix = path.posix;
/** The only stylesheets an app's source holds: its globals entry and its brand file. */
const GLOBALS = 'src/app/globals.css';
const BRAND = 'src/modules/brand/brand.css';
/** A stylesheet import of a TypeScript file: `import "./x.css"`, `import x from "./x.css"`, `import("./x.css")`; a `.module.css` is R61's `no-css-module`. */
const CSS_IMPORT = /(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](?<from>[^'"]+\.css)['"]/gu;
const CSS_AT_IMPORT = /@import\s+(?:url\(\s*)?['"]?(?<from>[^'")\s;]+)/gu;
const SOURCE = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/u;
const GRAMMAR_CSS = /^@starci\/grammar\//u;
const BRAND_CSS = /(?:^|\/)modules\/brand\/brand\.css$/u;

/** The `@import` specifiers of a stylesheet, in order. */
export const atImports = (css: string): string[] => [...css.matchAll(CSS_AT_IMPORT)].map((match) => match.groups?.['from'] ?? '');

/** The brand file an app's globals import (side-relative), or null when it imports none. */
export function importedBrand(globalsFile: string, css: string): string | null {
  const specifier = atImports(css).find((from) => BRAND_CSS.test(from));
  if (specifier === undefined) return null;
  return specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(globalsFile), specifier)) : specifier;
}

/** FE_GLOBALS_NOT_ONE and FE_GLOBALS_IMPORTS_MISSING over the web apps of a front end. */
export function globalsOneFindings({ files = [], repo, repoRoot, isRoot = false, inScope = () => true }: { files?: readonly string[]; repo: Repo; repoRoot: string; isRoot?: boolean; inScope?: (file: string) => boolean }): Finding[] {
  if (isRoot || repo?.profile !== 'fe' || !['lite', 'full'].includes(repo.edition ?? 'full')) return [];
  const tracked = [...new Set(files.map((file) => file.replaceAll('\\', '/')))].sort();
  const apps = new Set(tracked.flatMap((file) => (/^(?<app>apps\/[^/]+)\/src\/app\//u.exec(file)?.groups?.['app'] ?? [])));
  const findings: Finding[] = [];
  for (const app of [...apps].sort()) {
    const globals = `${app}/${GLOBALS}`;
    const own = tracked.filter((file) => file.startsWith(`${app}/src/`));
    for (const file of own) {
      if (file.endsWith('.css') && !file.endsWith('.module.css') && file !== globals && !file.endsWith(`/${BRAND}`) && inScope(file)) {
        findings.push(found(FE_GLOBALS_NOT_ONE, file, `${file} is a second global stylesheet: ${app} loads its CSS through one entry, ${globals}, which imports the Grammar stylesheet and the brand file; a route group, a layout or a component never carries its own sheet. Move its tokens into the brand file and its styling into Grammar utilities ${RULE}`, { app }));
      }
      if (!SOURCE.test(file) || file.endsWith('.d.ts') || !inScope(file)) continue;
      const text = readText(repoRoot, file) ?? '';
      for (const match of text.matchAll(CSS_IMPORT)) {
        const from = match.groups?.['from'] ?? '';
        if (from.endsWith('.module.css')) continue;
        const resolved = from.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), from)) : from.startsWith('@/') ? posix.join(app, 'src', from.slice(2)) : from;
        if (resolved === globals) continue;
        findings.push(found(FE_GLOBALS_NOT_ONE, file, `${file} imports the stylesheet ${from}: the only stylesheet an app's code imports is ${globals} (the root layout), which imports the Grammar stylesheet and the brand file ${RULE}`, { app, stylesheet: from }));
      }
    }
    if (!inScope(globals)) continue;
    const css = readText(repoRoot, globals);
    if (css === null) {
      findings.push(found(FE_GLOBALS_IMPORTS_MISSING, globals, `${app} has a route tree and no ${globals}: its one global stylesheet imports the Grammar stylesheet and the brand file ${RULE}`, { app }));
      continue;
    }
    const imports = atImports(css);
    if (!imports.some((from) => GRAMMAR_CSS.test(from))) findings.push(found(FE_GLOBALS_IMPORTS_MISSING, globals, `${globals} imports no Grammar stylesheet (\`@import "@starci/grammar/<family>.css"\`): the one global sheet carries the Grammar's CSS ${RULE}`, { app }));
    if (!imports.some((from) => BRAND_CSS.test(from))) findings.push(found(FE_GLOBALS_IMPORTS_MISSING, globals, `${globals} imports no brand file (\`@import "../modules/brand/brand.css"\`): the one global sheet carries the app's brand tokens, so every route group reads the same colours ${RULE}`, { app }));
  }
  return findings;
}
