// GRAMMAR_VENDOR_PARITY: a Grammar wrapper of HeroUI keeps HeroUI's anatomy and defaults (scripts/lib/grammar-vendor-parity.mjs, run by
// the grammar-vendor-parity self-check). Grammar has no specs of its own (owner ruling), so the proof lives here: the exact DropdownMenu
// of the commit before b0a5d1f77 (a dot indicator, no separator between sections) is red, and the one at b0a5d1f77 is green.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { cssRules, propertyFamily, ruleFamilies, utilityFamilies } from '../runtime/scripts/lib/css-rules.mjs';
import { WRAPPERS_SCHEMA, classifyRoleContracts, heroTags, importAliases, manifestDigest, parityFindings, pinFindings } from '../runtime/scripts/lib/grammar-vendor-parity.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'grammar-vendor');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** The generated vendor references of the six HeroUI components DropdownMenu wraps, as `starci work grammar-knowledge --write` measured them. */
const references = Object.fromEntries(['dropdown', 'description', 'header', 'kbd', 'label', 'roles', 'separator', 'tooltip'].map((dir) => [dir, parseYaml(fixture(`reference-${dir}.yaml`))]));

const DROPDOWN_FILE = 'core/branch/DropdownMenu/index.tsx';
const row = (extra = {}) => ({
  file: DROPDOWN_FILE,
  wraps: ['Description', 'Dropdown', 'Header', 'Kbd', 'Label', 'Separator'],
  delegates: { Dropdown: ['Trigger'] },
  overrides: [],
  ...extra,
});
/** Source DNA declares ownership, parity and arrangement; the manifest cannot choose a family's mode. */
const arrangement = { indicatorSide: { default: 'start', submenu: 'end' }, separators: 'between-sections', iconSize: { default: 'vendor', 'Dropdown.Item:leading-glyph-size': '20px' }, density: 'vendor' };
const GRAMMARS = [
  { id: 'starci', paths: ['common/', 'core/'], vendor: { name: 'heroui', parity: 'strict' }, arrangement },
  { id: 'skin', paths: ['skin/'], vendor: { name: 'heroui', parity: 'custom' }, arrangement },
];
const manifest = (...rows) => ({ schema: WRAPPERS_SCHEMA, wrappers: rows });
const judge = ({ text, styles = [], wrapper = row(), file = DROPDOWN_FILE }) => parityFindings({ grammars: GRAMMARS, references, manifest: manifest(wrapper), sources: [{ file, text }], styles });
const rules = (findings) => findings.map((finding) => finding.rule);

