// fe-unit-shape-slot.spec.mjs - `starci app add block|composite|branch|leaf|page|overlay|layout` writes every front-end unit
// already in the canon's shape (contexts/code/fe function.md FE-FUNCTION-2..7, README FE-ERROR-1, boundaries.md FE-BOUNDARY-1,
// contexts/ui composition.md STATE-8, page-header.md, dialog-drawer.md). A block with three shapes and one slot, a composite, a
// branch, a leaf, a page composing the block, a modal, a drawer holding a form and a segment layout are added to a scaffolded full
// app and linted with the starci-fe canon and the core Grammar's rules, as the app's own fe/eslint.config.mjs would; the same units
// are type-checked under the @starci/tsconfig next preset in a small app whose library types are stubs written here (the app's own
// modules/api is the skeleton template itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { loadHfs, starciFeConfig } from '../../eslint-canon-fe/src/index.ts';
import grammarCore, { recommended as grammarRecommended } from '../../eslint-grammar-core/src/index.ts';
import { bundledPresets } from '../sync/index.mjs';
import { addKind } from '../scaffold/add.mjs';
import { scaffoldApp, starterDeclaration } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { gitAdd, installTypeScript } from './helpers/hfs-cli-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES = path.join(HERE, '..', '..');
const SKELETON_API = path.join(HERE, '..', 'templates', 'fe', 'skeleton', 'apps', '__app__', 'src', 'modules', 'api');
const SHAPES = ['prepared', 'sent', 'returned'];
const UNITS = ['composite:term-value', 'branch:disclosure', 'leaf:status-label'];
/** The route and overlay owners, added after the block they compose: [noun, name, options]. */
const OWNERS = [
  ['page', 'handoffs', { blocks: 'sign-in-form' }],
  ['page', 'settings/billing', {}],
  ['page', 'account', { tabs: 'profile,security' }],
  ['overlay', 'invite-member', { kind: 'modal' }],
  ['overlay', 'edit-details', { kind: 'drawer', form: true }],
  ['layout', 'settings', { blocks: 'sign-in-form' }],
];

/** A block that takes no input, as the skeleton's SignInForm: the one kind a generated page or layout composes. */
const SIGN_IN_FORM = [
  'import { Text } from "@starci/grammar/common"',
  '',
  '/** A block that takes no input. */',
  'export const SignInForm = () => <Text>Sign in</Text>',
  '',
].join('\n');

/** The read the block names (`useQueryHandoffSwr`), shaped as `add table --fe` writes it: a GraphQLResponse of a row with a status. */
const READ_HOOK = [
  'import type { GraphQLResponse } from "@/modules/api"',
  '',
  '/** The handoff read the block folds; a settled answer stands in for the SWR cache. */',
  'export const useQueryHandoffSwr = (id: string): { readonly data: GraphQLResponse<{ readonly id: string; readonly status: string }> | undefined; readonly error: unknown; readonly isLoading: boolean; readonly mutate: () => Promise<unknown> } => ({',
  '    data: { success: true, data: { id, status: "sent" } },',
  '    error: undefined,',
  '    isLoading: false,',
  '    mutate: () => Promise.resolve(undefined),',
  '})',
  '',
].join('\n');

