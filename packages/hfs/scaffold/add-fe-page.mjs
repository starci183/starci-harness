// starci app add page <route> [--blocks a,b] [--tabs a,b] [--app <fe app>] - one route page of the locale segment, in the canon's shape.
//
//   starci app add page handoffs                       app/[locale]/handoffs/{page,loading,error}.tsx, HandoffsPage, HandoffsErrorPage
//   starci app add page settings/billing --blocks invoice-list-block
//   starci app add page settings --tabs profile,billing   header.tabs: Profile at /settings, Billing at /settings/billing
//
// The route files only adapt (contexts/code/fe function.md FE-FUNCTION-5, architecture.md FE-ARCHITECTURE-1, boundaries.md
// FE-BOUNDARY-1). The page owner `features/pages/<Name>Page` is a server component that resolves its copy and draws one Grammar
// `Page` (R325) whose header carries the trail and the heading (page commands and page tabs go to the header, R324), and whose body
// composes the `--blocks` (blocks of components/blocks that already exist), or the page's empty sentence when none is named. With
// `--tabs`, the header carries the page tabs as link tabs (contexts/ui/components tabs.md `level:page`): the first tab is the route
// itself and every other one its sub-route `<route>/<tab>`, which the author adds as its own page; Grammar selects the tab of the
// current path, so the server owner passes no state and no handler. The
// owner also exports the route's loading view, the same page drawn with `isSkeleton` (contexts/ui composition.md STATE-8), and
// `<Name>ErrorPage` keeps the page and puts one negative Alert where the first region would be. The bodies are
// templates/fe/units/page/; the stories pair the page with its loading view for the DNA gate.
import fs from 'node:fs';
import path from 'node:path';
import { ScaffoldError, camelOf, pascalOf } from './service.mjs';
import { addCatalogNamespaces, appOf, declarationOf, fill, humanOf, words, writeNew } from './add-fe-unit.mjs';

/** The copy of a new page, by catalog locale; any other locale takes the English sentences. */
const PAGE_COPY = Object.freeze({
  en: { breadcrumb: 'Breadcrumb', home: 'Home', empty: 'Nothing to show yet.', failed: 'This page could not be loaded.', retry: 'Try again' },
  vi: { breadcrumb: 'Đường dẫn', home: 'Trang chủ', empty: 'Chưa có gì để hiển thị.', failed: 'Không tải được trang này.', retry: 'Thử lại' },
});

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The static segments of `<route>` (`settings/billing`); a dynamic or grouped segment is the author's to write. */
export function routeSegmentsOf(route) {
  const segments = String(route).split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => !SEGMENT.test(segment))) {
    throw new ScaffoldError('HFS_ADD_ROUTE_INVALID', `${route} is not a route of kebab-case segments (a dynamic [param] or (group) segment is written by hand)`);
  }
  return segments;
}

/**
 * The blocks of `--blocks a,b`, as their PascalCase names: each an existing block of the app whose connected half takes no input
 * (`export const X = () =>`), since a generated owner has no value to hand one; a block that takes input is composed by hand.
 */
export function blocksOf(repoRoot, appBase, option) {
  if (option === undefined) return [];
  return String(option).split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
    const Name = pascalOf(value);
    const entry = path.join(repoRoot, ...appBase.split('/'), 'src', 'components', 'blocks', Name, 'index.tsx');
    if (!fs.existsSync(entry)) {
      throw new ScaffoldError('HFS_ADD_BLOCK_MISSING', `--blocks names ${Name}, which is no block of ${appBase}/src/components/blocks (starci app add block ${value})`);
    }
    if (!new RegExp(`export const ${Name} = \\(\\)`).test(fs.readFileSync(entry, 'utf8'))) {
      throw new ScaffoldError('HFS_ADD_BLOCK_TAKES_INPUT', `${Name} takes input the generated owner cannot supply; compose it in the owner by hand`);
    }
    return Name;
  });
}

/**
 * The page tabs of `--tabs a,b`: two or more distinct kebab-case ids, each with its catalog key and its route. The first tab is
 * the page's own route, every other one the sub-route `<route>/<id>`.
 */
export function tabsOf(route, option) {
  if (option === undefined) return [];
  const ids = String(option).split(',').map((value) => value.trim()).filter(Boolean);
  if (ids.length < 2 || new Set(ids).size !== ids.length || ids.some((id) => !SEGMENT.test(id))) {
    throw new ScaffoldError('HFS_ADD_TABS_INVALID', `--tabs ${option} is not two or more distinct kebab-case tab ids (a,b)`);
  }
  return ids.map((id, index) => ({ id, key: camelOf(id), label: humanOf(id), href: index === 0 ? `/${route}` : `/${route}/${id}` }));
}

/** The imports and the JSX lines of the blocks a page or layout composes. */
export const blockParts = (blocks, indent) => ({
  imports: blocks.map((Name) => `import { ${Name} } from "@/components/blocks/${Name}"\n`).join(''),
  jsx: blocks.map((Name) => `${indent}<${Name} />`).join('\n'),
});

