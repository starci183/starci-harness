// database-keys.mts - R431, the key shape of an app table, judged over the ordered active migrations of db/migrations (
// through checkDatabase). A table the app creates in its schema has the primary key `id uuid` (DB_PRIMARY_KEY_SHAPE); a one-column
// foreign key is named `<referenced table singular>_id` or `<role>_<referenced table singular>_id`, or is the table's own `id` when the
// table shares the key of the row it extends (DB_FOREIGN_KEY_NAME); every foreign key has an index, a primary key or a unique
// constraint of its table whose leading columns are its columns, anywhere in the migration set (DB_FOREIGN_KEY_INDEX). The singular
// of a table name is a small fixed rule set on its last word, with the app's own map of irregular nouns (hfs.json `db.singulars`) first;
// a table hfs.json `db.keyExceptions` lists with a reason (a claim or window table keyed by its natural key, a table a package owns) is
// not judged for its key shape or its foreign key names, never for its indexes. A migration already on the base unchanged is the backlog:
// database-landed.mts reports these codes there as known items, never as blockers, so the rule binds every new migration.
import { found } from './read.mjs';
import { DB_FOREIGN_KEY_INDEX, DB_FOREIGN_KEY_NAME, DB_PRIMARY_KEY_SHAPE } from './database-constants.mjs';
import type { Finding, Parsed } from './rule-types.mjs';

const sval = (node: Parsed): string | undefined => node?.String?.sval;
const names = (list: Parsed): string[] => (list ?? []).map(sval).filter((name: string | undefined): name is string => typeof name === 'string');

/** The words a singular rule leaves as they are: they end in s and are singular already (`status`, `address`, `analysis`). */
const SINGULAR_ALREADY = /(?:ss|us|is)$/;

