// grammar-vendor-parity.mjs - GRAMMAR_VENDOR_PARITY: a Grammar component that wraps HeroUI keeps HeroUI's anatomy and defaults.
//
// Grammar is a wrapper of HeroUI. The vendor reference (knowledge/vendor/heroui/<dir>.yaml, measured from the installed @heroui packages by
// scripts/work/ui/vendor-heroui.mjs) states what HeroUI draws; the wrapper manifest (knowledge/vendor/heroui/wrappers.yaml) states what each
// Grammar file wraps, which parts it hands to its caller (`delegates`) and which vendor slots it restyles on purpose (`overrides`, empty by
// default, pinned by an owner ruling: scripts/checks/check-grammar-vendor-parity.mjs). This library is pure: the caller hands the parsed
// reference, the parsed manifest, the Grammar sources and stylesheets.
//
// Two layers. The UNIVERSAL layer binds every Grammar built on HeroUI: use the HeroUI component for each role (no hand-rolled menu, list
// box, dialog or switch: `role`), keep its anatomy and parts (`anatomy`, `undeclared`). The PER-GRAMMAR layer is what a Grammar declares in the
// source DNA (`paths`, `vendor: {name: heroui, parity}`, `arrangement`, never inferred from its CSS): `strict` keeps HeroUI's default CSS and
// arrangement (`slot`, `style`, `default`, `stale`; the pinned overrides are the only deviations), `custom` may re-skin and re-arrange
// (tokens, radius, padding, colour, where the indicator sits, separators, icon size) and is judged by the universal layer only.
// Grammar StarCi is strict.
//
// A finding is red when
//   anatomy    a wrapper renders a part the vendor does not have, omits a part the vendor requires or a slot its row claims,
//              or omits the vendor's embedded divider (`Separator`) while it renders a `Section`;
//   undeclared a Grammar file wraps a HeroUI component its manifest row does not declare (or the row names a file that is gone);
//   slot       Grammar CSS targets a vendor class or `data-slot` no override declares;
//   style      Grammar CSS restyles a paint family (padding, radius, colour, size, ...) of any wrapped vendor part
//              through a class or `data-grammar-*` stamp that wrapper puts on that part, and no override declares it (accessibility
//              media - forced colors, the touch target floor - is not judged);
//   default    a wrapper passes a vendor part a prop value other than the vendor default (the dot indicator in place of the check);
//   role       a Grammar file hand-rolls an ARIA role HeroUI already has a component for (unless a pinned `role` override declares it);
//   grammar    a Grammar file belongs to no declared Grammar, or a declaration is malformed;
//   stale      an override nothing needs any more.
// Arrangement choices (including glyph size) live in the family's DNA and never authorize vendor paint overrides.
// Custom family skins keep the universal component/anatomy/role contract; strict families also keep vendor paint defaults.
import { createHash } from 'node:crypto';
import { cssRules, propertyFamily, repaintFamilies, selectorAttributes, selectorClasses, subjectCompound, utilityFamilies } from './css-rules.mjs';
import { byCodeUnit } from './list.mjs';
import { classTokens, heroTags, importAliases, roleFindings, stringLiterals } from './grammar-vendor-parity-jsx.mjs';
export { heroTags, importAliases } from './grammar-vendor-parity-jsx.mjs';

export const CODE = 'GRAMMAR_VENDOR_PARITY';
export const WRAPPERS_SCHEMA = 'starci/vendor-heroui-wrappers@1';

/** Which measured roles name component contracts: ARIA widgets/windows or an exact public structural role API. */
export function classifyRoleContracts({ carriers, publicApis, ariaRoles }) {
  const apis = new Map(publicApis.filter((name) => ariaRoles.has(name.toLowerCase())).map((name) => [name.toLowerCase(), name]));
  const all = new Map(carriers);
  for (const [role] of apis) if (!all.has(role)) all.set(role, []);
  return Object.fromEntries([...all].sort(([a], [b]) => byCodeUnit(a, b)).map(([role, contracts]) => {
    const definition = ariaRoles.get(role);
    const componentRole = definition?.superClass.some((chain) => chain.some((category) => ['widget', 'window', 'composite'].includes(category))) || apis.has(role);
    return [role, { componentRole: Boolean(componentRole), contracts: [...new Set(contracts)].sort(byCodeUnit), ...(apis.has(role) ? { publicApi: apis.get(role) } : {}) }];
  }));
}

/** The sha256 of a pinned file's text, line endings normalised. */
export const manifestDigest = (text) => createHash('sha256').update(String(text ?? '').replaceAll('\r\n', '\n')).digest('hex');