test('the DropdownMenu before b0a5d1f77 is red: the dot indicator replaces the vendor default and no separator divides the sections', () => {
  const findings = judge({ text: fixture('dropdown-menu.before-fix.tsx.txt'), wrapper: row({ wraps: ['Description', 'Dropdown', 'Header', 'Kbd', 'Label'] }) });
  assert.ok(findings.every((finding) => finding.code === 'GRAMMAR_VENDOR_PARITY'));
  assert.ok(findings.some((finding) => finding.rule === 'default' && /ItemIndicator type="dot" replaces the vendor default "checkmark"/.test(finding.message)));
  assert.ok(findings.some((finding) => finding.rule === 'anatomy' && /Dropdown\.Section without HeroUI's Separator/.test(finding.message)));
});

test('the DropdownMenu of b0a5d1f77 is green: the default indicator and the vendor Separator between sections', () => {
  assert.deepEqual(judge({ text: fixture('dropdown-menu.at-b0a5d1f77.tsx.txt') }), []);
});

test('a dot indicator is allowed only when an override declares it, and an override nothing needs is stale', () => {
  const declared = row({ overrides: [{ kind: 'default', target: 'Dropdown.ItemIndicator.type', reason: 'the owner asked for the dot' }] });
  const before = fixture('dropdown-menu.before-fix.tsx.txt');
  const findings = judge({ text: before, wrapper: { ...declared, wraps: ['Description', 'Dropdown', 'Header', 'Kbd', 'Label'] } });
  assert.ok(!findings.some((finding) => finding.rule === 'default'));
  assert.deepEqual(rules(judge({ text: fixture('dropdown-menu.at-b0a5d1f77.tsx.txt'), wrapper: declared })), ['stale']);
});

test('a wrapper that renders a part HeroUI does not have is red', () => {
  const text = `import { Dropdown as HeroDropdown } from "@heroui/react"\nexport const X = () => <HeroDropdown><HeroDropdown.Rows /></HeroDropdown>`;
  const findings = judge({ text, wrapper: row({ wraps: ['Dropdown'] }) });
  assert.ok(findings.some((finding) => finding.rule === 'anatomy' && /HeroDropdown\.Rows> is not a part of HeroUI Dropdown/.test(finding.message)));
});

test('a wrapper that omits a part HeroUI requires is red unless it delegates the part', () => {
  const text = `import { Dropdown as HeroDropdown } from "@heroui/react"\nexport const X = () => <HeroDropdown><HeroDropdown.Popover><HeroDropdown.Menu /></HeroDropdown.Popover></HeroDropdown>`;
  assert.ok(judge({ text, wrapper: row({ wraps: ['Dropdown'], delegates: {} }) }).some((finding) => /omits Dropdown\.Trigger/.test(finding.message)));
  assert.deepEqual(judge({ text, wrapper: row({ wraps: ['Dropdown'] }) }), []);
  assert.ok(judge({ text, wrapper: row({ wraps: ['Dropdown'], delegates: { Dropdown: ['Trigger', 'Menu'] } }) }).length === 0);
  const noMenu = text.replace('<HeroDropdown.Menu />', '');
  assert.ok(judge({ text: noMenu, wrapper: row({ wraps: ['Dropdown'] }) }).some((finding) => /omits Dropdown\.Menu/.test(finding.message)));
});

/** Minimal measured compound: List emits its internal slots only with its ListContainer injector mounted. */
const tabsReference = {
  component: 'Tabs', dir: 'tabs',
  anatomy: {
    parts: ['Indicator', 'List', 'ListContainer', 'Panel', 'Tab'], required: ['Indicator'],
    slots: { base: 'tabs', tabList: 'tabs__list', tabListContainer: 'tabs__list-container', scroller: 'tabs__list-container__scroller', scrollPrev: 'tabs__list-container__scroll-prev', scrollNext: 'tabs__list-container__scroll-next', tabPanel: 'tabs__panel' },
    embeds: [],
  },
  parts: {
    Root: { classes: ['tabs'], dataSlot: 'tabs' },
    List: { classes: ['tabs__list', 'tabs__list-container', 'tabs__list-container__scroller', 'tabs__list-container__scroll-prev', 'tabs__list-container__scroll-next'], dataSlot: 'tabs-list' },
    ListContainer: { classes: [], dataSlot: null },
    Indicator: { classes: ['tabs__indicator'], dataSlot: 'tabs-indicator' },
    Panel: { classes: ['tabs__panel'], dataSlot: 'tabs-panel' },
    Tab: { classes: ['tabs__tab'], dataSlot: 'tabs-tab' },
  },
  css: { classes: ['tabs__list-container', 'tabs__list-container__scroller', 'tabs__list-container__scroll-prev', 'tabs__list-container__scroll-next'], dataSlots: [] },
};

test('every vendor slot claimed by a wrapper row needs the compound part that supplies it', () => {
  const claimed = tabsReference.css.classes.map((cls) => ({ kind: 'slot', target: `.${cls}`, reason: 'declared geometry' }));
  const without = 'import { Tabs as HeroTabs } from "@heroui/react"\nconst X = () => <HeroTabs><HeroTabs.List><HeroTabs.Tab><HeroTabs.Indicator /></HeroTabs.Tab></HeroTabs.List></HeroTabs>';
  const withContainer = without.replace('<HeroTabs.List>', '<HeroTabs.ListContainer><HeroTabs.List>').replace('</HeroTabs.List>', '</HeroTabs.List></HeroTabs.ListContainer>');
  const measure = (text, custom = false) => parityFindings({
    references: { ...references, tabs: tabsReference }, grammars: GRAMMARS,
    manifest: manifest({ file: custom ? 'skin/Tabs.tsx' : 'core/branch/Tabs/index.tsx', wraps: ['Tabs'], overrides: claimed }),
    sources: [{ file: custom ? 'skin/Tabs.tsx' : 'core/branch/Tabs/index.tsx', text }],
    styles: [{ file: 'common/x.css', text: `${claimed.map((entry) => entry.target).join(', ')} { display: flex; }` }],
  });
  const missing = measure(without).filter((entry) => entry.rule === 'anatomy');
  assert.equal(missing.length, 4, 'container, scroller and both directional controls are claimed');
  assert.ok(missing.every((entry) => /omits vendor slot .*render Tabs\.ListContainer/.test(entry.message)));
  assert.equal(measure(without, true).filter((entry) => entry.rule === 'anatomy').length, 4, 'custom paint still keeps declared anatomy');
  assert.deepEqual(measure(withContainer), [], 'the vendor emits internal slots; Grammar does not hand-roll carets');
  assert.deepEqual(measure(`${without}\n// <HeroTabs.ListContainer />\nconst example = '<HeroTabs.ListContainer />';`).filter((entry) => entry.rule === 'anatomy'), missing, 'comments and examples do not mount a vendor part');
  assert.ok(!measure(withContainer).some((entry) => /Tabs\.Panel/.test(entry.message)), 'an optional unclaimed panel stays optional');
});

test('a claimed vendor data-slot also needs its rendered or delegated part', () => {
  const text = 'import { Dropdown as HeroDropdown } from "@heroui/react"\nconst X = () => <HeroDropdown><HeroDropdown.Popover /></HeroDropdown>';
  const wrapper = row({ wraps: ['Dropdown'], overrides: [{ kind: 'slot', target: 'dropdown-menu', reason: 'declared geometry' }] });
  const missing = judge({ text, wrapper });
  assert.ok(missing.some((entry) => /omits vendor slot dropdown-menu.*render Dropdown\.Menu/.test(entry.message)));
  const supplied = judge({ text, wrapper: { ...wrapper, delegates: { Dropdown: ['Trigger', 'Menu'] } } });
  assert.ok(!supplied.some((entry) => /omits vendor slot/.test(entry.message)));
});

test('a file that wraps a HeroUI component its manifest row does not declare is red, and so is a row for a file that is gone', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  assert.ok(judge({ text, wrapper: row({ wraps: ['Dropdown'] }) }).some((finding) => finding.rule === 'undeclared'));
  const orphan = parityFindings({ grammars: GRAMMARS, references, manifest: manifest(row(), row({ file: 'core/branch/Gone/index.tsx' })), sources: [{ file: DROPDOWN_FILE, text }], styles: [] });
  assert.ok(orphan.some((finding) => finding.rule === 'undeclared' && /names a file that does not exist/.test(finding.message)));
  const unlisted = parityFindings({ grammars: GRAMMARS, references, manifest: manifest(), sources: [{ file: DROPDOWN_FILE, text }], styles: [] });
  assert.ok(unlisted.some((finding) => finding.rule === 'undeclared' && /no row for it/.test(finding.message)));
});

test('Grammar CSS that targets a vendor class or data-slot is red unless an override declares it', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  const styles = [{ file: 'common/x.css', text: '.starci-core-x .menu-item__indicator { inset-inline-start: auto; }\n[data-slot="menu-item"] { margin: 0; }' }];
  assert.deepEqual(rules(judge({ text, styles })), ['slot', 'slot']);
  const declared = row({ overrides: [{ kind: 'slot', target: '.menu-item__indicator', reason: 'r' }, { kind: 'slot', target: 'menu-item', reason: 'r' }] });
  assert.deepEqual(judge({ text, styles, wrapper: declared }), []);
});