/** The library surfaces the units import, as the minimum their real packages declare. */
const STUBS = {
  'react/index.d.ts': [
    'export type ReactNode = string | number | boolean | null | undefined | ReactElement | Iterable<ReactNode> | Promise<ReactNode>',
    'export interface ReactElement { readonly type: unknown; readonly props: unknown; readonly key: string | null }',
    'export declare function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]',
  ].join('\n'),
  'react/jsx-runtime.d.ts': [
    'import type { ReactElement, ReactNode } from "./index"',
    'export namespace JSX {',
    '    type ElementType = string | ((props: never) => ReactNode)',
    '    interface Element extends ReactElement {}',
    '    interface ElementChildrenAttribute { children: object }',
    '    interface IntrinsicElements { [name: string]: Record<string, unknown> }',
    '}',
    'export declare function jsx(type: unknown, props: unknown, key?: string): ReactElement',
    'export declare const jsxs: typeof jsx',
    'export declare const Fragment: unique symbol',
  ].join('\n'),
  'react/package.json': '{"name":"react","types":"index.d.ts","exports":{".":{"types":"./index.d.ts"},"./jsx-runtime":{"types":"./jsx-runtime.d.ts"}}}',
  'next-intl/index.d.ts': 'export declare function useTranslations(namespace: string): (key: string) => string',
  'next-intl/server.d.ts': 'export declare function getTranslations(namespace: string): Promise<(key: string) => string>',
  'next-intl/package.json': '{"name":"next-intl","types":"index.d.ts","exports":{".":{"types":"./index.d.ts"},"./server":{"types":"./server.d.ts"}}}',
  'next/index.d.ts': 'export interface Metadata { readonly title?: string }',
  'next/package.json': '{"name":"next","types":"index.d.ts"}',
  '@starci/grammar/common.d.ts': [
    'import type { ReactNode } from "react"',
    'export declare const SurfaceCard: (props: { readonly label: string; readonly children: ReactNode }) => ReactNode',
    'export declare const Text: (props: { readonly children?: ReactNode; readonly tone?: "default" | "muted" | "accent"; readonly isSkeleton?: boolean }) => ReactNode',
    'export declare const Badge: (props: { readonly children?: ReactNode; readonly isSkeleton?: boolean }) => ReactNode',
    'export declare const Button: (props: { readonly intent?: "dismiss" | "neutral" | "alternative" | "commit"; readonly type?: "button" | "submit"; readonly form?: string; readonly onPress?: () => void; readonly children?: ReactNode }) => ReactNode',
    'export declare const EmptyNotice: (props: { readonly message: string; readonly actionLabel?: string; readonly onAction?: () => void }) => ReactNode',
    'type Crumb = { readonly id: string; readonly label: string; readonly href?: string }',
    'type PageTabs = { readonly label: string; readonly items: ReadonlyArray<{ readonly id: string; readonly label: string; readonly href?: string }>; readonly selectedKey?: string }',
    'export declare const Page: (props: { readonly header?: { readonly title: string; readonly breadcrumbs?: { readonly label: string; readonly items: ReadonlyArray<Crumb> }; readonly tabs?: PageTabs }; readonly isSkeleton?: boolean; readonly children: ReactNode }) => ReactNode',
    'export declare const Alert: (props: { readonly title: string; readonly tone?: "negative"; readonly action?: { readonly label: string; readonly onAction: () => void } }) => ReactNode',
    'type Shell = { readonly isOpen?: boolean; readonly onOpenChange?: (isOpen: boolean) => void; readonly title: string; readonly trigger?: ReactNode; readonly closeLabel?: string; readonly footer?: ReactNode | ((close: () => void) => ReactNode); readonly children?: ReactNode }',
    'export declare const Dialog: (props: Shell) => ReactNode',
    'export declare const Drawer: (props: Shell & { readonly placement?: "left" | "right" | "top" | "bottom" }) => ReactNode',
    'export declare const Form: (props: { readonly id?: string; readonly label?: string; readonly onSubmit?: (data: FormData) => void; readonly children: ReactNode }) => ReactNode',
    'export declare const FormGrid: (props: { readonly columns?: 1 | 2; readonly children: ReactNode }) => ReactNode',
    'export declare const Input: (props: { readonly id: string; readonly name: string; readonly label: string; readonly isRequired?: boolean }) => ReactNode',
    'export declare const PrimaryRailLayout: (props: { readonly primary: ReactNode; readonly rail?: ReactNode }) => ReactNode',
  ].join('\n'),
  '@starci/grammar/package.json': '{"name":"@starci/grammar","exports":{"./common":{"types":"./common.d.ts"}}}',
  '@storybook/react-vite/index.d.ts': [
    'type PropsOf<C> = C extends (props: infer P) => unknown ? P : never',
    'export interface Meta<C> { readonly title?: string; readonly component?: C; readonly args?: Partial<PropsOf<C>> }',
    'export interface StoryObj<M> {',
    '    readonly args?: Partial<M extends { readonly component?: infer C } ? PropsOf<C> : never>',
    '    readonly parameters?: { readonly dna: { readonly pair: string; readonly phase: "ready" | "loading" } }',
    '}',
  ].join('\n'),
  '@storybook/react-vite/package.json': '{"name":"@storybook/react-vite","types":"index.d.ts"}',
};

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
};

