/**
 * The edition gate of the back-end plugin.
 *
 * Edition applicability belongs to the HFS rule catalog, beside the law and its enforcer. A rule
 * that the catalog does not judge in this app's edition still ships in the plugin, but its `create`
 * returns no listeners. The plugin wiring therefore has one generic gate instead of edition checks
 * scattered through rule bodies.
 */
import { loadRuleCatalog, type RuleCatalog } from "../../runtime/scripts/hfs/slots.mjs"
import type { CanonPlugin } from "./config.ts"
import type { RuleModule } from "./rule.ts"
import { RUNTIME_ROOT as RUNTIME } from "./runtime-root.ts"

let catalogCache: RuleCatalog | undefined

/** The bundled rule catalog, loaded once per lint process. */
const bundledCatalog = (): RuleCatalog => {
    catalogCache ??= loadRuleCatalog({ root: RUNTIME })
    return catalogCache
}

/** A rule which intentionally registers no listeners in this edition. */
const inactive = (rule: RuleModule): RuleModule => Object.freeze({ ...rule, create: () => ({}) })

/**
 * The plugin view for one HFS edition.
 *
 * Both editions read the catalog: full is the default edition, and a rule whose catalog entries name only lite (R334
 * `no-raw-sql`) is inactive there, as a full-only rule is in lite. The bundled catalog is loaded once per lint process;
 * tests may inject a catalog to prove the generic filtering independently of the bundled copy.
 */
export const pluginForEdition = <P extends CanonPlugin>({ plugin, hfs, catalog }: {
    plugin: P
    hfs?: { readonly edition?: string } | null | undefined
    catalog?: Pick<RuleCatalog, "enforcerJudgedIn"> | undefined
}): P => {
    const edition = hfs?.edition === undefined ? "full" : hfs.edition
    if (edition !== "full" && edition !== "lite") {
        throw new RangeError(`Unknown HFS edition ${JSON.stringify(edition)}; expected "full" or "lite"`)
    }
    const loaded = catalog ?? bundledCatalog()
    const rules = Object.fromEntries(Object.entries(plugin.rules).map(([id, rule]) => [
        id,
        loaded.enforcerJudgedIn("eslint-be", id, edition) ? rule : inactive(rule),
    ]))
    return Object.freeze({ ...plugin, rules: Object.freeze(rules) })
}