/** One word of a table name to its singular: `categories` category, `boxes` box, `items` item; the app's map wins. */
function singularWord(word: string, overrides: Readonly<Record<string, string>>): string {
  const own = overrides[word];
  if (own !== undefined) return own;
  if (SINGULAR_ALREADY.test(word)) return word;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:sses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * The singular of a table name: the app's map (hfs.json `db.singulars`) for the whole name, else the name with its last `_` word
 * made singular by the fixed rules (or by the map, for that word). `order_items` order_item, `people` with `{ people: person }` person.
 */
export function tableSingular(table: string, overrides: Readonly<Record<string, string>> = {}): string {
  const whole = overrides[table];
  if (whole !== undefined) return whole;
  const words = table.split('_');
  const last = words.pop() ?? table;
  return [...words, singularWord(last, overrides)].join('_');
}

/** The names a one-column foreign key to `table` may take: `<singular>_id`, or `<role>_<singular>_id` with a snake role. */
export function foreignKeyNameFits(column: string, table: string, overrides: Readonly<Record<string, string>> = {}): boolean {
  const expected = `${tableSingular(table, overrides)}_id`;
  return column === expected || (column.endsWith(`_${expected}`) && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(column.slice(0, -expected.length - 1)));
}

const qualify = (schema: string, name: string): string => `${schema}.${name}`;

interface TableKey { schema: string; name: string; line: number; file: string; primary: string[] | null; idType: string | null }
interface ForeignKey { schema: string; table: string; columns: string[]; references: string; line: number; file: string }
interface IndexKey { table: string; columns: string[] }

const typeOf = (column: Parsed): string => names(column?.typeName?.names).at(-1) ?? '';

/** A constraint of a column or a table: its kind and columns (`column` for a column constraint). */
function readConstraint(constraint: Parsed, column: string | null) {
  const contype = constraint?.contype;
  const own = column === null ? names(contype === 'CONSTR_FOREIGN' ? constraint.fk_attrs : constraint.keys) : [column];
  return { contype, columns: own, references: constraint?.pktable?.relname as string | undefined };
}

function noteConstraint(table: { schema: string; name: string }, read: ReturnType<typeof readConstraint>, at: { file: string; line: number }, out: { keys?: TableKey; fks: ForeignKey[]; indexes: IndexKey[] }) {
  const qualified = qualify(table.schema, table.name);
  if (read.contype === 'CONSTR_PRIMARY') {
    if (out.keys) out.keys.primary = read.columns;
    out.indexes.push({ table: qualified, columns: read.columns });
  } else if (read.contype === 'CONSTR_UNIQUE') out.indexes.push({ table: qualified, columns: read.columns });
  else if (read.contype === 'CONSTR_FOREIGN' && read.references && read.columns.length) out.fks.push({ schema: table.schema, table: table.name, columns: read.columns, references: read.references, ...at });
}

/** The tables, foreign keys and indexes one migration declares, in the schemas `exposed` names. */
function keyFacts(file: string, statements: Parsed[], exposed: ReadonlySet<string>) {
  const tables: TableKey[] = [];
  const fks: ForeignKey[] = [];
  const indexes: IndexKey[] = [];
  for (const statement of statements) {
    const { node, line } = statement;
    const relation = node?.relation;
    const schema = relation?.schemaname ?? statement.defaultSchema ?? 'public';
    if (!relation || !exposed.has(schema)) continue;
    const at = { file, line };
    if (statement.type === 'CreateStmt' && !node.partbound && relation.relpersistence !== 't') {
      const elements: Parsed[] = node.tableElts ?? [];
      const keys: TableKey | undefined = elements.some((element) => element?.TableLikeClause) || node.inhRelations?.length ? undefined
        : { schema, name: relation.relname, line, file, primary: null, idType: null };
      if (keys) tables.push(keys);
      for (const element of elements) {
        if (element?.ColumnDef) {
          const column = element.ColumnDef;
          if (keys && column.colname === 'id') keys.idType = typeOf(column);
          for (const constraint of column.constraints ?? []) noteConstraint({ schema, name: relation.relname }, readConstraint(constraint?.Constraint, column.colname), at, { ...(keys ? { keys } : {}), fks, indexes });
        } else if (element?.Constraint) noteConstraint({ schema, name: relation.relname }, readConstraint(element.Constraint, null), at, { ...(keys ? { keys } : {}), fks, indexes });
      }
    } else if (statement.type === 'AlterTableStmt') {
      for (const command of node.cmds ?? []) {
        const alteration = command?.AlterTableCmd;
        if (alteration?.subtype === 'AT_AddConstraint') noteConstraint({ schema, name: relation.relname }, readConstraint(alteration.def?.Constraint, null), at, { fks, indexes });
        if (alteration?.subtype === 'AT_AddColumn') {
          const column = alteration.def?.ColumnDef;
          for (const constraint of column?.constraints ?? []) noteConstraint({ schema, name: relation.relname }, readConstraint(constraint?.Constraint, column.colname), at, { fks, indexes });
        }
      }
    } else if (statement.type === 'IndexStmt') {
      const columns: string[] = [];
      for (const param of node.indexParams ?? []) {
        const name = param?.IndexElem?.name;
        if (typeof name !== 'string') break;
        columns.push(name);
      }
      if (columns.length) indexes.push({ table: qualify(schema, relation.relname), columns });
    }
  }
  return { tables, fks, indexes };
}

/** An index whose leading columns are exactly the foreign key's columns, in any order. */
const indexCovers = (index: IndexKey, fk: ForeignKey): boolean => index.table === qualify(fk.schema, fk.table) && index.columns.length >= fk.columns.length
  && new Set(index.columns.slice(0, fk.columns.length)).size === fk.columns.length && fk.columns.every((column) => index.columns.slice(0, fk.columns.length).includes(column));

/** The declared key exceptions (hfs.json db.keyExceptions: `{ table, reason }`), as qualified table names; an entry with no reason counts for nothing. */
const keyExceptionsOf = (db: Parsed): Set<string> => new Set((Array.isArray(db?.keyExceptions) ? db.keyExceptions : [])
  .filter((entry: Parsed) => typeof entry?.table === 'string' && typeof entry?.reason === 'string' && entry.reason.trim())
  .map((entry: Parsed) => (entry.table.includes('.') ? entry.table : `public.${entry.table}`)));

/** The app's map of irregular singulars (hfs.json db.singulars: `{ "<plural>": "<singular>" }`). */
const singularsOf = (db: Parsed): Record<string, string> => Object.fromEntries(Object.entries(db?.singulars && typeof db.singulars === 'object' && !Array.isArray(db.singulars) ? db.singulars : {})
  .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''));