test('Grammar CSS keyed on a stamp of a vendor part may not repaint what the vendor decides, except accessibility media', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  const sheet = (css) => [{ file: 'common/x.css', text: css }];
  const red = judge({ text, styles: sheet('[data-grammar-menu-item] { padding: 0; min-block-size: 3rem; }') });
  assert.deepEqual(rules(red), ['style', 'style']);
  assert.ok(red.every((finding) => /HeroUI Dropdown\.Item/.test(finding.message)));
  assert.deepEqual(judge({ text, styles: sheet('[data-grammar-menu-item] { flex: none; display: flex; }') }), [], 'layout the vendor leaves open is allowed');
  assert.deepEqual(judge({ text, styles: sheet('@media (forced-colors: active) { [data-grammar-menu-item]:hover { background: Highlight; } }') }), []);
  assert.deepEqual(judge({ text, styles: sheet('@media (pointer: coarse), (max-width: 40rem) { [data-grammar-menu-item] { min-block-size: 2.75rem; } }') }), []);
  assert.deepEqual(judge({ text, styles: sheet('[data-grammar-menu-item] .starci-core-icon { color: red; }') }), [], "Grammar's own Icon is not a vendor part");
  assert.deepEqual(rules(judge({ text, styles: sheet('[data-grammar-menu-item] { padding: 0; }'), wrapper: row() })), ['style'], 'every strict wrapper row is judged without an opt-in');
  const declared = row({ overrides: [{ kind: 'style', target: 'Dropdown.Item:padding', reason: 'r' }] });
  assert.deepEqual(rules(judge({ text, styles: sheet('[data-grammar-menu-item] { padding: 0; }'), wrapper: declared })), []);
});