/** Adds the block and the three lower units to the app at `root`; returns every file written, app-relative. */
const addUnits = (root) => {
  const block = addKind({ repoRoot: root, noun: 'block', name: 'handoff-block', options: { shapes: SHAPES.join(',') } });
  const units = UNITS.map((entry) => {
    const [noun, name] = entry.split(':');
    return addKind({ repoRoot: root, noun, name });
  });
  const owners = OWNERS.map(([noun, name, options]) => addKind({ repoRoot: root, noun, name, options }));
  return [...block.created, ...[...units, ...owners].flatMap((unit) => unit.created)];
};

/** A starter declaration with its product app `app`, the app's catalogs, its api module, the read and the library stubs. */
function stubbedApp(t) {
  const root = mkdtemp(t, 'starci-fe-unit-');
  write(path.join(root, 'hfs.json'), JSON.stringify(starterDeclaration('demo'), null, 2));
  const app = path.join(root, 'fe', 'apps', 'app');
  for (const locale of ['en', 'vi']) write(path.join(app, 'src', 'modules', 'i18n', 'messages', `${locale}.json`), JSON.stringify({ app: { title: 'Demo' } }, null, 2));
  for (const relative of ['index.ts', 'graphql/index.ts', 'graphql/types.ts']) {
    write(path.join(app, 'src', 'modules', 'api', ...relative.split('/')), fs.readFileSync(path.join(SKELETON_API, ...relative.split('/')), 'utf8'));
  }
  write(path.join(app, 'src', 'hooks', 'swr', 'index.ts'), READ_HOOK);
  write(path.join(app, 'src', 'modules', 'routes', 'index.ts'), 'export const APP_ROUTES = { home: "/" } as const');
  write(path.join(app, 'src', 'components', 'blocks', 'SignInForm', 'index.tsx'), SIGN_IN_FORM);
  for (const [relative, text] of Object.entries(STUBS)) write(path.join(app, 'node_modules', ...relative.split('/')), text);
  const preset = (name) => JSON.parse(fs.readFileSync(path.join(PACKAGES, 'tsconfig', `${name}.json`), 'utf8')).compilerOptions;
  const next = Object.fromEntries(Object.entries(preset('next')).filter(([key]) => key !== 'plugins' && key !== 'incremental'));
  write(path.join(root, 'fe', 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...preset('base'), ...next, types: [] }, exclude: ['node_modules'] }, null, 2));
  write(path.join(app, 'tsconfig.json'), JSON.stringify({
    extends: '../../tsconfig.json',
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'stories/**/*.tsx'],
    exclude: ['node_modules'],
  }, null, 2));
  return { root, app };
}