function primaryKeyFindings(table: TableKey): Finding[] {
  const qualified = qualify(table.schema, table.name);
  const primary = table.primary ?? [];
  if (primary.length === 1 && primary[0] === 'id' && table.idType === 'uuid') return [];
  const has = primary.length ? `its primary key is (${primary.join(', ')})${primary.length === 1 && primary[0] === 'id' ? ` of type ${table.idType ?? 'unknown'}` : ''}` : 'it declares no primary key';
  return [found(DB_PRIMARY_KEY_SHAPE, table.file, `${table.file}:${table.line} creates ${qualified}, but ${has}; an app table's primary key is \`id uuid primary key default gen_random_uuid()\`, a natural key is a unique constraint beside it (or the table is listed in hfs.json db.keyExceptions with a reason)`, { line: table.line, table: qualified })];
}

function foreignKeyNameFindings(fk: ForeignKey, primaries: ReadonlyMap<string, string[] | null>, singulars: Readonly<Record<string, string>>): Finding[] {
  if (fk.columns.length !== 1) return [];
  const [column] = fk.columns as [string];
  const qualified = qualify(fk.schema, fk.table);
  const sharedKey = column === 'id' && (primaries.get(qualified) ?? []).join(',') === 'id';
  if (sharedKey || foreignKeyNameFits(column, fk.references, singulars)) return [];
  const expected = `${tableSingular(fk.references, singulars)}_id`;
  return [found(DB_FOREIGN_KEY_NAME, fk.file, `${fk.file}:${fk.line} names the foreign key ${qualified}.${column} to ${fk.references}; a foreign key column is \`${expected}\` or \`<role>_${expected}\` (an irregular plural goes in hfs.json db.singulars)`, { line: fk.line, table: qualified, column, expected })];
}

/**
 * R431 over the ordered active migrations (`analyses`: `{ file, facts }` with facts.statements): the key shape of each created app table,
 * the name of each one-column foreign key, and an index for every foreign key in the migration set. `db` is hfs.json `db`.
 */
export function migrationSetKeyFindings(analyses: Parsed[], exposed: ReadonlySet<string>, db: Parsed): Finding[] {
  const facts = analyses.map(({ file, facts: own }) => keyFacts(file, own?.statements ?? [], exposed));
  const exceptions = keyExceptionsOf(db);
  const singulars = singularsOf(db);
  const indexes = facts.flatMap((fact) => fact.indexes);
  const primaries = new Map(facts.flatMap((fact) => fact.tables).map((table) => [qualify(table.schema, table.name), table.primary] as const));
  const findings: Finding[] = [];
  for (const fact of facts) {
    for (const table of fact.tables) if (!exceptions.has(qualify(table.schema, table.name))) findings.push(...primaryKeyFindings(table));
    for (const fk of fact.fks) {
      if (!exceptions.has(qualify(fk.schema, fk.table))) findings.push(...foreignKeyNameFindings(fk, primaries, singulars));
      if (!indexes.some((index) => indexCovers(index, fk))) {
        const qualified = qualify(fk.schema, fk.table);
        findings.push(found(DB_FOREIGN_KEY_INDEX, fk.file, `${fk.file}:${fk.line} declares the foreign key ${qualified} (${fk.columns.join(', ')}) to ${fk.references} with no index leading with it in the migration set; add \`create index ${fk.table}_${fk.columns.join('_')}_idx on ${qualified} (${fk.columns.join(', ')})\``, { line: fk.line, table: qualified, columns: fk.columns }));
      }
    }
  }
  return findings;
}