test('DNA arrangement never authorizes a paint override and canon entries belong in DNA', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  const styles = [{ file: 'common/x.css', text: '[data-grammar-menu-item] { padding: 0; }' }];
  assert.deepEqual(rules(judge({ text, styles })), ['style']);
  const obsolete = row({ overrides: [{ kind: 'canon', target: 'Dropdown.Item:leading-glyph-size', reason: 'belongs in arrangement.iconSize' }] });
  assert.ok(judge({ text, wrapper: obsolete }).some((entry) => entry.rule === 'override'));
});

test('the manifest is pinned: a missing pin or a different digest is red', () => {
  const text = 'schema: x\n';
  assert.deepEqual(pinFindings({ file: 'm.yaml', text, pinned: manifestDigest(text) }), []);
  assert.deepEqual(pinFindings({ file: 'm.yaml', text: 'schema: x\r\n', pinned: manifestDigest(text) }), [], 'line endings do not change the digest');
  assert.equal(pinFindings({ file: 'm.yaml', text, pinned: undefined })[0].rule, 'pin');
  assert.match(pinFindings({ file: 'm.yaml', text: `${text}overrides: [a]\n`, pinned: manifestDigest(text) })[0].message, /only an owner ruling may add an override/);
});

test('the JSX reader finds the tags of the imported aliases with their attributes, nested braces and strings included', () => {
  const text = `import { Dropdown as HeroDropdown, type Key, Label } from "@heroui/react"\nconst a = <HeroDropdown.Item id="x" data-grammar-menu-item="true" className={cn("a b", { c: "}" })} {...rest}><Label>t</Label></HeroDropdown.Item>`;
  assert.deepEqual([...importAliases(text)], [['HeroDropdown', 'Dropdown'], ['Label', 'Label']]);
  const [item, label] = heroTags(text, ['HeroDropdown', 'Label']);
  assert.equal(item.part, 'Item');
  assert.deepEqual(item.attrs.map((attr) => attr.name), ['id', 'data-grammar-menu-item', 'className', '...']);
  assert.equal(label.part, 'Root');
});

