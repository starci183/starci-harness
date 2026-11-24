import { hfsOf } from "@starci/eslint-canon-fe/lib/hfs.mjs"
import type { ReaderContext } from "./types.ts"

/**
 * THE PUBLIC SITE. No hfs slot marks an app's public marketing site yet; the proposed one is `fe.site`, and a file it owns is
 * the site at once. Until it exists the site is read from the slots the manifest already has, through `classify`, never a raw path test:
 *   - an owner of `fe.components` or `fe.feature` named `Site…` or `Marketing…` (its `<name>` binding: `SiteHead`, `SiteBrandPage`);
 *   - a route file of `fe.route` under the `(site)` or `(marketing)` route group (FE-CSS-2 names the marketing `(site)` group);
 *   - a capability of `fe.modules` named `site…` or `marketing…` (`modules/site-home`).
 */
export const SITE_SLOT = "fe.site"

const SITE_OWNER = /^(?:Site|Marketing)[A-Z0-9]/
const SITE_CAPABILITY = /^(?:site|marketing)(?:$|[-_A-Z])/
const SITE_GROUP = /^\((?:site|marketing)\)$/

/** True for a file of the app's public marketing site. */
export const isSiteFile = (context: ReaderContext, file: string): boolean => {
  const found = hfsOf(context).classify(file)
  if (found.slot === SITE_SLOT) return true
  const name = found.bindings?.["name"]
  if ((found.slot === "fe.components" || found.slot === "fe.feature") && name !== undefined) return SITE_OWNER.test(name)
  if (found.slot === "fe.modules") return SITE_CAPABILITY.test(found.bindings?.["capability"] ?? "")
  if (found.slot === "fe.route" && found.root !== undefined) return found.path.slice(found.root.length + 1).split("/").some((segment) => SITE_GROUP.test(segment))
  return false
}