const finding = (rule, file, line, message) => ({ code: CODE, rule, file, line, message: `${rule}: ${message}` });

// ---------------------------------------------------------------------------
// The judgment.
// ---------------------------------------------------------------------------

/** Accessibility adaptations of the user's input or display (forced colours, contrast, the touch target floor) are not restyles of the vendor look. */
const ACCESSIBILITY_MEDIA = /forced-colors|prefers-contrast|pointer:\s*coarse/;
const OVERRIDE_KINDS = ['slot', 'style', 'default', 'role'];
const PARITY_MODES = ['strict', 'custom'];
const overrideKey = (kind, target) => `${kind}:${target}`;

/**
 * The declared overrides as a ledger: `allowed(kind, target)` answers and remembers the use, so an override nothing needs is found stale.
 * Arrangement belongs in DNA, so it cannot grant permission through the override ledger.
 */
function declaredOverrides(wrappers) {
  const declared = new Map();
  const used = new Set();
  const problems = [];
  for (const row of wrappers) {
    for (const entry of row.overrides ?? []) {
      if (OVERRIDE_KINDS.includes(entry?.kind) && entry.target && entry.reason) declared.set(overrideKey(entry.kind, entry.target), row.file);
      else problems.push(finding('override', row.file, 0, `an override names its kind (${OVERRIDE_KINDS.join(', ')}), its target and its reason`));
    }
  }
  const allowed = (kind, target) => {
    const key = overrideKey(kind, target);
    used.add(key);
    return declared.has(key);
  };
  const stale = () => [...declared]
    .filter(([key]) => !used.has(key))
    .map(([key, file]) => finding('stale', file, 0, `the override ${key} is declared but nothing needs it: remove it`));
  return { allowed, stale, problems };
}

/** The Grammar a file belongs to (the longest declared path prefix), or undefined. */
const grammarOf = (file, grammars) => grammars
  .flatMap((grammar) => (Array.isArray(grammar.paths) ? grammar.paths : []).filter((prefix) => typeof prefix === 'string' && file.startsWith(prefix)).map((prefix) => ({ grammar, length: prefix.length })))
  .sort((a, b) => b.length - a.length)[0]?.grammar;

/** The malformed Grammar declarations and the files that belong to no declared Grammar. */
function grammarFindings(grammars, files) {
  const validValue = (value) => typeof value === 'string' ? value.length > 0 : value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every(validValue);
  const validPaths = (paths) => Array.isArray(paths) && paths.length > 0 && paths.every((prefix) => typeof prefix === 'string' && /^(?:[\w-]+\/)+$/.test(prefix));
  const found = grammars
    .filter((grammar) => !grammar.id || !validPaths(grammar.paths) || grammar.vendor?.name !== 'heroui' || !PARITY_MODES.includes(grammar.vendor?.parity) || !['indicatorSide', 'separators', 'iconSize', 'density'].every((key) => validValue(grammar.arrangement?.[key])) || grammar.declarationError)
    .map((grammar) => {
      const error = grammar.declarationError ? ': ' + grammar.declarationError : '';
      return finding('grammar', grammar.dnaFile ?? 'packages/grammar/src', 0, `the Grammar ${grammar.id ?? '?'} declares an id, its paths, vendor: {name: heroui, parity: ${PARITY_MODES.join(' | ')}} and arrangement: {indicatorSide, separators, iconSize, density} in its DNA${error}`);
    });
  return [...found, ...files.filter((file) => grammarOf(file, grammars) === undefined).map((file) => finding('grammar', file, 0, 'belongs to no declared Grammar: declare its owned paths, vendor parity and arrangement in its DNA'))];
}

/** The compound part that supplies a claimed vendor slot, including nested slots supplied by a structural ancestor. */
function ownerOfSlot(reference, target) {
  const parts = Object.entries(reference.parts);
  if (!target.startsWith('.')) return parts.find(([, part]) => part.dataSlot === target)?.[0];
  const cls = target.slice(1);
  const slots = Object.entries(reference.anatomy.slots ?? {}).flatMap(([key, classes]) => {
    const part = parts.map(([name]) => name).filter((name) => key.toLowerCase().endsWith(name.toLowerCase())).sort((a, b) => b.length - a.length)[0];
    return part ? String(classes).split(/\s+/).map((name) => ({ cls: name, part })) : [];
  });
  // A List implementation may mention all its container's internal classes. The
  // named compound ancestor (ListContainer) still has to be mounted to emit them.
  const ancestor = slots.filter((slot) => cls === slot.cls || cls.startsWith(`${slot.cls}__`)).sort((a, b) => b.cls.length - a.cls.length)[0];
  return ancestor?.part ?? parts.find(([, part]) => part.classes?.includes(cls))?.[0];
}