test('the CSS reader flattens nesting and at-rule wrappers and names the paint families a rule sets', () => {
  const css = `.menu-item { @apply flex min-h-9 rounded-2xl px-2; &:has(.menu-item__indicator) { @apply ps-7; }\n  @media (hover: hover) { &:hover { @apply bg-default; } } }\n@layer x { .a, .b { color: red; padding-inline: 1px } }`;
  const flat = cssRules(css);
  assert.deepEqual(flat.map((rule) => rule.selectors), [['.menu-item'], ['.menu-item:has(.menu-item__indicator)'], ['.menu-item:hover'], ['.a', '.b']]);
  assert.deepEqual(flat[2].wraps, ['@media (hover: hover)']);
  assert.deepEqual(ruleFamilies(flat[0]), ['block-size', 'padding', 'radius']);
  assert.deepEqual(ruleFamilies(flat[3]), ['color', 'padding']);
  assert.deepEqual([utilityFamilies('ps-7'), utilityFamilies('text-sm'), utilityFamilies('text-muted'), utilityFamilies('md:text-wrap'), propertyFamily('padding-inline')], [['padding'], ['font'], ['color'], [], 'padding']);
});

const SKIN_FILE = 'skin/DropdownMenu.tsx';
const skinRow = (extra = {}) => row({ file: SKIN_FILE, ...extra });

test('a strict Grammar that drifts is red, a custom Grammar that re-skins and re-arranges is green', () => {
  const drifting = fixture('dropdown-menu.before-fix.tsx.txt');
  const wraps = ['Description', 'Dropdown', 'Header', 'Kbd', 'Label'];
  const css = [{ file: 'skin/x.css', text: '[data-grammar-menu-item] { padding: 0; border-radius: 0; background: red; }' }];
  // the same dot indicator, the same repaint: strict (core/) is red, custom (skin/) is green
  assert.ok(judge({ text: drifting, wrapper: row({ wraps }) }).some((finding) => finding.rule === 'default'));
  assert.deepEqual(judge({ text: drifting, file: SKIN_FILE, wrapper: skinRow({ wraps }), styles: css }).filter((finding) => finding.rule !== 'anatomy'), []);
  const strictCss = [{ file: 'core/x.css', text: '[data-grammar-menu-item] { padding: 0; }' }];
  assert.deepEqual(rules(judge({ text: fixture('dropdown-menu.at-b0a5d1f77.tsx.txt'), styles: strictCss })), ['style']);
  assert.deepEqual(judge({ text: fixture('dropdown-menu.at-b0a5d1f77.tsx.txt'), file: SKIN_FILE, wrapper: skinRow(), styles: [{ file: 'skin/x.css', text: strictCss[0].text }] }), []);
});