/**
 * Generates one route page in the app at `repoRoot`.
 *
 * @param {{ repoRoot: string, route: string, options?: { app?: string, blocks?: string, tabs?: string } }} input - The app root, the route under [locale] and the options.
 * @returns {{ created: string[] }} The files written or extended, relative to the app root.
 */
export function addFePage({ repoRoot, route, options = {} }) {
  const segments = routeSegmentsOf(route);
  const appBase = `fe/apps/${appOf(declarationOf(repoRoot), options.app)}`;
  const base = pascalOf(segments.join('-'));
  const Name = `${base}Page`;
  const vars = {
    Name, LoadingName: `${base}LoadingPage`, ErrorName: `${base}ErrorPage`, nameCamel: camelOf(Name), route: segments.join('/'),
    routeId: segments.join('-'), title: humanOf(words(base).join('-')),
  };
  const routeDir = `${appBase}/src/app/[locale]/${vars.route}`;
  for (const relative of [`${routeDir}/page.tsx`, `${appBase}/src/features/pages/${Name}`, `${appBase}/src/features/pages/${vars.ErrorName}`]) {
    if (fs.existsSync(path.join(repoRoot, ...relative.split('/')))) throw new ScaffoldError('HFS_ADD_EXISTS', `${relative} already exists; starci app add never overwrites a unit`);
  }
  const blocks = blocksOf(repoRoot, appBase, options.blocks);
  const tabs = tabsOf(vars.route, options.tabs);
  const parts = blockParts(blocks, '        ');
  const empty = blocks.length === 0;
  const tabbed = tabs.length > 0;
  const pageVars = {
    ...vars,
    grammarImports: empty ? 'EmptyNotice, Page' : 'Page',
    blockImports: parts.imports,
    body: empty ? '        <EmptyNotice message={props.props.empty} />' : parts.jsx,
    emptyMember: empty ? '        readonly empty: string\n' : '',
    emptyResolved: empty ? '        empty: t("empty"),\n' : '',
    emptyFixture: empty ? '    empty: "Nothing to show yet.",\n' : '',
    tabsMember: tabbed
      ? '        /** The page tabs: link tabs, the selected one follows the current path. */\n        readonly tabsLabel: string\n        readonly tabs: ReadonlyArray<{ readonly id: string; readonly label: string; readonly href: string }>\n'
      : '',
    tabsHeader: tabbed ? '            tabs: { label: props.props.tabsLabel, items: props.props.tabs },\n' : '',
    tabsResolved: tabbed
      ? `        tabsLabel: t("tabs.label"),\n        tabs: [\n${tabs.map((tab) => `            { id: "${tab.id}", label: t("tabs.items.${tab.key}"), href: "${tab.href}" },\n`).join('')}        ],\n`
      : '',
    tabsFixture: tabbed
      ? `    tabsLabel: "${vars.title}",\n    tabs: [\n${tabs.map((tab) => `        { id: "${tab.id}", label: "${tab.label}", href: "${tab.href}" },\n`).join('')}    ],\n`
      : '',
  };
  const created = [];
  writeNew(created, repoRoot, `${routeDir}/page.tsx`, fill('page/route-page.tsx.tpl', vars));
  writeNew(created, repoRoot, `${routeDir}/loading.tsx`, fill('page/route-loading.tsx.tpl', vars));
  writeNew(created, repoRoot, `${routeDir}/error.tsx`, fill('page/route-error.tsx.tpl', vars));
  writeNew(created, repoRoot, `${appBase}/src/features/pages/${Name}/index.tsx`, fill('page/index.tsx.tpl', pageVars));
  writeNew(created, repoRoot, `${appBase}/src/features/pages/${Name}/component.tsx`, fill('page/component.tsx.tpl', pageVars));
  writeNew(created, repoRoot, `${appBase}/src/features/pages/${vars.ErrorName}/index.tsx`, fill('page/error-index.tsx.tpl', vars));
  writeNew(created, repoRoot, `${appBase}/src/features/pages/${vars.ErrorName}/component.tsx`, fill('page/error-component.tsx.tpl', vars));
  writeNew(created, repoRoot, `${appBase}/stories/pages/${Name}.stories.tsx`, fill('page/stories.tsx.tpl', pageVars));
  addCatalogNamespaces(created, { repoRoot, appBase }, (locale) => {
    const copy = PAGE_COPY[locale] ?? PAGE_COPY.en;
    return { [vars.nameCamel]: {
      title: vars.title, breadcrumb: copy.breadcrumb, home: copy.home, ...(empty ? { empty: copy.empty } : {}),
      ...(tabbed ? { tabs: { label: vars.title, items: Object.fromEntries(tabs.map((tab) => [tab.key, tab.label])) } } : {}),
      failed: copy.failed, retry: copy.retry,
    } };
  });
  return { created };
}
