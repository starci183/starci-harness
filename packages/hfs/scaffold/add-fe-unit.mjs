// starci app add <block|composite|branch|leaf> <name> - one front-end unit, already in the shape-slot pattern.
//
// The bodies are templates/fe/units/<tier>/; this module only fills them and places them (contexts/code/fe function.md
// FE-FUNCTION-2..4 and FE-FUNCTION-7, README.md FE-ERROR-1).
//
//   starci app add block handoff-block                                  HandoffBlock: one read folded into a DataSlot, no shape
//   starci app add block handoff-block --shapes prepared,sent,returned  plus HANDOFF_BLOCK_SHAPES, HandoffBlockShape and an exhaustive switch
//   starci app add composite term-value | branch disclosure | leaf status-label
//
// A block reads `useQuery<Read>Swr` of hooks/swr (`--read`, default: the block name without its `Block` suffix; `add table --fe`
// writes that hook). A block with shapes takes its shape from the read's `status` (the placeholder's own while the read loads), so
// the read names its shape in that field. The first block of an app also writes the app's one copy of the status owners
// (FE-ERROR-1): DataSlot and SlotLabels in modules/types, slotOfSwr/mapSlot/loadingSlot in hooks/slot/slot.shared.ts,
// useSlotLabels, the SlotView composite and the shared `status` namespace of every catalog. Nothing that exists is overwritten.
// A composite, branch or leaf, SlotView among them, is vocabulary that knows no feature: in a front end of two or more apps with
// the shared ui package (slot fe.package.ui) it lives in that package and its barrel, DataSlot and SlotLabels are declared beside
// SlotView there and modules/types re-exports them (R91 `monorepo-tier-belongs-to-its-side`); else it lives in the app's components.
// A shape that names a data status is refused by the lint (R92 `no-data-status-shape`), which owns that word list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScaffoldError, camelOf, pascalOf } from './service.mjs';
import { coreFeApps } from './app.mjs';

const UNITS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'fe', 'units');

/** The nouns this module answers, and the components layer each one writes into. */
export const FE_UNIT_LAYERS = Object.freeze({ block: 'blocks', composite: 'composites', branch: 'branches', leaf: 'leaves' });

/** The shared status copy of FE-ERROR-1, by catalog locale; any other locale takes the English sentences. */
const STATUS_COPY = Object.freeze({
  en: { forbidden: 'You do not have access to this.', error: 'This could not be loaded.', retry: 'Try again' },
  vi: { forbidden: 'Bạn không có quyền xem phần này.', error: 'Không tải được phần này.', retry: 'Thử lại' },
});
/** The empty sentence of a new block, by catalog locale. */
const EMPTY_COPY = Object.freeze({ en: 'Nothing to show yet.', vi: 'Chưa có gì để hiển thị.' });

export const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean).map((word) => word.toLowerCase());
export const humanOf = (name) => { const text = words(name).join(' '); return text[0].toUpperCase() + text.slice(1); };

/** A template body with its `{{name}}` variables filled; a variable without a value is a template error, never left in place. */
export function fill(file, vars) {
  const body = fs.readFileSync(path.join(UNITS_DIR, ...file.split('/')), 'utf8').replace(/\r\n/g, '\n');
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(vars, key)) throw new ScaffoldError('HFS_SCAFFOLD_TEMPLATE_VARIABLE', `templates/fe/units/${file} names {{${key}}}, which has no value`);
    return vars[key];
  });
}

/** The parsed hfs.json of the app root. */
export function declarationOf(repoRoot) {
  const declarationFile = path.join(repoRoot, 'hfs.json');
  if (!fs.existsSync(declarationFile)) throw new ScaffoldError('HFS_ADD_NOT_AN_APP', 'starci app add needs the app root hfs.json');
  return JSON.parse(fs.readFileSync(declarationFile, 'utf8'));
}