test('a custom Grammar is still held to HeroUI anatomy, behaviour and roles', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  // anatomy: a part the vendor does not have, a required part left out, no divider between sections
  const unknown = text.replace('<HeroDropdown.Menu', '<HeroDropdown.Rows').replace('</HeroDropdown.Menu>', '</HeroDropdown.Rows>');
  assert.ok(judge({ text: unknown, file: SKIN_FILE, wrapper: skinRow() }).some((finding) => finding.rule === 'anatomy' && /not a part of HeroUI Dropdown/.test(finding.message)));
  assert.ok(judge({ text: text.replace(/<HeroSeparator[^>]*\/>/g, ''), file: SKIN_FILE, wrapper: skinRow() }).some((finding) => /without HeroUI's Separator/.test(finding.message)));
  // a hand-rolled role instead of the HeroUI component, in a strict and in a custom Grammar
  const handRolled = `export const M = () => <ul role="menu"><li role="menuitem">x</li></ul>`;
  for (const [file, wrapper] of [[DROPDOWN_FILE, row({ wraps: [] })], [SKIN_FILE, skinRow({ wraps: [] })]]) {
    const roles = judge({ text: handRolled, file, wrapper }).filter((finding) => finding.rule === 'role');
    assert.equal(roles.length, 2, file);
  }
  // a pinned role override declares a deliberate exception (HeroUI has no such component)
  const declared = row({ wraps: [], overrides: [{ kind: 'role', target: `${DROPDOWN_FILE}:menu`, reason: 'r' }, { kind: 'role', target: `${DROPDOWN_FILE}:menuitem`, reason: 'r' }] });
  assert.deepEqual(judge({ text: handRolled, wrapper: declared }), []);
  // a role in a comment or a selector string is not a hand-rolled element
  assert.deepEqual(judge({ text: "// <ul role=\"menu\">\nconst q = el.closest(\"[role='tab']\")", wrapper: row({ wraps: [] }) }), []);
});

test('generated vendor roles cover tooltip, separator, table, toolbar and role expression values', () => {
  const wrapper = row({ wraps: [] });
  for (const role of ['tooltip', 'separator', 'table', 'toolbar', 'textbox']) {
    const findings = judge({ text: `const resolved = "${role}"; export const X = () => <div role={resolved} />`, wrapper });
    assert.equal(findings.filter((entry) => entry.rule === 'role').length, 1, role);
  }
  assert.equal(judge({ text: `export const X = () => <div role={open ? "tooltip" : "separator"} />`, wrapper }).filter((entry) => entry.rule === 'role').length, 2);
  assert.deepEqual(judge({ text: `export const X = () => <div role={kind === "tooltip" ? "presentation" : undefined} />`, wrapper }), []);
  assert.deepEqual(judge({ text: `export const X = () => <div role={(kind === "tooltip" ? "presentation" : undefined)} />`, wrapper }), []);
  assert.deepEqual(judge({ text: `const s = '<span role="tooltip" />'; /* <div role="separator" /> */`, wrapper }), []);
  for (const text of [
    'const resolved: AriaRole = "tooltip"; export const X = () => <span role={resolved} />',
    'export const X = () => <span role={"tooltip" as AriaRole} />',
    'export const X = () => <span role={"tooltip" satisfies AriaRole} />',
    'const resolved: AriaRole = open\n    ? "tooltip"\n    : undefined\nexport const X = () => <span role={resolved} />',
  ]) assert.equal(judge({ text, wrapper }).filter((entry) => entry.rule === 'role').length, 1);
  const mapping = 'const ROLES: Record<string, AriaRole | undefined> = {\n    off: undefined,\n    annotation: "tooltip",\n    seam: "separator",\n} as const\n';
  assert.equal(judge({ text: mapping + '<span role={ROLES[kind]} />', wrapper }).filter((entry) => entry.rule === 'role').length, 2);
  assert.equal(judge({ text: mapping + '<span role={ROLES["annotation"]} />', wrapper }).filter((entry) => entry.rule === 'role').length, 1);
  assert.equal(judge({ text: mapping + '<span role={ROLES.seam} />', wrapper }).filter((entry) => entry.rule === 'role').length, 1);
  assert.deepEqual(judge({ text: mapping + '<span role={ROLES.off} />', wrapper }), []);
  const index = { ...references, roles: { ...references.roles, roles: { ...references.roles.roles, futurewidget: { componentRole: true, contracts: ['FutureWidget.Root'] } } } };
  const findings = parityFindings({ grammars: GRAMMARS, references: index, manifest: manifest(wrapper), sources: [{ file: DROPDOWN_FILE, text: '<div role={"futurewidget"} />' }], styles: [] });
  assert.equal(findings.filter((entry) => entry.rule === 'role').length, 1, 'the reader follows the generated data, not a literal role list');
});

test('HeroUI Tooltip anatomy and Separator delegation are green while their native replacements are red', () => {
  const text = `import { Tooltip as HeroTooltip, Separator as HeroSeparator } from "@heroui/react"; export const X = () => <HeroTooltip><HeroTooltip.Trigger /><HeroTooltip.Content>x</HeroTooltip.Content><HeroSeparator /></HeroTooltip>`;
  assert.deepEqual(judge({ text, wrapper: row({ wraps: ['Separator', 'Tooltip'] }) }), []);
  assert.equal(judge({ text: '<span role="tooltip">x</span><div role={"separator"} />', wrapper: row({ wraps: [] }) }).filter((entry) => entry.rule === 'role').length, 2);
  assert.ok(judge({ text: text.replace('<HeroTooltip.Content>x</HeroTooltip.Content>', ''), wrapper: row({ wraps: ['Separator', 'Tooltip'] }) }).some((entry) => entry.rule === 'anatomy'));
  assert.equal(judge({ text: 'import { Separator as HeroSeparator } from "@heroui/react"; export const X = () => <HeroSeparator role="tooltip" />', wrapper: row({ wraps: ['Separator'] }) }).filter((entry) => entry.rule === 'role').length, 1, 'a vendor component cannot claim another component role');
});

test('vendor role props and a compatible forwarded render root remain under vendor custody', () => {
  const meter = { component: 'Meter', anatomy: { parts: [], required: [], embeds: [] }, parts: { Root: {} }, css: { classes: [], dataSlots: [] } };
  const refs = { ...references, meter };
  const wrapper = row({ wraps: ['Meter'] });
  const judgeMeter = (text) => parityFindings({ grammars: GRAMMARS, references: refs, manifest: manifest(wrapper), sources: [{ file: DROPDOWN_FILE, text }], styles: [] });
  const prefix = 'import { Meter as HeroMeter } from "@heroui/react";\n';
  assert.deepEqual(judgeMeter(prefix + 'const Root = (domProps) => <div {...domProps} role="meter" />;\nexport const M = () => <HeroMeter render={Root} />'), []);
  assert.deepEqual(judgeMeter(prefix + 'export const M = () => <HeroMeter role="meter" />'), []);
  assert.deepEqual(judgeMeter(prefix + 'export const M = () => <HeroMeter render={(domProps) => <div {...domProps} role="meter" />} />'), []);
  assert.equal(judgeMeter(prefix + 'const Root = (domProps) => <div {...domProps} role="tooltip" />;\nexport const M = () => <HeroMeter render={Root} />').filter((entry) => entry.rule === 'role').length, 1);
  assert.equal(judgeMeter(prefix + 'const Root = () => <div role="meter" />;\nexport const M = () => <HeroMeter render={Root} />').filter((entry) => entry.rule === 'role').length, 1);
  assert.equal(judgeMeter(prefix + 'const Root = (domProps) => <div {...domProps} role="meter"><span role="tooltip" /></div>;\nexport const M = () => <HeroMeter render={Root} />').filter((entry) => entry.rule === 'role').length, 1);
  assert.equal(judgeMeter(prefix + 'const Root = (domProps) => <div {...domProps} role="meter" />;\nexport const M = () => <><HeroMeter render={Root} /><div role="meter" /></>').filter((entry) => entry.rule === 'role').length, 1);
});

test('component-role ownership uses ARIA taxonomy and public APIs without equating generic group/status with widgets', () => {
  const carriers = new Map([['group', ['ButtonGroup.Root']], ['status', ['Spinner.Root']], ['textbox', ['TextField.Root']], ['tooltip', ['Tooltip.Content']], ['separator', ['Separator.Root']]]);
  const structure = { superClass: [['roletype', 'structure', 'section']] };
  const ariaRoles = new Map([['group', structure], ['status', structure], ['textbox', { superClass: [['roletype', 'widget', 'input']] }], ['tooltip', structure], ['separator', structure], ['table', structure]]);
  const classified = classifyRoleContracts({ carriers, publicApis: ['ButtonGroup', 'Spinner', 'TextField', 'Tooltip', 'Separator', 'Table'], ariaRoles });
  assert.equal(classified.group.componentRole, false);
  assert.equal(classified.status.componentRole, false);
  assert.equal(classified.textbox.componentRole, true);
  assert.equal(classified.tooltip.componentRole, true);
  assert.equal(classified.separator.componentRole, true);
  assert.equal(classified.table.componentRole, true, 'a public structural API is known even when its default rendering uses a more specific role');
  assert.deepEqual(judge({ text: '<div role="group"><span role="status">Working</span></div>', wrapper: row({ wraps: [] }) }), []);
});

test('a missing, empty or malformed generated role index refuses parity measurement', () => {
  for (const roles of [undefined, { schema: 'wrong', roles: {} }, { schema: 'starci/vendor-heroui-roles@1', roles: {} }, { schema: 'starci/vendor-heroui-roles@1', roles: { tooltip: null } }]) {
    const findings = parityFindings({ grammars: GRAMMARS, references: { ...references, roles }, manifest: manifest(row()), sources: [{ file: DROPDOWN_FILE, text: fixture('dropdown-menu.at-b0a5d1f77.tsx.txt') }], styles: [] });
    assert.deepEqual(rules(findings), ['reference']);
  }
});

test('DNA owns family paths and mode; missing or malformed declarations are grammar findings', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  const input = { references, manifest: manifest(row()), sources: [{ file: DROPDOWN_FILE, text }], styles: [] };
  const orphan = parityFindings({ ...input, grammars: GRAMMARS, sources: [{ file: 'elsewhere/Menu.tsx', text }], manifest: manifest(row({ file: 'elsewhere/Menu.tsx' })) });
  assert.ok(orphan.some((entry) => entry.rule === 'grammar' && /belongs to no declared Grammar/.test(entry.message)));
  const legacy = { ...input.manifest, grammars: GRAMMARS };
  assert.ok(parityFindings({ ...input, manifest: legacy }).some((entry) => entry.rule === 'grammar'), 'a manifest declaration cannot replace missing DNA');
  for (const extra of [{ vendor: { name: 'heroui', parity: 'loose' } }, { arrangement: {} }, { paths: [] }, { paths: 'core/' }]) {
    const grammars = [{ ...GRAMMARS[0], ...extra }];
    assert.ok(parityFindings({ ...input, grammars }).some((entry) => entry.rule === 'grammar' && /in its DNA/.test(entry.message)));
  }
  const custom = [{ ...GRAMMARS[0], vendor: { name: 'heroui', parity: 'custom' } }];
  const styles = [{ file: 'core/x.css', text: '[data-grammar-menu-item] { padding: 0; }' }];
  assert.deepEqual(parityFindings({ ...input, grammars: custom, styles, manifest: legacy }), [], 'source DNA custom mode wins over a legacy strict manifest declaration');
});

test('strict repaint findings retain the Grammar value, wrapper, DNA family and measured vendor defaults', () => {
  const text = fixture('dropdown-menu.at-b0a5d1f77.tsx.txt');
  const [entry] = judge({ text, styles: [{ file: 'common/x.css', text: '@media (min-width: 40rem) { [data-grammar-menu-item] { padding-inline: 0; } }' }] });
  assert.equal(entry.selector, '[data-grammar-menu-item]');
  assert.equal(entry.part, 'Dropdown.Item');
  assert.equal(entry.property, 'padding');
  assert.equal(entry.family, 'starci');
  assert.equal(entry.wrapperRow, DROPDOWN_FILE);
  assert.deepEqual(entry.grammarValue, { apply: [], declarations: [{ property: 'padding-inline', value: '0' }], wraps: ['@media (min-width: 40rem)'] });
  assert.ok(entry.vendorDefault.some((rule) => rule.apply.some((utility) => utility.startsWith('px-'))));
});
