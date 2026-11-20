// cli.mts - `starci app uiaudit run <area>/<screen> [--builder <agent>] [--auditor <agent>] [--out <brief.md>]`, `starci app uiaudit status [--json]` and
// `starci app gallery migrate-explain [--execute]` (reached as `starci audit run`, `starci audit status` and `starci gallery migrate-explain`; contexts/project/gallery.md PROJECT-GALLERY-8).
// The harness itself never calls a model: `run` prepares the round (the shot hashes taken now, the next round written as a skeleton of seven open lenses in the screen's screen.yaml) and prints the brief
// an auditor agent, a different agent from the builder, reads and fills; the gate (cache/uiaudit-family.mts) judges what the auditor wrote. `status` lists every screen with its audit state.
// `migrate-explain` turns each explain.md into a screen.yaml (audit: null: the screen is grandfathered until the diff touches it) and deletes the explain.md.
// Exit 0 done, 1 a screen could not be migrated or prepared, 2 bad usage.
import fs from 'node:fs';
import path from 'node:path';
import { galleryParams } from '../runtime/scripts/hfs/gallery.mjs';
import { feRoutes, resolveScreenRoute } from '../runtime/scripts/hfs/gallery-routes.mjs';
import { galleryScreens } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { cropShots } from '../runtime/scripts/hfs/shot-crops.mjs';
import { auditBrief, docProblems, LENSES, nextRound, parseScreen, SCREEN_FILE, screenOfExplain, shotsOnDisk, stringifyYaml, MAX_ROUNDS, MIN_ROUNDS, type Audit } from '../runtime/scripts/hfs/screen-yaml.mjs';

export const USAGE = 'usage: starci audit run <area>/<screen> [--builder <agent>] [--auditor <agent>] [--out <brief.md>] | starci audit status [--json] | starci gallery migrate-explain [--execute]';

/** The laws an auditor holds a screen to: where they live in the repository the harness serves. */
const LAWS = [
  'contexts/project/gallery.md PROJECT-GALLERY-7 (canvas first, the critique rounds) and PROJECT-GALLERY-8 (this audit, the seven lenses)',
  'contexts/grammars/contract.yaml mustKeep (the DNA laws of every grammar, `starci contexts anchor <id>` prints one) and the Grammar of the app (hfs.json sides.fe.grammar)',
  'skills/starci/references/ui-on-grammar.md (which Grammar component, rank, step and state; no component the Grammar lacks: say "cần Grammar")',
  'the owner rules: one look per element, no segmented control for a value pick, BottomNav only in the compact slot, the console illustration rule, Vietnamese words with one term per concept',
];

interface Io { cwd: string; stdout: (text: string) => unknown; stderr: (text: string) => unknown }

const readText = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

interface RunOptions { action: 'run'; screen: string; builder?: string; auditor?: string; out?: string }
interface StatusOptions { action: 'status'; json: boolean }

function parseAudit(argv: readonly string[]): RunOptions | StatusOptions {
  const [action, ...rest] = argv;
  if (action === 'status') {
    if (rest.some((arg) => arg !== '--json')) throw new Error(USAGE);
    return { action, json: rest.includes('--json') };
  }
  if (action !== 'run') throw new Error(USAGE);
  const opts: RunOptions = { action, screen: '' };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    if (arg === '--builder' || arg === '--auditor' || arg === '--out') {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value; ${USAGE}`);
      opts[arg.slice(2) as 'builder' | 'auditor' | 'out'] = value;
      index += 1;
    } else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}; ${USAGE}`);
    else if (opts.screen === '') opts.screen = arg;
    else throw new Error(USAGE);
  }
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/u.test(opts.screen)) throw new Error(`name the screen as <area>/<screen>; ${USAGE}`);
  return opts;
}

/** How one screen stands, for `status`. */
export type AuditState = 'grandfathered' | 'legacy' | 'invalid' | 'pending' | 'open' | 'needs-owner' | 'few-rounds' | 'stale' | 'ok' | 'no-shots';

