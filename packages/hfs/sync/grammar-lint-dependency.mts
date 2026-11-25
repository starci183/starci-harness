// grammar-lint-dependency.mts - the root package.json dependency on the selected Grammar family's lint package. `starci app sync` renders
// fe/eslint.config.mjs from hfs.json `sides.fe.grammar` (the family's lint factory and package, knowledge/grammars/index.yaml `lint`), so
// an app that switches its family (core to offset-pop) must also install the new family's lint package, or the rendered config imports a
// package the app does not have. When the root manifest declares another family's lint package and not the selected one, sync renames
// that dependency to the selected package in the same section at the same version (the family lint packages are released in step).
// Nothing else of package.json changes: its key order and indentation stay. An app already declaring the selected package is left alone.
import { grammarLintFor, grammarLintPackages } from '../runtime/scripts/lib/grammar-lint.mjs';
import type { DeclarationEdit } from './declared-sides.mjs';

const PACKAGE_FILE = 'package.json';
const HFS_FILE = 'hfs.json';
const SECTIONS = ['devDependencies', 'dependencies'] as const;

type Manifest = Partial<Record<(typeof SECTIONS)[number], Record<string, unknown>>> & Record<string, unknown>;

/** The family an app's hfs.json selects (`sides.fe.grammar`), or undefined when it has no front end or names none. */
const selectedFamily = (text: string | null): string | undefined => {
  if (text === null) return undefined;
  try {
    const grammar = (JSON.parse(text) as { sides?: { fe?: { grammar?: unknown } } }).sides?.fe?.grammar;
    return typeof grammar === 'string' && grammar.trim() ? grammar : undefined;
  } catch { return undefined; }
};

/** `section` with the key `from` renamed to `to` at its place, keeping every other key's order. */
const renamed = (section: Record<string, unknown>, from: string, to: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(section).map(([name, value]): [string, unknown] => [name === from ? to : name, value]));

/** The edit that swaps another family's lint dependency for the selected family's, or none; `read` gives a file's text as earlier edits left it. */
export function grammarLintDependencyEdits(read: (relative: string) => string | null): DeclarationEdit[] {
  const family = selectedFamily(read(HFS_FILE));
  const text = read(PACKAGE_FILE);
  if (family === undefined || text === null) return [];
  let selected: string | null;
  try { selected = grammarLintFor(family).package; } catch { return []; }
  if (selected === null) return [];
  let manifest: Manifest;
  try { manifest = JSON.parse(text) as Manifest; } catch { return []; }
  const declares = (name: string): boolean => SECTIONS.some(section => Object.hasOwn(manifest[section] ?? {}, name));
  if (declares(selected)) return [];
  const others = grammarLintPackages().filter(name => name !== selected && declares(name));
  if (others.length !== 1) return [];
  const stale = others[0] as string;
  const section = SECTIONS.find(name => Object.hasOwn(manifest[name] ?? {}, stale)) as (typeof SECTIONS)[number];
  manifest[section] = renamed(manifest[section] ?? {}, stale, selected);
  const indent = /^[ \t]+(?=")/mu.exec(text)?.[0] ?? '  ';
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const content = `${JSON.stringify(manifest, null, indent).replace(/\n/gu, newline)}${text.endsWith('\n') ? newline : ''}`;
  return [{ path: PACKAGE_FILE, reason: `${section} ${stale} becomes ${selected}: hfs.json sides.fe.grammar selects ${family}, whose lint fe/eslint.config.mjs imports; run npm install to update the lockfile`, content }];
}
