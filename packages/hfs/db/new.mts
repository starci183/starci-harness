// new.mjs - `starci app db new <kebab-name>`: creates the next migration db/migrations/<ts14>_<kebab-name>.sql (slot app.db.migrations),
// stamped with the current UTC instant and strictly after every committed active migration, so DB_MIGRATION_SHAPE holds from birth.
import fs from 'node:fs';
import path from 'node:path';
import { byCodeUnit } from '../runtime/engine/by-code-unit.mjs';
import { MIGRATIONS_DIR } from '../runtime/scripts/hfs/rules/database-constants.mjs';
import { refusal } from '../stack/errors.mjs';
import { runVerb } from '../release/index.mjs';
import type { FlagSpec, VerbContext, VerbIo, VerbResult } from '../release/index.mjs';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STAMPED = /^(\d{14})_/u;

/** The fourteen-digit UTC stamp of `ms`. */
export const stampAt = (ms: number): string => new Date(ms).toISOString().replace(/[-:T]/gu, '').slice(0, 14);

/** The next stamp: now, or one second after the newest active migration when the clock is behind it. */
export function nextStamp(existing: readonly string[], nowMs: number): string {
  const last = existing.map((file) => STAMPED.exec(file)?.[1]).filter((stamp): stamp is string => Boolean(stamp)).sort(byCodeUnit).at(-1);
  const now = stampAt(nowMs);
  if (last === undefined || now > last) return now;
  const at = Date.UTC(Number(last.slice(0, 4)), Number(last.slice(4, 6)) - 1, Number(last.slice(6, 8)), Number(last.slice(8, 10)), Number(last.slice(10, 12)), Number(last.slice(12, 14))) + 1000;
  return stampAt(at);
}

/** Writes an empty forward-only migration named `name` and answers its app-relative path. */
export function newMigration(ctx: VerbContext, name: unknown): VerbResult {
  if (typeof name !== 'string' || !KEBAB.test(name)) throw refusal('DB_USAGE', 'db new takes one kebab-case name (letters, digits and single dashes)');
  const dir = path.join(ctx.cwd, MIGRATIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir).filter((file) => file.endsWith('.sql'));
  const file = `${nextStamp(existing, ctx.now())}_${name}.sql`;
  fs.writeFileSync(path.join(dir, file), `-- ${name}: forward-only; immutable once on origin/main.\n`, { flag: 'wx' });
  const rel = `${MIGRATIONS_DIR}/${file}`;
  return { ok: true, lines: [`created ${rel}`], data: { path: rel } };
}

/** Entry of the verb: `starci app db new <kebab-name> [--json]`. */
/** The flags of `starci app db new <kebab-name>`; the parser refuses every other. */
export const SPEC: FlagSpec = { boolean: ['--json'], value: [] };

export function dbNewMain(argv: string[], io: VerbIo = {}): Promise<number> {
  return runVerb({
    label: 'starci app db new', name: 'db new', code: 'DB_USAGE', io, argv, spec: SPEC,
    run: (ctx, _flags, positional) => {
      if (positional.length !== 1) throw refusal('DB_USAGE', 'db new takes exactly one migration name');
      return newMigration(ctx, positional[0]);
    },
  });
}