/** The audit state of one screen: what `starci audit status` prints. */
export function stateOf(repoRoot: string, folder: string, id: string): { state: AuditState; detail: string } {
  const text = readText(path.join(repoRoot, ...folder.split('/'), SCREEN_FILE));
  if (text === null) return { state: 'legacy', detail: 'explain.md, not migrated (starci gallery migrate-explain)' };
  const parsed = parseScreen(text, id);
  if (parsed.parseError !== null || parsed.doc.length > 0) return { state: 'invalid', detail: (parsed.parseError ?? parsed.doc[0]) as string };
  const audit = parsed.value?.['audit'];
  if (audit === null || audit === undefined) return { state: 'grandfathered', detail: 'audit: null, audited when its code changes' };
  if (parsed.audit.length > 0) return { state: 'invalid', detail: parsed.audit[0] as string };
  const a = audit as unknown as Audit;
  const last = a.rounds.at(-1);
  const disk = shotsOnDisk(repoRoot, folder);
  const shots = (parsed.value?.['shots'] ?? {}) as Record<string, { sha256: string | null } | undefined>;
  if (last === undefined) return { state: 'pending', detail: 'no round yet' };
  if (LENSES.some((lens) => last.lenses[lens].notes?.startsWith('auditor: fill this lens'))) return { state: 'pending', detail: `round ${last.n} waits for the auditor` };
  if (['1440', '390'].some((width) => disk[width] !== undefined && shots[width]?.sha256 !== disk[width])) return { state: 'stale', detail: 'the shots on disk are not the audited ones' };
  const open = LENSES.filter((lens) => last.lenses[lens].verdict === 'open');
  if (open.length > 0) return a.rounds.length >= MAX_ROUNDS ? { state: 'needs-owner', detail: `open after round ${MAX_ROUNDS}: ${open.join(', ')}` } : { state: 'open', detail: `round ${last.n}: ${open.join(', ')}` };
  if (a.rounds.length < MIN_ROUNDS) return { state: 'few-rounds', detail: `${a.rounds.length} of ${MIN_ROUNDS} rounds` };
  return { state: 'ok', detail: `${a.rounds.length} rounds, auditor ${a.auditor.agent}` };
}

/** `starci app uiaudit`: run or status. */
export function uiauditMain(argv: string[], { cwd, stdout, stderr }: Io): number {
  let opts: RunOptions | StatusOptions;
  try { opts = parseAudit(argv); } catch (error) { stderr(`starci audit: ${(error as Error).message}\n`); return 2; }
  const params = galleryParams();
  if (opts.action === 'status') {
    const rows = galleryScreens(cwd, params).screens.map(({ area, screen }) => ({ screen: `${area}/${screen}`, ...stateOf(cwd, `${params.pages}/${area}/${screen}`, `${area}/${screen}`) }));
    if (opts.json) { stdout(`${JSON.stringify({ screens: rows })}\n`); return 0; }
    const attention = rows.filter((row) => !['grandfathered', 'ok'].includes(row.state));
    for (const row of attention) stdout(`${row.state.padEnd(13)} ${row.screen}  ${row.detail}\n`);
    stdout(`ui audit: ${rows.length} screen(s): ${rows.filter((row) => row.state === 'ok').length} audited, ${rows.filter((row) => row.state === 'grandfathered').length} grandfathered, ${attention.length} needing attention\n`);
    return 0;
  }
  const folder = `${params.pages}/${opts.screen}`;
  const file = path.join(cwd, ...folder.split('/'), SCREEN_FILE);
  const text = readText(file);
  if (text === null) { stderr(`starci audit: ${folder}/${SCREEN_FILE} does not exist: write it (PROJECT-GALLERY-8), or run starci gallery migrate-explain for an explain.md\n`); return 2; }
  const parsed = parseScreen(text, opts.screen);
  if (parsed.value === null || parsed.parseError !== null || parsed.doc.length > 0) { stderr(`starci audit: ${folder}/${SCREEN_FILE} ${parsed.parseError ?? parsed.doc.slice(0, 6).join('; ')}\n`); return 1; }
  const disk = shotsOnDisk(cwd, folder);
  const missing = (['1440', '390'] as const).filter((width) => disk[width] === undefined);
  if (missing.length > 0) { stderr(`starci audit: ${folder}/${missing.map((width) => `${width}.png`).join(' and ')} is missing: shoot the screen at 1440 and 390 first, the audit judges the shots\n`); return 2; }
  const next = nextRound(parsed.value, { disk, builder: opts.builder, auditor: opts.auditor, now: new Date().toISOString() });
  fs.writeFileSync(file, stringifyYaml(next.value));
  const shotPaths = (['1440', '390'] as const).map((width) => path.join(cwd, ...folder.split('/'), `${width}.png`).replaceAll('\\', '/'));
  const crops = cropShots(path.join(cwd, ...folder.split('/')));
  for (const note of crops.notes) stderr(`starci audit: ${note}\n`);
  const cropPaths = crops.written.map((crop) => crop.replaceAll('\\', '/'));
  const brief = auditBrief({ id: opts.screen, folder, value: next.value, shotPaths, cropPaths, laws: LAWS });
  if (opts.out !== undefined) { fs.writeFileSync(path.resolve(cwd, opts.out), `${brief}\n`); stdout(`starci audit: ${next.note}; brief written to ${opts.out}\n`); } else stdout(`${brief}\n\n`);
  stderr(`starci audit: ${next.note}; ${folder}/${SCREEN_FILE} is the skeleton for the auditor${(next.value['audit'] as Audit).builder.agent === '' ? '; name the builder with --builder' : ''}\n`);
  return 0;
}