/** Type-checks the app through its own tsconfig; returns every diagnostic as `file message`. */
function typecheck(app) {
  const file = path.join(app, 'tsconfig.json');
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(file, ts.sys.readFile).config, ts.sys, app, undefined, file);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => `${diagnostic.file ? path.relative(app, diagnostic.file.fileName) : ''} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
}

const lockedOk = (root) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** The canon's flat config with only its own starci-fe rules on, plus every rule of the core Grammar's lint factory. */
const unitConfig = (fe) => [
  ...starciFeConfig({ hfs: loadHfs(pathToFileURL(path.join(fe, 'eslint.config.mjs'))) }).map((block) => (block.rules === undefined ? block : {
    ...block, rules: Object.fromEntries(Object.entries(block.rules).filter(([id]) => id.startsWith('starci-fe/'))),
  })),
  { files: ['**/*.ts', '**/*.tsx'], plugins: { 'starci-grammar': grammarCore }, rules: grammarRecommended },
];

test('the units added to a scaffolded full app pass the starci-fe canon and the core Grammar rules', { timeout: 300_000 }, async (t) => {
  const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-fe-unit-app-'), harness: { version: '1.1.0-alpha.3' }, edition: 'full',
    presets: bundledPresets(), lock: lockedOk, initGit: init, emitTypes: () => 'export type Database = Record<string, never>\n' });
  const app = path.join(root, 'fe', 'apps', 'app');
  write(path.join(app, 'src', 'hooks', 'swr', 'useQueryHandoffSwr.ts'), READ_HOOK);
  fs.appendFileSync(path.join(app, 'src', 'hooks', 'swr', 'index.ts'), 'export { useQueryHandoffSwr } from "./useQueryHandoffSwr"\n');
  const created = addUnits(root);
  // Two fe apps and the shared ui package: the vocabulary tiers, SlotView among them, are the package's (R91).
  for (const unit of ['composites/SlotView', 'composites/TermValue', 'branches/Disclosure', 'leaves/StatusLabel']) {
    assert.ok(created.includes(`fe/packages/demo-ui/src/${unit}/index.tsx`), `${unit} is written to the shared ui package`);
  }
  assert.match(fs.readFileSync(path.join(root, 'fe', 'packages', 'demo-ui', 'src', 'index.ts'), 'utf8'), /export \{ SlotView \} from "\.\/composites\/SlotView"/);
  gitAdd(installTypeScript(root));
  const fe = path.join(root, 'fe');
  const eslint = new ESLint({ cwd: fe, overrideConfigFile: true, overrideConfig: unitConfig(fe), errorOnUnmatchedPattern: false });
  const linted = [...new Set(created)].filter((relative) => /\/src\/.*\.tsx?$/.test(relative));
  const results = await eslint.lintFiles(linted.map((relative) => path.join(root, ...relative.split('/'))));
  assert.deepEqual(results.map((result) => path.relative(root, result.filePath).split(path.sep).join('/')).sort(), [...linted].sort(), 'every unit source is linted');
  // A unit or an overlay is added before the author places it, so nothing reaches it yet: reachability is the placement's verdict.
  const PLACEMENT = new Set(['starci-fe/dead-exports', 'starci-fe/owner-reachable']);
  const findings = results.flatMap((result) => result.messages.filter((message) => !PLACEMENT.has(message.ruleId))
    .map((message) => `${path.relative(fe, result.filePath).split(path.sep).join('/')}:${message.line} ${message.ruleId ?? 'parse'} ${message.message}`));
  assert.deepEqual(findings, []);
  // The skeleton's own page owners (the home and landing pages, the segment boundaries) hold the page frame law too.
  const skeletonPages = fs.globSync('apps/*/src/features/pages/**/*.tsx', { cwd: fe }).map((relative) => path.join(fe, relative));
  assert.ok(skeletonPages.length >= 4, 'the skeleton has page owners');
  const frame = (await eslint.lintFiles(skeletonPages)).flatMap((result) => result.messages.filter((message) => message.ruleId === 'starci-grammar/route-page-is-one-page')
    .map((message) => `${path.relative(fe, result.filePath).split(path.sep).join('/')}:${message.line} ${message.message}`));
  assert.deepEqual(frame, [], 'every skeleton page owner draws one Page (R325)');
});

test('add block with three shapes and one slot writes the pair, the shape inventory, the status owners and the stories; tsc is green', (t) => {
  const { app, root } = stubbedApp(t);
  const created = addUnits(root);
  for (const owner of ['src/modules/types/data-slot.ts', 'src/hooks/slot/slot.shared.ts', 'src/hooks/slot/useSlotLabels.ts', 'src/components/composites/SlotView/index.tsx']) {
    assert.ok(created.includes(`fe/apps/app/${owner}`), `the first block writes the status owner ${owner}`);
  }
  const pure = fs.readFileSync(path.join(app, 'src', 'components', 'blocks', 'HandoffBlock', 'component.tsx'), 'utf8');
  assert.match(pure, /export const HANDOFF_BLOCK_SHAPES = \["prepared", "sent", "returned"\] as const/);
  assert.match(pure, /export type HandoffBlockShape = \(typeof HANDOFF_BLOCK_SHAPES\)\[number\]/);
  assert.match(pure, /readonly shape: HandoffBlockShape/);
  assert.doesNotMatch(pure, /\bstate\b/, 'the pure half takes `shape`, never `state`');
  for (const shape of SHAPES) assert.match(pure, new RegExp(`case "${shape}":`), `the switch draws ${shape}`);
  const connected = fs.readFileSync(path.join(app, 'src', 'components', 'blocks', 'HandoffBlock', 'index.tsx'), 'utf8');
  assert.match(connected, /shape=\{\(item\.items \?\? HANDOFF_BLOCK_PLACEHOLDER\)\.shape\}/, 'the connected half takes the shape from the read, the placeholder\'s while it loads');
  assert.doesNotMatch(connected, /readonly shape/, 'no caller hands the block a shape');
  const stories = fs.readFileSync(path.join(app, 'stories', 'blocks', 'HandoffBlock.stories.tsx'), 'utf8');
  for (const shape of SHAPES) assert.match(stories, new RegExp(`args: \\{ shape: "${shape}" \\}`), `one story draws ${shape}`);
  assert.match(stories, /export const PreparedSkeleton: Story[\s\S]*loadingSlot\(\)[\s\S]*dna: \{ pair: "Prepared", phase: "loading" \}/);
  const catalog = JSON.parse(fs.readFileSync(path.join(app, 'src', 'modules', 'i18n', 'messages', 'vi.json'), 'utf8'));
  assert.deepEqual(Object.keys(catalog.status), ['forbidden', 'error', 'retry']);
  assert.deepEqual(Object.keys(catalog.handoffBlock.shapes), SHAPES);
  assert.deepEqual(typecheck(app), []);
});

test('a second block reuses the one copy of the status owners, and a block without shapes takes no shape', (t) => {
  const { root, app } = stubbedApp(t);
  addKind({ repoRoot: root, noun: 'block', name: 'handoff-block', options: { shapes: SHAPES } });
  const second = addKind({ repoRoot: root, noun: 'block', name: 'lead-list', options: { read: 'handoff' } });
  assert.ok(!second.created.some((relative) => relative.includes('/hooks/slot/') || relative.includes('/SlotView/')));
  const pure = fs.readFileSync(path.join(app, 'src', 'components', 'blocks', 'LeadList', 'component.tsx'), 'utf8');
  assert.doesNotMatch(pure, /readonly shape|switch/);
  assert.match(fs.readFileSync(path.join(app, 'stories', 'blocks', 'LeadList.stories.tsx'), 'utf8'), /export const ReadySkeleton/);
  assert.deepEqual(typecheck(app), []);
});

test('the scaffold refuses a single shape, a shape that is no camelCase word, shapes below a block and an existing unit', (t) => {
  const { root } = stubbedApp(t);
  assert.throws(() => addKind({ repoRoot: root, noun: 'block', name: 'a-block', options: { shapes: 'ready' } }), /two or more/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'block', name: 'a-block', options: { shapes: 'ready,Sent' } }), /camelCase/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'leaf', name: 'a-leaf', options: { shapes: 'a,b' } }), /no shapes/);
  addKind({ repoRoot: root, noun: 'leaf', name: 'a-leaf' });
  assert.throws(() => addKind({ repoRoot: root, noun: 'leaf', name: 'a-leaf' }), /never overwrites/);
  addKind({ repoRoot: root, noun: 'block', name: 'lead-list', options: { read: 'handoff' } });
  assert.throws(() => addKind({ repoRoot: root, noun: 'block', name: 'lead-list', options: { read: 'handoff' } }), /never overwrites/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'page', name: 'leads', options: { blocks: 'lead-list' } }), /takes input/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'page', name: 'leads', options: { blocks: 'nothing-block' } }), /no block/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'page', name: 'leads/[id]' }), /kebab-case segments/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'page', name: 'leads', options: { tabs: 'open' } }), /two or more/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'page', name: 'leads', options: { tabs: 'open,open' } }), /distinct/);
  assert.throws(() => addKind({ repoRoot: root, noun: 'overlay', name: 'invite', options: { kind: 'popover' } }), /only two/);
});

test('a page is one Page with its own loading and error views, an overlay is a Dialog or a Drawer, a layout composes a frame', (t) => {
  const { root, app } = stubbedApp(t);
  addUnits(root);
  const read = (...parts) => fs.readFileSync(path.join(app, ...parts), 'utf8');
  const route = ['src', 'app', '[locale]', 'handoffs'];
  assert.match(read(...route, 'page.tsx'), /const Page = \(\) => <HandoffsPage \/>/);
  assert.match(read(...route, 'loading.tsx'), /<HandoffsLoadingPage \/>/);
  assert.match(read(...route, 'error.tsx'), /^"use client"[\s\S]*<HandoffsErrorPage onRetry=\{props\.reset\} \/>/);
  const page = read('src', 'features', 'pages', 'HandoffsPage', 'component.tsx');
  assert.match(page, /<Page\s+header=\{\{[\s\S]*breadcrumbs:[\s\S]*isSkeleton=\{props\.props\.isSkeleton\}\s*>\s*<SignInForm \/>\s*<\/Page>/, 'one Page, its body the block');
  assert.match(read('src', 'features', 'pages', 'HandoffsPage', 'index.tsx'), /export const HandoffsLoadingPage = async \(\) => <HandoffsPageBase props=\{await copyOf\(true\)\} \/>/, 'the loading view is the page in skeleton mode');
  assert.match(read('stories', 'pages', 'HandoffsPage.stories.tsx'), /dna: \{ pair: "Ready", phase: "loading" \}/);
  assert.match(read('src', 'features', 'pages', 'SettingsBillingPage', 'component.tsx'), /<EmptyNotice message=\{props\.props\.empty\} \/>/);
  assert.doesNotMatch(read('src', 'features', 'pages', 'SettingsBillingPage', 'component.tsx'), /tabs:|tabsLabel/, 'no --tabs, no page tabs');
  assert.match(read('src', 'features', 'pages', 'AccountPage', 'component.tsx'), /header=\{\{[\s\S]*tabs: \{ label: props\.props\.tabsLabel, items: props\.props\.tabs \},/, 'the page tabs are the header\'s');
  const accountOwner = read('src', 'features', 'pages', 'AccountPage', 'index.tsx');
  assert.match(accountOwner, /\{ id: "profile", label: t\("tabs\.items\.profile"\), href: "\/account" \},\s*\{ id: "security", label: t\("tabs\.items\.security"\), href: "\/account\/security" \}/, 'link tabs: the route, then its sub-route');
  assert.doesNotMatch(accountOwner, /onSelect|selectedKey/, 'a server owner passes no state and no handler');
  assert.deepEqual(JSON.parse(read('src', 'modules', 'i18n', 'messages', 'en.json')).accountPage.tabs, { label: 'Account', items: { profile: 'Profile', security: 'Security' } });
  const modal = read('src', 'features', 'overlays', 'InviteMemberOverlay', 'component.tsx');
  assert.match(modal, /<Dialog[\s\S]*footer=\{\(close\) => \([\s\S]*intent="dismiss" onPress=\{close\}[\s\S]*intent="commit"/, 'the way out first, the commit last');
  const drawer = read('src', 'features', 'overlays', 'EditDetailsOverlay', 'component.tsx');
  assert.match(drawer, /<Drawer[\s\S]*placement="right"[\s\S]*footer=\{\(close\) => \([\s\S]*intent="dismiss" onPress=\{close\}[\s\S]*type="submit" form="edit-details-overlay-form" intent="commit"[\s\S]*<Form id="edit-details-overlay-form"[\s\S]*<FormGrid columns=\{1\}>/, 'the footer carries the way out, then the submit naming the form');
  assert.doesNotMatch(drawer.slice(drawer.indexOf('<Form ')), /<Button/, 'no decision inside the form');
  assert.match(read('src', 'features', 'overlays', 'EditDetailsOverlay', 'index.tsx'), /^"use client"[\s\S]*useState\(false\)/);
  assert.match(read('src', 'app', '[locale]', 'settings', 'layout.tsx'), /<SettingsLayout content=\{props\.children\} \/>/);
  assert.match(read('src', 'features', 'layouts', 'SettingsLayout', 'index.tsx'), /<PrimaryRailLayout\s+primary=\{props\.content\}\s+rail=/);
  assert.equal(JSON.parse(read('src', 'modules', 'i18n', 'messages', 'vi.json')).handoffsPage.retry, 'Thử lại');
  assert.deepEqual(typecheck(app), []);
});
