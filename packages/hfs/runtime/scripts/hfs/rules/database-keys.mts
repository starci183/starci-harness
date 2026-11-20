// database-keys.mts - R431, the key shape of an app table, judged over the ordered active migrations of db/migrations (
// through checkDatabase). A table the app creates in its schema has the primary key `id uuid` (DB_PRIMARY_KEY_SHAPE); a one-column
// foreign key is named `<referenced table singular>_id` or `<role>_<referenced table singular>_id`, or is the table's own `id` when the
// table shares the key of the row it extends (DB_FOREIGN_KEY_NAME); every foreign key has an index, a primary key or a unique
// constraint of its table whose leading columns are its columns, anywhere in the migration set (DB_FOREIGN_KEY_INDEX). The singular
// of a table name is a small fixed rule set on its last word, with the app's own map of irregular nouns (hfs.json `db.singulars`) first;
// a table hfs.json `db.keyExceptions` lists with a reason (a claim or window table keyed by its natural key, a table a package owns) is
// not judged for its key shape or its foreign key names, never for its indexes. The key shape is the one the whole ordered set leaves (finalShapes): a baseline in the shape a
// database has today and a later migration that adds `id uuid`, drops the old primary key and adds the new one are judged as one, so the old shape alone is no finding when a
// later migration fixes it, and the finding of a shape that stays wrong cites the CREATE and the last migration that changed the key. A migration already on the base unchanged is the backlog:
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

interface TableKey { schema: string; name: string; line: number; file: string; primary: string[] | null; idType: string | null; primaryName: string | null }
interface ForeignKey { schema: string; table: string; columns: string[]; references: string; line: number; file: string; name: string | null }
interface IndexKey { table: string; columns: string[] }
type At = { file: string; line: number };

/**
 * What one migration does to the keys of the tables it names, in statement order. A table's key shape is judged over the whole ordered set (see `finalShapes`), so every
 * statement that can change it is an event: the CREATE, a primary key added or dropped, an `id` column added, retyped, dropped or renamed, a table dropped or renamed and a
 * foreign key added or dropped. A statement that touches the key in a way this reader cannot follow (`opaque`) leaves its table judged as its CREATE declared it.
 */
type KeyEvent =
  | { kind: 'create'; table: TableKey }
  | { kind: 'primary'; table: string; columns: string[]; name: string | null; at: At }
  | { kind: 'dropConstraint'; table: string; name: string; at: At }
  | { kind: 'addColumn'; table: string; column: string; type: string; primary: boolean; at: At }
  | { kind: 'alterType'; table: string; column: string; type: string; at: At }
  | { kind: 'dropColumn'; table: string; column: string; at: At }
  | { kind: 'dropTable'; table: string }
  | { kind: 'renameTable'; table: string; to: string; at: At }
  | { kind: 'opaque'; table: string }
  | { kind: 'fk'; fk: ForeignKey }
  | { kind: 'renameColumn'; table: string; from: string; to: string; at: At };

const typeOf = (column: Parsed): string => names(column?.typeName?.names).at(-1) ?? '';

/** A constraint of a column or a table: its kind, columns and name (`column` for a column constraint). */
function readConstraint(constraint: Parsed, column: string | null) {
  const contype = constraint?.contype;
  const own = column === null ? names(contype === 'CONSTR_FOREIGN' ? constraint.fk_attrs : constraint.keys) : [column];
  return { contype, columns: own, references: constraint?.pktable?.relname as string | undefined, name: typeof constraint?.conname === 'string' ? constraint.conname : null };
}

function noteConstraint(table: { schema: string; name: string }, read: ReturnType<typeof readConstraint>, at: At, out: { keys?: TableKey; events: KeyEvent[]; indexes: IndexKey[] }) {
  const qualified = qualify(table.schema, table.name);
  if (read.contype === 'CONSTR_PRIMARY') {
    if (out.keys) { out.keys.primary = read.columns; out.keys.primaryName = read.name; }
    else out.events.push({ kind: 'primary', table: qualified, columns: read.columns, name: read.name, at });
    out.indexes.push({ table: qualified, columns: read.columns });
  } else if (read.contype === 'CONSTR_UNIQUE') out.indexes.push({ table: qualified, columns: read.columns });
  else if (read.contype === 'CONSTR_FOREIGN' && read.references && read.columns.length) out.events.push({ kind: 'fk', fk: { schema: table.schema, table: table.name, columns: read.columns, references: read.references, name: read.name, ...at } });
}