/** `starci app gallery migrate-explain [--execute]`: every explain.md becomes a screen.yaml (audit: null) and is deleted. Dry run unless --execute. */
export function galleryMain(argv: string[], { cwd, stdout, stderr }: Io): number {
  const [action, ...rest] = argv;
  if (action !== 'migrate-explain' || rest.some((arg) => arg !== '--execute')) { stderr(`starci gallery: ${USAGE}\n`); return 2; }
  const execute = rest.includes('--execute');
  const params = galleryParams();
  const routes = feRoutes(cwd);
  let migrated = 0;
  let skipped = 0;
  for (const { area, screen } of galleryScreens(cwd, params).screens) {
    const id = `${area}/${screen}`;
    const folder = `${params.pages}/${id}`;
    const target = path.join(cwd, ...folder.split('/'), SCREEN_FILE);
    const mdFile = path.join(cwd, ...folder.split('/'), 'explain.md');
    const markdown = readText(mdFile);
    if (markdown === null) continue;
    if (fs.existsSync(target)) { stderr(`skipped ${id}: it holds screen.yaml and explain.md both; delete the explain.md by hand\n`); skipped += 1; continue; }
    const value = screenOfExplain({ id, markdown, disk: shotsOnDisk(cwd, folder) });
    const key = resolveScreenRoute(routes, { route: String(value['route'] ?? ''), ...(typeof value['app'] === 'string' ? { app: value['app'] } : {}) }).key;
    const route = routes.find((candidate) => key !== null && candidate.key === key);
    if (route !== undefined) value['code'] = route.sources.map((source) => source.replace(/^fe\/apps\/[^/]+\/src\//u, ''));
    const problems = docProblems(value, id);
    if (problems.length > 0) { stderr(`skipped ${id}: ${problems.slice(0, 3).join('; ')}: fix the explain.md front matter (title, route, area) and run again\n`); skipped += 1; continue; }
    if (execute) { fs.writeFileSync(target, stringifyYaml(value)); fs.rmSync(mdFile); }
    stdout(`${execute ? 'migrated' : 'would migrate'} ${id}\n`);
    migrated += 1;
  }
  stdout(`gallery: ${migrated} screen(s) ${execute ? 'migrated' : 'to migrate (dry run, --execute writes)'}, ${skipped} skipped\n`);
  return skipped > 0 ? 1 : 0;
}
