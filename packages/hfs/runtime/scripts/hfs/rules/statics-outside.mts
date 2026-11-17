// statics-outside.mts - R439: an app's media lives in statics/, never beside the code (contexts/project/statics.md PROJECT-STATICS-3). A tracked media file
// (png jpg jpeg webp avif gif svg mp4 webm) under `fe/**/public/**` or `{fe,be}/**/src/**` is HFS_STATIC_ASSET_OUTSIDE_STATICS: move it to
// statics/<area>/ and reference it by its staticsKey, so one folder holds every image, the storage image serves it, and a page never bundles it.
// `fe/**/public/` may hold only the favicon, the app's own logo and the PWA/manifest icons (PUBLIC_ALLOWED, a fixed name pattern, no hfs.json allowlist);
// every other image or video goes to statics/ behind the CDN.
// Not judged: the route metadata files Next.js reads by name (`src/app/{icon,favicon,apple-icon,opengraph-image,twitter-image}.*`), `public/favicon.ico`,
// and the small build-time binaries a back end keeps under `be/**/src/assets/` (slot be.assets, judged by HFS_ASSET_KIND and HFS_ASSET_OVERSIZE).
import path from 'node:path';
import { found } from './read.mjs';
import type { Finding, Repo } from './rule-types.mjs';

const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.mp4', '.webm']);
const FE_PUBLIC = /^fe\/(?:[^/]+\/)*public\//u;
const IN_SRC = /^(?:fe|be)\/(?:[^/]+\/)*src\//u;
const BE_ASSETS = /^be\/(?:[^/]+\/)*src\/assets\//u;
const ROUTE_METADATA = /(?:^|\/)src\/app\/(?:icon|favicon|apple-icon|opengraph-image|twitter-image)(?:\d*)\.[a-z]+$/u;

/** What `public/` (relative to it) may hold: favicon.*, apple-touch-icon*.png, android-chrome-*.png, mstile-*.png, safari-pinned-tab.svg, icon-*.png, icons/**, and logo.{png,svg,webp} or *-logo.{png,svg,webp} in public/ or public/brand/. */
const PUBLIC_ALLOWED = /^(?:favicon\.[^/]+|apple-touch-icon[^/]*\.png|android-chrome-[^/]*\.png|mstile-[^/]*\.png|safari-pinned-tab\.svg|icon-[^/]*\.png|icons\/.+|(?:brand\/)?(?:logo|[^/]*-logo)\.(?:png|svg|webp))$/iu;

/** True when `file` (app-relative, posix) is a media file the rule refuses. */
export function isStaticAssetOutside(file: string): boolean {
  if (!MEDIA.has(path.posix.extname(file).toLowerCase())) return false;
  if (!(FE_PUBLIC.test(file) || IN_SRC.test(file))) return false;
  const inPublic = FE_PUBLIC.exec(file);
  if (inPublic && PUBLIC_ALLOWED.test(file.slice(inPublic[0].length))) return false;
  return !(BE_ASSETS.test(file) || ROUTE_METADATA.test(file));
}

/** Findings of R439 at the app root: every tracked file of both sides. */
export function staticsOutsideFindings({ repo, isRoot, all = [] }: { repo: Repo; isRoot: boolean; all?: string[] }): Finding[] {
  if (repo?.kind !== 'app' || isRoot === false) return [];
  return all.map((file) => file.replaceAll(String.fromCharCode(92), '/')).filter(isStaticAssetOutside)
    .map((file) => found('HFS_STATIC_ASSET_OUTSIDE_STATICS', file, `${file} is a media file beside the code: move it to statics/<area>/ and reference it by its staticsKey, the path under statics/ (PROJECT-STATICS-3)`));
}