/** The one product app the unit belongs to: `--app`, else the only product Next app of hfs.json. */
export function appOf(declaration, requested) {
  const apps = coreFeApps(declaration.sides?.fe?.apps ?? []);
  if (requested !== undefined) {
    if (!apps.some((entry) => entry.name === requested)) throw new ScaffoldError('HFS_ADD_NO_FRONT_END', `${requested} is not a product Next app of hfs.json`);
    return requested;
  }
  if (apps.length !== 1) throw new ScaffoldError('HFS_ADD_NO_FRONT_END', `a front-end unit names its app with --app when hfs.json declares ${apps.length} product Next apps`);
  return apps[0].name;
}

/**
 * Where the vocabulary tiers go: the shared ui package (`fe/packages/<project>-ui`: its folder and its import name) when the front
 * end has two or more apps and the package exists, else null (the app's own components).
 */
function sharedUiOf(repoRoot, declaration) {
  if ((declaration.sides?.fe?.apps ?? []).length < 2) return null;
  const relative = `fe/packages/${declaration.project}-ui`;
  const manifest = path.join(repoRoot, ...relative.split('/'), 'package.json');
  if (!fs.existsSync(manifest)) return null;
  return { relative, name: JSON.parse(fs.readFileSync(manifest, 'utf8')).name };
}

/** The shape members of `--shapes a,b,c`: none, or two or more distinct camelCase words, in the order given. */
function shapesOf(option) {
  if (option === undefined || option === false) return [];
  const shapes = (Array.isArray(option) ? option : String(option).split(',')).map((value) => value.trim()).filter(Boolean);
  if (shapes.length < 2) throw new ScaffoldError('HFS_ADD_SHAPES_INVALID', '--shapes names two or more drawn shapes; a unit with one shape takes none');
  if (new Set(shapes).size !== shapes.length) throw new ScaffoldError('HFS_ADD_SHAPES_INVALID', `--shapes repeats a member: ${shapes.join(',')}`);
  const unworded = shapes.find((shape) => !/^[a-z][a-zA-Z0-9]*$/.test(shape));
  if (unworded !== undefined) throw new ScaffoldError('HFS_ADD_SHAPES_INVALID', `the shape "${unworded}" is not a camelCase word`);
  return shapes;
}