/** Slots claimed by the wrapper row need their vendor compound part, even when that part is optional in the vendor API. */
function missingSlotFindings({ file, name, reference, row, rendered, delegates }) {
  return (row.overrides ?? []).filter((entry) => entry?.kind === 'slot' && typeof entry.target === 'string').flatMap((entry) => {
    const part = ownerOfSlot(reference, entry.target);
    return part && !rendered.has(part) && !delegates.has(part)
      ? [finding('anatomy', file, 1, `omits vendor slot ${entry.target} declared by its wrapper row: render ${name}.${part}, which supplies it (or delegate that part when the caller supplies it)`)]
      : [];
  });
}

/** The part findings of one wrapped component: unknown parts, required parts or claimed slots left out, and section dividers. */
function anatomyFindings({ file, name, reference, mine, row, tags, aliases }) {
  const found = [];
  for (const tag of mine) {
    if (tag.part !== 'Root' && !reference.anatomy.parts.includes(tag.part)) {
      found.push(finding('anatomy', file, tag.line, `<${tag.alias}.${tag.part}> is not a part of HeroUI ${name} (parts: ${reference.anatomy.parts.join(', ') || 'none'})`));
    }
  }
  const delegates = new Set(row.delegates?.[name] ?? []);
  const rendered = new Set(mine.map((tag) => tag.part));
  for (const part of reference.anatomy.required.filter((candidate) => !rendered.has(candidate) && !delegates.has(candidate))) {
    found.push(finding('anatomy', file, 1, `omits ${name}.${part}, which HeroUI ${name} requires (render it, or declare it under delegates when the caller supplies it)`));
  }
  found.push(...missingSlotFindings({ file, name, reference, row, rendered, delegates }));
  if (!rendered.has('Section')) return found;
  for (const embed of reference.anatomy.embeds.filter((entry) => entry.slot === 'separator')) {
    const separatorAliases = new Set([...aliases].filter(([, exported]) => exported === embed.component).map(([local]) => local));
    if (!tags.some((tag) => separatorAliases.has(tag.alias))) {
      found.push(finding('anatomy', file, 1, `renders ${name}.Section without HeroUI's ${embed.component} between sections (HeroUI styles its separator inside the menu)`));
    }
  }
  return found;
}

/** The default findings: a prop of a part given a value of its closed set other than the vendor default. */
function defaultFindings({ file, name, reference, mine, allowed }) {
  const found = [];
  for (const tag of mine) {
    const part = reference.parts[tag.part];
    for (const attr of part ? tag.attrs : []) {
      const closedSet = part.values?.[attr.name];
      const fallback = part.defaults?.[attr.name];
      if (!closedSet || fallback === undefined) continue;
      const odd = stringLiterals(attr.raw).filter((value) => closedSet.includes(value) && value !== fallback);
      const target = [name, tag.part, attr.name].join('.');
      if (odd.length && !allowed('default', target)) {
        found.push(finding('default', file, tag.line, `${name}.${tag.part} ${attr.name}=${odd.map((value) => JSON.stringify(value)).join('|')} replaces the vendor default "${fallback}" (override target default:${target})`));
      }
    }
  }
  return found;
}

function wrapperFindings({ file, text, row, references, byName, allowed, strict }) {
  const aliases = importAliases(text);
  const components = [...new Set([...aliases.values()].filter((name) => byName.has(name)))].sort(byCodeUnit);
  if (!row) return components.length ? [finding('undeclared', file, 1, `wraps ${components.join(', ')} but the wrapper manifest has no row for it`)] : [];
  const found = [];
  const declared = [...(row.wraps ?? [])].sort(byCodeUnit);
  if (components.join(',') !== declared.join(',')) found.push(finding('undeclared', file, 1, `wraps ${components.join(', ') || 'nothing'} but its manifest row declares ${declared.join(', ') || 'nothing'}`));
  const tags = heroTags(text, [...aliases.keys()]);
  for (const name of components) {
    const reference = references[byName.get(name)];
    const locals = new Set([...aliases].filter(([, exported]) => exported === name).map(([local]) => local));
    const mine = tags.filter((tag) => locals.has(tag.alias));
    found.push(...anatomyFindings({ file, name, reference, mine, row, tags, aliases }), ...(strict ? defaultFindings({ file, name, reference, mine, allowed }) : []));
  }
  return found;
}

