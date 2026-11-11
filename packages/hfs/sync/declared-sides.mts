// declared-sides.mts - the upgrade `starci app sync` makes to an existing app's own declarations so they state its sides (PROJECT-1, R399): hfs.json
// gains `"packages": {}` when the app holds root workspace packages under packages/ and does not declare them, and
// .starcistacks/application-stacks.yaml gains the `sides:` field, with its plain-words line, read from hfs.json. Nothing else of either file is
// touched: the field is inserted under `schema:` and hfs.json keeps its key order. The dry run names each edit as drift.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_SIDES, declaredSidesOf, type ProjectSide } from '../runtime/scripts/hfs/project-sides.mjs';

const HFS_FILE = 'hfs.json';
const STACK_FILE = path.join('.starcistacks', 'application-stacks.yaml');
const SIDE_WORDS: Readonly<Record<ProjectSide, string>> = Object.freeze({ be: 'back end (be)', fe: 'front end (fe)', packages: 'root workspace packages (packages)' });

/**
 * The stack's `sides` field for `sides` and the plain-words comment above it: {stackSides}, the flow mapping of every side to whether it is
 * declared, and {stackSidesNote}, naming the app sides the project lacks (or that it has both).
 */
export function stackSidesVars(sides: readonly ProjectSide[]): { stackSides: string; stackSidesNote: string } {
  const missing = (['be', 'fe'] as const).filter((side) => !sides.includes(side));
  const note = missing.length
    ? `This project has no ${missing.map((side) => SIDE_WORDS[side]).join(' and no ')}: sides are declared in hfs.json.`
    : `This project has a ${SIDE_WORDS.be} and a ${SIDE_WORDS.fe}${sides.includes('packages') ? ` and ${SIDE_WORDS.packages}` : ''}: sides are declared in hfs.json.`;
  return { stackSides: `{${PROJECT_SIDES.map((side) => `${side}: ${String(sides.includes(side))}`).join(', ')}}`, stackSidesNote: note };
}

/** One edit of a declaration: the app-relative file, why, and its new text. */
export interface DeclarationEdit { readonly path: string; readonly reason: string; readonly content: string }

/** True when the app holds a root workspace package: a packages/<name>/package.json. */
const holdsRootPackages = (root: string): boolean => {
  const dir = path.join(root, 'packages');
  try { return fs.readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'package.json'))); } catch { return false; }
};

/**
 * hfs.json `text` with `"packages": {}` as the last entry of its `sides` object, every other byte kept (the key order and the layout the app
 * formats it with); null when `sides` is not one block object the edit can find.
 */
function withPackagesSide(text: string): string | null {
  const lines = text.split(/(?<=\n)/u);
  const open = lines.findIndex((line) => /^\s*"sides":\s*\{\s*$/u.test(line));
  if (open < 0) return null;
  const indent = /^\s*/u.exec(lines[open] ?? '')?.[0] ?? '';
  const close = lines.findIndex((line, index) => index > open && line.startsWith(`${indent}}`));
  if (close < 1) return null;
  const last = lines[close - 1] ?? '';
  const newline = last.endsWith('\r\n') ? '\r\n' : '\n';
  const inner = /^\s*/u.exec(last)?.[0] ?? '';
  lines.splice(close - 1, 1, `${last.replace(/\r?\n$/u, '')},${newline}`, `${inner}"packages": {}${newline}`);
  return lines.join('');
}

/** The edits that make the app at `root` declare its sides in hfs.json and its stack declaration; empty when both already do. */
export function declaredSidesEdits(root: string): DeclarationEdit[] {
  const edits: DeclarationEdit[] = [];
  let text: string;
  try { text = fs.readFileSync(path.join(root, HFS_FILE), 'utf8'); } catch { return edits; }
  let hfs: { kind?: unknown; sides?: Record<string, unknown> };
  try { hfs = JSON.parse(text); } catch { return edits; }
  if (hfs.kind !== 'app' || hfs.sides === null || typeof hfs.sides !== 'object') return edits;
  if (!Object.hasOwn(hfs.sides, 'packages') && holdsRootPackages(root)) {
    const content = withPackagesSide(text);
    if (content !== null) {
      hfs = { ...hfs, sides: { ...hfs.sides, packages: {} } };
      edits.push({ path: HFS_FILE, reason: 'packages/ holds root workspace packages: declare "packages": {} under sides (R399)', content });
    }
  }
  let stack: string;
  try { stack = fs.readFileSync(path.join(root, STACK_FILE), 'utf8'); } catch { return edits; }
  if (!/^sides:/mu.test(stack)) {
    const { stackSides, stackSidesNote } = stackSidesVars(declaredSidesOf(hfs.sides));
    const newline = stack.includes('\r\n') ? '\r\n' : '\n';
    const field = `# ${stackSidesNote}${newline}sides: ${stackSides}${newline}`;
    const at = /^schema:[^\r\n]*\r?\n/mu.exec(stack);
    const content = at ? `${stack.slice(0, at.index + at[0].length)}${field}${stack.slice(at.index + at[0].length)}` : `${field}${stack}`;
    edits.push({ path: STACK_FILE.split(path.sep).join('/'), reason: 'the stack declaration states no sides: add the sides field hfs.json declares (R399)', content });
  }
  return edits;
}
