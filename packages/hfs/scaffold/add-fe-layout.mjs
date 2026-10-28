// starci app add layout <segment> [--blocks a,b] [--app <fe app>] - one route-segment layout in the canon's shape.
//
//   starci app add layout settings                          app/[locale]/settings/layout.tsx and features/layouts/SettingsLayout
//   starci app add layout settings --blocks settings-nav-block   the blocks fill the frame's rail
//
// The route file only mounts the layout owner (contexts/code/fe architecture.md FE-ARCHITECTURE-1). The owner is a server
// component that composes a Grammar layout frame, `PrimaryRailLayout`: the routed page is its primary region and the `--blocks`
// (existing blocks of components/blocks) its rail. A frame places regions only and never insets a page or draws a page head;
// `Page` owns both (contexts/ui/components page-header.md). The owner has no copy to resolve, so it has no pure half and no story:
// the frame's look is the Grammar's and the regions are the page's and the blocks'. The bodies are templates/fe/units/layout/.
import fs from 'node:fs';
import path from 'node:path';
import { ScaffoldError, pascalOf } from './service.mjs';
import { appOf, declarationOf, fill, writeNew } from './add-fe-unit.mjs';
import { blockParts, blocksOf, routeSegmentsOf } from './add-fe-page.mjs';

/**
 * Generates one route-segment layout in the app at `repoRoot`.
 *
 * @param {{ repoRoot: string, segment: string, options?: { app?: string, blocks?: string } }} input - The app root, the segment under [locale] and the options.
 * @returns {{ created: string[] }} The files written, relative to the app root.
 */
export function addFeLayout({ repoRoot, segment, options = {} }) {
  const segments = routeSegmentsOf(segment);
  const appBase = `fe/apps/${appOf(declarationOf(repoRoot), options.app)}`;
  const Name = `${pascalOf(segments.join('-'))}Layout`;
  const route = `${appBase}/src/app/[locale]/${segments.join('/')}/layout.tsx`;
  const owner = `${appBase}/src/features/layouts/${Name}`;
  for (const relative of [route, owner]) {
    if (fs.existsSync(path.join(repoRoot, ...relative.split('/')))) throw new ScaffoldError('HFS_ADD_EXISTS', `${relative} already exists; starci app add never overwrites a unit`);
  }
  const blocks = blocksOf(repoRoot, appBase, options.blocks);
  const parts = blockParts(blocks, '                ');
  const vars = {
    Name, segment: segments.join('/'),
    blockImports: parts.imports,
    railDoc: blocks.length === 0 ? 'leaves its rail empty until a block fills it' : `fills its rail with ${blocks.join(', ')}`,
    frame: blocks.length === 0
      ? '<PrimaryRailLayout primary={props.content} />'
      : ['(', '    <PrimaryRailLayout', '        primary={props.content}', '        rail={', '            <>', parts.jsx, '            </>', '        }', '    />', ')'].join('\n'),
  };
  const created = [];
  writeNew(created, repoRoot, route, fill('layout/route-layout.tsx.tpl', vars));
  writeNew(created, repoRoot, `${owner}/index.tsx`, fill('layout/index.tsx.tpl', vars));
  return { created };
}
