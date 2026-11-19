// canvas-tokens.mts - writes `.starcistacks/canvas/tokens.css` from the app's brand file (R445, contexts/project/brand.md PROJECT-BRAND-4), so the canvas reads the
// tokens the app ships and its generators hold no colour. Run at the app root: `node node_modules/@starci/hfs/runtime/scripts/hfs/canvas-tokens.mjs [--check]`
// (`--check` writes nothing and exits 1 when the file is not what the brand file generates). The file is the brand layer byte for byte under a stamp line.
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from '../lib/is-main.mjs';
import { CANVAS_TOKENS, renderCanvasTokens } from './rules/brand-one.mjs';

const BRAND = /^modules\/brand\/brand\.css$/u;

/** The brand file of the app at `root` (app-relative, posix): the one `fe/**` `modules/brand/brand.css`, or null when there is none or more than one. */
export function findBrandFile(root: string): string | null {
  const found: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 7) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child, depth + 1);
      else if (BRAND.test(child.split('/').slice(-3).join('/'))) found.push(child);
    }
  };
  walk('fe', 0);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** The generator at an app root; returns the exit code and prints what it did. */
export function canvasTokensMain(argv: readonly string[], root: string = process.cwd()): number {
  const check = argv.includes('--check');
  const brand = findBrandFile(root);
  if (brand === null) { process.stderr.write('canvas-tokens: the app has no single fe/**/modules/brand/brand.css (FE_BRAND_NOT_ONE)\n'); return 1; }
  const expected = renderCanvasTokens(brand, fs.readFileSync(path.join(root, brand), 'utf8'));
  const target = path.join(root, CANVAS_TOKENS);
  const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n') : null;
  if (actual === expected) { process.stdout.write(`${CANVAS_TOKENS} is current (${brand})\n`); return 0; }
  if (check) { process.stderr.write(`${CANVAS_TOKENS} is not generated from ${brand}: run without --check (FE_BRAND_CANVAS_TOKENS_STALE)\n`); return 1; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected);
  process.stdout.write(`wrote ${CANVAS_TOKENS} from ${brand}\n`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = canvasTokensMain(process.argv.slice(2));