/** The stamps (class tokens and `data-grammar-*` names) each wrapped vendor part carries: stamp -> [{name, part, dir, file}]. */
function stampsOf(sources, rows, byName, references, grammarFor) {
  const stamps = new Map();
  const add = (key, entry) => stamps.set(key, [...(stamps.get(key) ?? []), entry]);
  for (const { file, text } of sources.filter((source) => rows.has(source.file) && grammarFor(source.file)?.vendor?.parity === 'strict')) {
    const aliases = importAliases(text);
    for (const tag of heroTags(text, [...aliases.keys()])) {
      const name = aliases.get(tag.alias);
      const dir = byName.get(name);
      if (dir === undefined || !references[dir].parts[tag.part]) continue;
      const entry = { name, part: tag.part, dir, file, family: grammarFor(file).id };
      classTokens(text, tag.attrs).forEach((token) => add(`.${token}`, entry));
      tag.attrs.filter((attr) => attr.name.startsWith('data-grammar-')).forEach((attr) => add(`[${attr.name}]`, entry));
    }
  }
  return stamps;
}

/** The vendor classes and data-slots Grammar CSS targets, as slot findings. */
function slotFindings({ file, selector, vendor, allowed }) {
  const found = [];
  for (const cls of selectorClasses(selector).filter((candidate) => vendor.classes.has(candidate) && !allowed('slot', `.${candidate}`))) {
    found.push(finding('slot', file, 0, `${selector} targets the vendor class .${cls} (override target slot:.${cls})`));
  }
  for (const attribute of selectorAttributes(selector)) {
    if (attribute.name === 'data-slot' && vendor.slots.has(attribute.value) && !allowed('slot', attribute.value)) {
      found.push(finding('slot', file, 0, `${selector} targets the vendor data-slot "${attribute.value}" (override target slot:${attribute.value})`));
    }
  }
  return found;
}

/** The declarations and utilities that set one paint family, with their at-rule context intact. */
function familyValue(rule, family) {
  return {
    apply: (rule.apply ?? []).filter((utility) => utilityFamilies(utility).includes(family)),
    declarations: (rule.declarations ?? []).map((entry) => {
      if (typeof entry !== 'string') return entry;
      const colon = entry.indexOf(':');
      return { property: entry.slice(0, colon).trim(), value: entry.slice(colon + 1).trim() };
    }).filter((entry) => propertyFamily(entry.property) === family),
    wraps: rule.wraps ?? [],
  };
}

/** Measured vendor rules for this part and paint family; preserve state/variant selectors instead of guessing a cascade. */
function vendorDefaults(reference, part, family) {
  const declared = reference.parts[part];
  const owns = (selector) => {
    const subject = subjectCompound(selector);
    return selectorClasses(subject).some((cls) => declared.classes?.includes(cls)) || selectorAttributes(subject).some((attribute) => attribute.name === 'data-slot' && attribute.value === declared.dataSlot);
  };
  return (reference.css.rules ?? []).flatMap((rule) => {
    const selectors = rule.selectors.filter(owns);
    const value = familyValue(rule, family);
    return selectors.length && (value.apply.length || value.declarations.length) ? [{ file: rule.file, selectors, ...value }] : [];
  });
}

/** The paint families Grammar CSS repaints on a vendor part through a stamp of the subject compound, as style findings. */
function styleFindings({ file, selector, families, stamps, references, allowed, rule, grammar }) {
  const found = [];
  const subject = subjectCompound(selector);
  const tokens = [...selectorClasses(subject).map((cls) => `.${cls}`), ...selectorAttributes(subject).map((attribute) => `[${attribute.name}]`)];
  for (const token of tokens) {
    for (const entry of (stamps.get(token) ?? []).filter((candidate) => candidate.family === grammar.id)) {
      const paints = references[entry.dir].parts[entry.part].paints;
      for (const family of families.filter((candidate) => paints.includes(candidate))) {
        const target = `${entry.name}.${entry.part}:${family}`;
        if (!allowed('style', target)) found.push({
          ...finding('style', file, 0, `${selector} restyles ${family} of HeroUI ${entry.name}.${entry.part}, which the vendor decides (stamp ${token} on ${entry.file}; override target style:${target})`),
          selector, part: `${entry.name}.${entry.part}`, property: family, wrapperRow: entry.file, family: grammar.id,
          grammarValue: familyValue(rule, family), vendorDefault: vendorDefaults(references[entry.dir], entry.part, family),
        });
      }
    }
  }
  return found;
}