/** Writes one file the unit owns (`relative` to the repository root); the unit's own files must not exist yet. */
export function writeNew(created, repoRoot, relative, body) {
  const file = path.join(repoRoot, ...relative.split('/'));
  if (fs.existsSync(file)) throw new ScaffoldError('HFS_ADD_EXISTS', `${relative} already exists; starci app add never overwrites a unit`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  created.push(relative);
}

/** Writes one shared file only when it is missing (the status owners have one copy per app). */
function writeOnce(created, repoRoot, relative, body) {
  const file = path.join(repoRoot, ...relative.split('/'));
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  created.push(relative);
}

/** Adds `line` to a barrel, creating it, unless the barrel already has it. */
export function exportFrom(created, repoRoot, relative, line) {
  const file = path.join(repoRoot, ...relative.split('/'));
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (before.split(/\r?\n/).includes(line)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${line}\n`);
  if (!created.includes(relative)) created.push(relative);
}

/** The app's one copy of the FE-ERROR-1 owners, written by the first block that needs them; SlotView is shared vocabulary. */
function ensureSlotOwners(created, { repoRoot, appBase, ui }) {
  const types = fill('slot/data-slot.ts.tpl', {});
  if (ui === null) {
    writeOnce(created, repoRoot, `${appBase}/src/modules/types/data-slot.ts`, types);
    exportFrom(created, repoRoot, `${appBase}/src/modules/types/index.ts`, 'export type { DataSlot, SlotLabels } from "./data-slot"');
    writeOnce(created, repoRoot, `${appBase}/src/components/composites/SlotView/index.tsx`, fill('slot/SlotView.tsx.tpl', { slotTypes: 'import type { DataSlot, SlotLabels } from "@/modules/types"\n' }));
  } else {
    writeOnce(created, repoRoot, `${ui.relative}/src/composites/SlotView/index.tsx`, fill('slot/SlotView.tsx.tpl', { slotTypes: `\n${types}` }));
    exportFrom(created, repoRoot, `${ui.relative}/src/index.ts`, 'export { SlotView } from "./composites/SlotView"');
    exportFrom(created, repoRoot, `${ui.relative}/src/index.ts`, 'export type { DataSlot, SlotLabels } from "./composites/SlotView"');
    exportFrom(created, repoRoot, `${appBase}/src/modules/types/index.ts`, `export type { DataSlot, SlotLabels } from "${ui.name}"`);
  }
  writeOnce(created, repoRoot, `${appBase}/src/hooks/slot/slot.shared.ts`, fill('slot/slot.shared.ts.tpl', {}));
  writeOnce(created, repoRoot, `${appBase}/src/hooks/slot/useSlotLabels.ts`, fill('slot/useSlotLabels.ts.tpl', {}));
  exportFrom(created, repoRoot, `${appBase}/src/hooks/slot/index.ts`, 'export { loadingSlot, mapSlot, slotOfSwr } from "./slot.shared"');
  exportFrom(created, repoRoot, `${appBase}/src/hooks/slot/index.ts`, 'export { useSlotLabels } from "./useSlotLabels"');
}

/**
 * Adds namespaces to every catalog of the app, keeping what is there: `namespacesOf(locale)` gives `{ namespace: copy }`, and a
 * namespace the catalog already has is left as it is.
 */
export function addCatalogNamespaces(created, { repoRoot, appBase }, namespacesOf) {
  const dir = path.join(repoRoot, ...appBase.split('/'), 'src', 'modules', 'i18n', 'messages');
  if (!fs.existsSync(dir)) throw new ScaffoldError('HFS_ADD_WIRE_MISSING', 'a front-end unit reads its copy from modules/i18n/messages, which does not exist');
  for (const entry of fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()) {
    const file = path.join(dir, entry);
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = JSON.stringify(catalog);
    for (const [namespace, copy] of Object.entries(namespacesOf(entry.slice(0, -'.json'.length)))) catalog[namespace] ??= copy;
    if (JSON.stringify(catalog) === before) continue;
    fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
    created.push(`${appBase}/src/modules/i18n/messages/${entry}`);
  }
}

/** The shared `status` namespace and the block's own namespace. */
function addCatalogKeys(created, place, { nameCamel, title, shapes }) {
  addCatalogNamespaces(created, place, (locale) => ({
    status: { ...(STATUS_COPY[locale] ?? STATUS_COPY.en) },
    [nameCamel]: {
      title,
      empty: EMPTY_COPY[locale] ?? EMPTY_COPY.en,
      ...(shapes.length ? { shapes: Object.fromEntries(shapes.map((shape) => [shape, humanOf(shape)])) } : {}),
    },
  }));
}

/** The pure half's shape inventory, union and exhaustive switch (FE-FUNCTION-7): one case per member, in the given order. */
function shapeParts({ Name, NAME_UPPER, shapes }) {
  const cases = shapes.map((shape) => [
    `        case "${shape}":`,
    '            return (',
    '                <>',
    `                    <Text isSkeleton={isSkeleton}>{shapeLabels.${shape}}</Text>`,
    '                    <Text isSkeleton={isSkeleton}>{item.id}</Text>',
    '                </>',
    '            )',
  ].join('\n')).join('\n');
  return {
    shapeDeclarations: [
      '',
      `/** The drawn shapes of ${Name}, in the order the owner approved them: one drawing and one story each, never a data status. */`,
      `export const ${NAME_UPPER}_SHAPES = [${shapes.map((shape) => `"${shape}"`).join(', ')}] as const`,
      '',
      `/** One drawn shape of ${Name}. */`,
      `export type ${Name}Shape = (typeof ${NAME_UPPER}_SHAPES)[number]`,
      '',
    ].join('\n'),
    shapeBody: [
      '',
      `/** The ready tree of one drawn shape: one case per member of ${Name}Shape, so a member nobody draws fails the lint. */`,
      `const readyTreeOf = (shape: ${Name}Shape, shapeLabels: ${Name}BaseProps["props"]["shapeLabels"], item: ${Name}Item, isSkeleton: boolean) => {`,
      '    switch (shape) {',
      cases,
      '    }',
      '}',
      '',
    ].join('\n'),
    shapeOfHelper: `\n/** The drawn shape a read's \`status\` names; a status no shape draws takes the placeholder's. */\nconst shapeOf = (status: string): ${Name}Shape => ${NAME_UPPER}_SHAPES.find((shape) => shape === status) ?? ${NAME_UPPER}_PLACEHOLDER.shape\n`,
  };
}

/** The variables of the block templates; the shape parts are empty when the block has one shape. */
function blockVars({ Name, nameCamel, nameKebab, Read, shapes, title, ui }) {
  const NAME_UPPER = words(Name).join('_').toUpperCase();
  const shaped = shapes.length > 0;
  const parts = shaped ? shapeParts({ Name, NAME_UPPER, shapes }) : { shapeDeclarations: '', shapeBody: '', shapeOfHelper: '' };
  const story = (shape) => pascalOf(shape);
  const readyStories = (shaped ? shapes : ['ready']).map((shape) => [
    '',
    `/** The ${shaped ? `${shape} shape` : 'ready read'}, settled. */`,
    `export const ${story(shape)}: Story = {`,
    ...(shaped ? [`    args: { shape: "${shape}" },`] : []),
    `    parameters: { dna: { pair: "${story(shape)}", phase: "ready" } },`,
    '}',
  ].join('\n')).join('\n');
  return {
    Name, nameCamel, nameKebab, Read, title, NAME_UPPER, ...parts,
    slotViewFrom: ui === null ? '@/components/composites/SlotView' : ui.name,
    itemShapeMember: shaped ? `    readonly shape: ${Name}Shape\n` : '',
    shapeMember: shaped ? `    readonly shape: ${Name}Shape\n` : '',
    shapeLabelsMember: shaped ? `        readonly shapeLabels: { ${shapes.map((shape) => `readonly ${shape}: string`).join('; ')} }\n` : '',
    placeholderShapeDoc: shaped ? ', and its shape is the block\'s while the read loads' : '',
    placeholderShape: shaped ? `, shape: "${shapes[0]}"` : '',
    readyTree: shaped ? 'readyTreeOf(props.shape, props.props.shapeLabels, item, isSkeleton)' : '<Text isSkeleton={isSkeleton}>{item.id}</Text>',
    componentImports: shaped ? `${NAME_UPPER}_PLACEHOLDER, ${NAME_UPPER}_SHAPES, ${Name}Base` : `${Name}Base`,
    componentTypeImport: shaped ? `import type { ${Name}Shape } from "./component"\n` : '',
    connectedDoc: shaped ? 'takes its shape from the read (the placeholder\'s while it loads), ' : '',
    itemShapeMapped: shaped ? ', shape: shapeOf(value.status)' : '',
    shapeAttribute: shaped ? `            shape={(item.items ?? ${NAME_UPPER}_PLACEHOLDER).shape}\n` : '',
    shapeLabelsResolved: shaped ? `                shapeLabels: { ${shapes.map((shape) => `${shape}: t("shapes.${shape}")`).join(', ')} },\n` : '',
    shapeLabelsFixture: shaped ? `    shapeLabels: { ${shapes.map((shape) => `${shape}: "${humanOf(shape)}"`).join(', ')} },\n` : '',
    fixtureShape: shaped ? `, shape: "${shapes[0]}"` : '',
    shapeArg: shaped ? `shape: "${shapes[0]}", ` : '',
    storiesDoc: shaped ? 'one story per drawn shape' : 'the settled read',
    readyStories,
    firstStory: story(shaped ? shapes[0] : 'ready'),
  };
}

/** Writes one block: its two halves (the pure one with its shapes, when it has them), its stories and its copy. */
function addBlock({ created, place, names, options }) {
  const shapes = shapesOf(options.shapes);
  const nameWords = words(names.Name);
  const read = options.read ?? (nameWords.at(-1) === 'block' && nameWords.length > 1 ? nameWords.slice(0, -1).join('-') : names.nameKebab);
  const vars = blockVars({ ...names, Read: pascalOf(read), shapes, title: humanOf(names.Name), ui: place.ui });
  const folder = `${place.appBase}/src/components/blocks/${names.Name}`;
  const stories = `${place.appBase}/stories/blocks/${names.Name}.stories.tsx`;
  for (const relative of [folder, stories]) {
    if (fs.existsSync(path.join(place.repoRoot, ...relative.split('/')))) throw new ScaffoldError('HFS_ADD_EXISTS', `${relative} already exists; starci app add never overwrites a unit`);
  }
  ensureSlotOwners(created, place);
  writeNew(created, place.repoRoot, `${folder}/index.tsx`, fill('block/index.tsx.tpl', vars));
  writeNew(created, place.repoRoot, `${folder}/component.tsx`, fill('block/component.tsx.tpl', vars));
  writeNew(created, place.repoRoot, stories, fill('block/stories.tsx.tpl', vars));
  addCatalogKeys(created, place, { nameCamel: names.nameCamel, title: vars.title, shapes });
}

/** Writes one composite, branch or leaf: into the shared ui package and its barrel, or into the app's components. */
function addVocabulary({ created, place, noun, Name }) {
  const layer = FE_UNIT_LAYERS[noun];
  const body = fill(`${noun}/index.tsx.tpl`, { Name });
  if (place.ui === null) {
    writeNew(created, place.repoRoot, `${place.appBase}/src/components/${layer}/${Name}/index.tsx`, body);
    return;
  }
  writeNew(created, place.repoRoot, `${place.ui.relative}/src/${layer}/${Name}/index.tsx`, body);
  exportFrom(created, place.repoRoot, `${place.ui.relative}/src/index.ts`, `export { ${Name} } from "./${layer}/${Name}"`);
}

/**
 * Generates one front-end unit of the shape-slot pattern in the app at `repoRoot`.
 *
 * @param {{ repoRoot: string, noun: string, name: string, options?: { app?: string, shapes?: string | string[], read?: string } }} input - The app root, the tier noun, the unit name (kebab or PascalCase) and its options.
 * @returns {{ created: string[] }} The files written or extended, relative to the app root (the folder of hfs.json).
 */
export function addFeUnit({ repoRoot, noun, name, options = {} }) {
  if (!Object.hasOwn(FE_UNIT_LAYERS, noun)) throw new ScaffoldError('HFS_ADD_UNKNOWN_NOUN', `${noun} is not a front-end unit tier`);
  const Name = pascalOf(name);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(Name)) throw new ScaffoldError('HFS_ADD_NAME_INVALID', `${name} is not a unit name`);
  if (noun !== 'block' && options.shapes !== undefined) throw new ScaffoldError('HFS_ADD_SHAPES_INVALID', `a ${noun} has no shapes; a pure half with shapes is a block's`);
  const declaration = declarationOf(repoRoot);
  const place = { repoRoot, appBase: `fe/apps/${appOf(declaration, options.app)}`, ui: sharedUiOf(repoRoot, declaration) };
  const created = [];
  if (noun === 'block') addBlock({ created, place, names: { Name, nameCamel: camelOf(Name), nameKebab: words(Name).join('-') }, options });
  else addVocabulary({ created, place, noun, Name });
  return { created };
}