/** The table a DROP TABLE statement names, as qualified names. */
function droppedTables(node: Parsed, defaultSchema: string): string[] {
  if (node?.removeType !== 'OBJECT_TABLE') return [];
  return (node.objects ?? []).map((object: Parsed) => names(object?.List?.items)).filter((parts: string[]) => parts.length > 0)
    .map((parts: string[]) => (parts.length > 1 ? qualify(parts.at(-2) as string, parts.at(-1) as string) : qualify(defaultSchema, parts[0] as string)));
}

/** The key events, tables, indexes of one migration, in the schemas `exposed` names. */
function keyFacts(file: string, statements: Parsed[], exposed: ReadonlySet<string>) {
  const events: KeyEvent[] = [];
  const indexes: IndexKey[] = [];
  for (const statement of statements) {
    const { node, line } = statement;
    const at = { file, line };
    if (statement.type === 'DropStmt') {
      for (const table of droppedTables(node, statement.defaultSchema ?? 'public')) if (exposed.has(table.split('.')[0] as string)) events.push({ kind: 'dropTable', table });
      continue;
    }
    const relation = node?.relation;
    const schema = relation?.schemaname ?? statement.defaultSchema ?? 'public';
    if (!relation || !exposed.has(schema)) continue;
    const qualified = qualify(schema, relation.relname);
    if (statement.type === 'CreateStmt' && !node.partbound && relation.relpersistence !== 't') {
      const elements: Parsed[] = node.tableElts ?? [];
      const keys: TableKey | undefined = elements.some((element) => element?.TableLikeClause) || node.inhRelations?.length ? undefined
        : { schema, name: relation.relname, line, file, primary: null, idType: null, primaryName: null };
      if (keys) events.push({ kind: 'create', table: keys });
      for (const element of elements) {
        if (element?.ColumnDef) {
          const column = element.ColumnDef;
          if (keys && column.colname === 'id') keys.idType = typeOf(column);
          for (const constraint of column.constraints ?? []) noteConstraint({ schema, name: relation.relname }, readConstraint(constraint?.Constraint, column.colname), at, { ...(keys ? { keys } : {}), events, indexes });
        } else if (element?.Constraint) noteConstraint({ schema, name: relation.relname }, readConstraint(element.Constraint, null), at, { ...(keys ? { keys } : {}), events, indexes });
      }
    } else if (statement.type === 'AlterTableStmt') {
      for (const command of node.cmds ?? []) {
        const alteration = command?.AlterTableCmd;
        const out = { events, indexes };
        if (alteration?.subtype === 'AT_AddConstraint') noteConstraint({ schema, name: relation.relname }, readConstraint(alteration.def?.Constraint, null), at, out);
        else if (alteration?.subtype === 'AT_AddColumn') {
          const column = alteration.def?.ColumnDef;
          const local: KeyEvent[] = [];
          for (const constraint of column?.constraints ?? []) noteConstraint({ schema, name: relation.relname }, readConstraint(constraint?.Constraint, column.colname), at, { events: local, indexes });
          const primary = local.filter((event) => event.kind === 'primary');
          events.push(...local.filter((event) => event.kind !== 'primary'));
          if (typeof column?.colname === 'string') events.push({ kind: 'addColumn', table: qualified, column: column.colname, type: typeOf(column), primary: primary.length > 0, at });
          if (column?.colname !== 'id') events.push(...primary);
        } else if (alteration?.subtype === 'AT_DropConstraint' && typeof alteration.name === 'string') events.push({ kind: 'dropConstraint', table: qualified, name: alteration.name, at });
        else if (alteration?.subtype === 'AT_AlterColumnType' && typeof alteration.name === 'string') events.push({ kind: 'alterType', table: qualified, column: alteration.name, type: typeOf(alteration.def?.ColumnDef), at });
        else if (alteration?.subtype === 'AT_DropColumn' && typeof alteration.name === 'string') events.push({ kind: 'dropColumn', table: qualified, column: alteration.name, at });
      }
    } else if (statement.type === 'RenameStmt') {
      if (node.renameType === 'OBJECT_TABLE' && typeof node.newname === 'string') events.push({ kind: 'renameTable', table: qualified, to: qualify(schema, node.newname), at });
      else if (node.renameType === 'OBJECT_COLUMN' && typeof node.subname === 'string' && typeof node.newname === 'string') events.push({ kind: 'renameColumn', table: qualified, from: node.subname, to: node.newname, at });
      else if (node.renameType === 'OBJECT_TABCONSTRAINT') events.push({ kind: 'opaque', table: qualified });
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
  return { events, indexes };
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

/** A table as the whole ordered migration set leaves it: its CREATE, and the last statement that touched its key. */
interface Shape { created: TableKey; primary: string[] | null; idType: string | null; primaryName: string | null; touched: At | null; opaque: boolean }

/**
 * The key shape of every table the ordered migrations leave standing, and the foreign keys still standing. A baseline written in the shape a database has today and a
 * later migration that reshapes it are judged as one: the table's final primary key is what counts, the finding citing the CREATE and the last migration that changed the key.
 * A table with a statement this reader cannot follow keeps the shape its CREATE declared.
 */
function finalShapes(events: readonly KeyEvent[]): { shapes: Map<string, Shape>; fks: ForeignKey[]; renamedFrom: Map<string, Map<string, string>> } {
  const shapes = new Map<string, Shape>();
  // per table, the column names it had before a rename: an index written on the old name still leads with the renamed column
  const renamedFrom = new Map<string, Map<string, string>>();
  let fks: ForeignKey[] = [];
  const edit = (table: string, change: (shape: Shape) => void): void => { const shape = shapes.get(table); if (shape) change(shape); };
  for (const event of events) {
    switch (event.kind) {
      case 'create': shapes.set(qualify(event.table.schema, event.table.name), { created: event.table, primary: event.table.primary, idType: event.table.idType, primaryName: event.table.primaryName, touched: null, opaque: false }); break;
      case 'primary': edit(event.table, (shape) => { shape.primary = event.columns; shape.primaryName = event.name; shape.touched = event.at; }); break;
      case 'dropConstraint':
        edit(event.table, (shape) => { if (shape.primary !== null && event.name === (shape.primaryName ?? `${shape.created.name}_pkey`)) { shape.primary = null; shape.primaryName = null; shape.touched = event.at; } });
        fks = fks.filter((fk) => !(qualify(fk.schema, fk.table) === event.table && fk.name === event.name));
        break;
      case 'addColumn':
        if (event.column === 'id') edit(event.table, (shape) => { shape.idType = event.type; shape.touched = event.at; if (event.primary) { shape.primary = ['id']; shape.primaryName = null; } });
        break;
      case 'alterType': if (event.column === 'id') edit(event.table, (shape) => { shape.idType = event.type; shape.touched = event.at; }); break;
      case 'dropColumn':
        edit(event.table, (shape) => { if (event.column === 'id') { shape.idType = null; shape.touched = event.at; } if (shape.primary?.includes(event.column)) { shape.primary = null; shape.primaryName = null; shape.touched = event.at; } });
        fks = fks.filter((fk) => !(qualify(fk.schema, fk.table) === event.table && fk.columns.includes(event.column)));
        break;
      case 'dropTable': shapes.delete(event.table); fks = fks.filter((fk) => qualify(fk.schema, fk.table) !== event.table); break;
      case 'renameTable': {
        const shape = shapes.get(event.table);
        if (shape) { shapes.delete(event.table); shapes.set(event.to, { ...shape, touched: event.at }); }
        const [schema, name] = event.to.split('.') as [string, string];
        fks = fks.map((fk) => (qualify(fk.schema, fk.table) === event.table ? { ...fk, schema, table: name } : fk));
        break;
      }
      case 'renameColumn':
        renamedFrom.set(event.table, new Map([...(renamedFrom.get(event.table) ?? []), [event.to, renamedFrom.get(event.table)?.get(event.from) ?? event.from]]));
        edit(event.table, (shape) => {
          if (event.from === 'id' || event.to === 'id') shape.opaque = true;
          else if (shape.primary?.includes(event.from)) { shape.primary = shape.primary.map((column) => (column === event.from ? event.to : column)); shape.touched = event.at; }
        });
        fks = fks.map((fk) => (qualify(fk.schema, fk.table) === event.table && fk.columns.includes(event.from) ? { ...fk, columns: fk.columns.map((column) => (column === event.from ? event.to : column)) } : fk));
        break;
      case 'opaque': edit(event.table, (shape) => { shape.opaque = true; }); break;
      case 'fk': fks.push(event.fk); break;
    }
  }
  return { shapes, fks, renamedFrom };
}

function primaryKeyFindings(shape: Shape): Finding[] {
  const table = shape.created;
  const qualified = qualify(table.schema, table.name);
  const final = shape.opaque ? { primary: table.primary, idType: table.idType, touched: null } : { primary: shape.primary, idType: shape.idType, touched: shape.touched };
  const primary = final.primary ?? [];
  if (primary.length === 1 && primary[0] === 'id' && final.idType === 'uuid') return [];
  const has = primary.length ? `its primary key is (${primary.join(', ')})${primary.length === 1 && primary[0] === 'id' ? ` of type ${final.idType ?? 'unknown'}` : ''}` : 'it declares no primary key';
  const last = final.touched === null ? '' : `, last changed by ${final.touched.file}:${final.touched.line}`;
  return [found(DB_PRIMARY_KEY_SHAPE, table.file, `${table.file}:${table.line} creates ${qualified}, but ${has}${shape.opaque ? '' : ' after every migration'}${last}; an app table's primary key is \`id uuid primary key default gen_random_uuid()\`, a natural key is a unique constraint beside it (or the table is listed in hfs.json db.keyExceptions with a reason)`, { line: table.line, table: qualified })];
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
 * R431 over the ordered active migrations (`analyses`: `{ file, facts }` with facts.statements): the key shape of each app table as the whole set leaves it (`finalShapes`),
 * the name of each one-column foreign key still standing, and an index for every foreign key in the migration set. `db` is hfs.json `db`.
 */
export function migrationSetKeyFindings(analyses: Parsed[], exposed: ReadonlySet<string>, db: Parsed): Finding[] {
  // the static statements of a DO block count where the block sits: a guarded reshaping step is still a step of the set
  const ordered = (own: Parsed): Parsed[] => (own?.statements ?? []).flatMap((statement: Parsed) => (statement.type === 'DoStmt' ? [statement, ...(own?.doInner?.get(statement.index) ?? [])] : [statement]));
  const facts = analyses.map(({ file, facts: own }) => keyFacts(file, ordered(own), exposed));
  const exceptions = keyExceptionsOf(db);
  const singulars = singularsOf(db);
  const indexes = facts.flatMap((fact) => fact.indexes);
  const { shapes, fks, renamedFrom } = finalShapes(facts.flatMap((fact) => fact.events));
  const primaries = new Map([...shapes].map(([qualified, shape]) => [qualified, shape.opaque ? shape.created.primary : shape.primary] as const));
  const findings: Finding[] = [];
  for (const [qualified, shape] of shapes) if (!exceptions.has(qualified)) findings.push(...primaryKeyFindings(shape));
  for (const fk of fks) {
    if (!exceptions.has(qualify(fk.schema, fk.table))) findings.push(...foreignKeyNameFindings(fk, primaries, singulars));
    const before = renamedFrom.get(qualify(fk.schema, fk.table));
    const earlier = before === undefined ? fk : { ...fk, columns: fk.columns.map((column) => before.get(column) ?? column) };
    if (!indexes.some((index) => indexCovers(index, fk) || indexCovers(index, earlier))) {
      const qualified = qualify(fk.schema, fk.table);
        findings.push(found(DB_FOREIGN_KEY_INDEX, fk.file, `${fk.file}:${fk.line} declares the foreign key ${qualified} (${fk.columns.join(', ')}) to ${fk.references} with no index leading with it in the migration set; add \`create index ${fk.table}_${fk.columns.join('_')}_idx on ${qualified} (${fk.columns.join(', ')})\``, { line: fk.line, table: qualified, columns: fk.columns }));
    }
  }
  return findings;
}