function cssFindings({ styles, references, stamps, allowed, grammarFor }) {
  const vendor = {
    classes: new Set(Object.values(references).flatMap((reference) => reference.css.classes)),
    slots: new Set(Object.values(references).flatMap((reference) => reference.css.dataSlots)),
  };
  const found = [];
  for (const { file, text } of styles.filter((sheet) => grammarFor(sheet.file)?.vendor?.parity === 'strict')) {
    for (const rule of cssRules(text)) {
      const families = rule.wraps.some((wrap) => ACCESSIBILITY_MEDIA.test(wrap)) ? [] : repaintFamilies(rule);
      for (const selector of rule.selectors) {
        found.push(...slotFindings({ file, selector, vendor, allowed }), ...(families.length ? styleFindings({ file, selector, families, stamps, references, allowed, rule, grammar: grammarFor(file) }) : []));
      }
    }
  }
  return found;
}

/**
 * Every GRAMMAR_VENDOR_PARITY finding.
 *   references  { <dir>: parsed vendor reference }
 *   manifest    the parsed wrapper manifest ({schema, wrappers: [{file, wraps, delegates, overrides}]})
 *   grammars    source DNA declarations ({id, paths, vendor, arrangement}), loaded separately from the manifest
 *   sources     [{file, text}] Grammar .ts/.tsx (stories excluded), file relative to packages/grammar/src
 *   styles      [{file, text}] every Grammar .css; a sheet is judged only when its Grammar declares `parity: strict`
 */
export function parityFindings({ references: vendorReferences, manifest, sources, styles, grammars = [] }) {
  if (manifest?.schema !== WRAPPERS_SCHEMA) return [finding('manifest', 'knowledge/vendor/heroui/wrappers.yaml', 0, `schema must be ${WRAPPERS_SCHEMA}`)];
  const wrappers = Array.isArray(manifest.wrappers) ? manifest.wrappers : [];
  const roleReference = vendorReferences.roles;
  if (roleReference?.schema !== 'starci/vendor-heroui-roles@1' || !roleReference.roles || typeof roleReference.roles !== 'object' || Array.isArray(roleReference.roles) || Object.keys(roleReference.roles).length === 0 || Object.values(roleReference.roles).some((entry) => !entry || typeof entry.componentRole !== 'boolean' || !Array.isArray(entry.contracts))) return [finding('reference', 'knowledge/vendor/heroui/roles.yaml', 0, 'the generated vendor role index is missing or malformed: regenerate the vendor reference')];
  const references = Object.fromEntries(Object.entries(vendorReferences).filter(([, reference]) => reference.component));
  const byName = new Map(Object.entries(references).map(([dir, reference]) => [reference.component, dir]));
  const vendorRoles = new Set(Object.entries(vendorReferences.roles?.roles ?? {}).filter(([, declaration]) => declaration.componentRole).map(([role]) => role));
  const rows = new Map(wrappers.map((row) => [row.file, row]));
  const known = new Set(sources.map((source) => source.file));
  const { allowed, stale, problems } = declaredOverrides(wrappers);
  const grammarFor = (file) => grammarOf(file, grammars);
  const strictOf = (file) => grammarFor(file)?.vendor?.parity === 'strict';
  return [
    ...grammarFindings(grammars, [...sources, ...styles].map((source) => source.file)),
    ...wrappers.filter((row) => !known.has(row.file)).map((row) => finding('undeclared', row.file, 0, 'the manifest names a file that does not exist')),
    ...problems,
    ...sources.flatMap(({ file, text }) => [
      ...wrapperFindings({ file, text, row: rows.get(file), references, byName, allowed, strict: strictOf(file) }),
      ...roleFindings({ file, text, allowed, vendorRoles, roleDeclarations: roleReference.roles, finding }),
    ]),
    ...cssFindings({ styles, references, stamps: stampsOf(sources, rows, byName, references, grammarFor), allowed, grammarFor }),
    ...stale(),
  ];
}

/** Pin findings: the manifest differs from the digest the latest owner ruling that pins it records. */
export function pinFindings({ file, text, pinned }) {
  if (pinned === undefined) return [finding('pin', file, 0, 'no owner ruling pins this manifest: an owner ruling records its sha256')];
  const digest = manifestDigest(text);
  return digest === pinned ? [] : [finding('pin', file, 0, `its digest ${digest.slice(0, 12)} is not the one the owner pinned (${String(pinned).slice(0, 12)}): only an owner ruling may add an override or change a row`)];
}
