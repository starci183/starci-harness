import path from 'node:path';
import type { ClassDeclaration, ClassElement, Decorator, Expression, Node, StringLiteralLike, TypeChecker } from 'typescript';
import type { TypeScriptApi } from './config.mjs';
import type { ArchitectureViolation, GraphFile, HfsGraph } from './hfs-graph.mjs';
import type { CheckResult, ContextModel, HfsCheckInput, MachineKit, SlotResolver } from './context-map.mjs';
import { analyzeSql, HOLE } from './sql-tokens.mjs';
import type { SqlAnalysis, SqlTableUse } from './sql-tokens.mjs';
import { machineKit } from './machine-ast.mjs';
import { contextModelOf } from './context-map.mjs';
import { sqlUniqueSetsOf } from './sql-keys.mjs';

/**
 * R86 `sql-owner` (BE_SQL_TABLE_OWNER). Every `sql` tagged template (the tag declared in platform/database) of a
 * `<name>.sql.ts` file in a capability's `persistence/` is read with the tokenizer of sql-tokens.mjs and judged against the
 * schema authority of the whole program:
 *   - it writes (INSERT INTO, UPDATE, DELETE FROM, MERGE INTO, TRUNCATE) only tables the file's own capability declares;
 *   - it reads (FROM, JOIN, USING) only tables of its own CONTEXT (the connection its capability's arrays are registered on): its own
 *     capability's, or those of a same-context capability its owner may import (the tier matrix, through `resolver.importAllowed`
 *     to the table owner's public entry); a table of another context is refused (cross-context data comes only by events);
 *   - every table it names is declared by some entity under TypeORM authority, or by the generated
 *     public tables the ordered db/migrations create under the SQL migration authority;
 *   - a SELECT carries LIMIT, or reads a single relation under a complete primary/unique-key equality to scalar values,
 *     or selects only proven scalar aggregates without GROUP BY. Inferred bounds reject multiplying projections and set operations.
 * Table positions that hold a `${...}` substitution (SqlIdent) are dynamic; they are counted in the coverage and judged by
 * nobody. A join needs an explicit result bound because key constraints on its first relation do not bound joined rows.
 */
export const SQL_OWNER_RULE_IDS = ['BE_SQL_TABLE_OWNER'];

const RULE = 'BE_SQL_TABLE_OWNER';
const TYPEORM = 'typeorm';

/** A table the program declares: its name, the capability that owns it and the file that declares it (both null for an unowned SQL table), and its unique column sets. */
export interface TableDeclaration {
  table: string;
  owner: string | null;
  rel: string | null;
  uniqueSets: string[][];
}

/** Reports one finding of the template being inspected. */
type SqlReport = (message: string, extra?: Record<string, unknown>) => void;

/** The member of an entity class with the checker of the file declaring it. */
interface EntityMember {
  member: ClassElement;
  checker: TypeChecker;
}

/** What the inspection of every SQL template shares. */
interface SqlInspection {
  kit: MachineKit;
  ts: TypeScriptApi;
  tables: Map<string, TableDeclaration>;
  sqlAuthority: boolean;
  model: ContextModel;
  resolver: SlotResolver;
}

/** What the inspection counts and reports across files. */
interface SqlState {
  violations: ArchitectureViolation[];
  templates: number;
  dynamic: number;
  foreignTags: number;
}

/** What the write judgement reads. */
interface SqlWriteInput {
  tables: Map<string, TableDeclaration>;
  sqlAuthority: boolean;
  file: GraphFile;
  ownTable: string;
  report: SqlReport;
}

const literalStrings = (ts: TypeScriptApi, node: Node | undefined | null): string[] | null => {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) {
    const literals = node.elements.filter((item): item is StringLiteralLike => ts.isStringLiteralLike(item));
    if (literals.length === node.elements.length) return literals.map(item => item.text);
  }
  return null;
};

function isTypeormDecorator(kit: MachineKit, checker: TypeChecker, node: Decorator, ...names: string[]): boolean {
  const call = kit.ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
  const binding = kit.importBinding(checker, call);
  return binding?.module === TYPEORM && names.includes(binding.name);
}

/** Whether an object literal carries `unique: true`. */
function isUniqueTrue(kit: MachineKit, item: Node): boolean {
  if (!kit.ts.isObjectLiteralExpression(item)) return false;
  const unique = kit.propertyOf(item, 'unique');
  return unique !== undefined && kit.valueOfProperty(unique).kind === kit.ts.SyntaxKind.TrueKeyword;
}

function entityTableInfo(kit: MachineKit, checker: TypeChecker, statement: ClassDeclaration): { table: string | null } | null {
  const { ts } = kit;
  const entity = kit.decorators(statement).find(decorator => isTypeormDecorator(kit, checker, decorator, 'Entity'));
  if (!entity) return null;
  const argument = ts.isCallExpression(entity.expression) ? entity.expression.arguments[0] ?? null : null;
  let table: string | null = argument && ts.isStringLiteralLike(argument) ? argument.text : null;
  if (table === null && argument && ts.isObjectLiteralExpression(argument)) {
    const property = kit.propertyOf(argument, 'name');
    const value = property ? kit.valueOfProperty(property) : null;
    if (value && ts.isStringLiteralLike(value)) table = value.text;
  }
  return { table };
}

function mappedColumnName(kit: MachineKit, member: Node, property: string): string {
  const { ts } = kit;
  let column = property;
  for (const decorator of kit.decorators(member)) {
    const args: readonly Expression[] = ts.isCallExpression(decorator.expression) ? decorator.expression.arguments : [];
    for (const item of args) if (ts.isObjectLiteralExpression(item)) {
      const named = kit.propertyOf(item, 'name');
      const value = named ? kit.valueOfProperty(named) : null;
      if (value && ts.isStringLiteralLike(value)) column = value.text;
    }
  }
  return column;
}

function addUniqueColumnSet(kit: MachineKit, checker: TypeChecker, decorator: Decorator, column: string, primary: string[], sets: string[][]): void {
  const { ts } = kit;
  const args: readonly Expression[] = ts.isCallExpression(decorator.expression) ? decorator.expression.arguments : [];
  const uniqueOption = args.some(item => isUniqueTrue(kit, item));
  if (isTypeormDecorator(kit, checker, decorator, 'PrimaryColumn', 'PrimaryGeneratedColumn')) primary.push(column.toLowerCase());
  else if (isTypeormDecorator(kit, checker, decorator, 'Column', 'Index') && uniqueOption) sets.push([column.toLowerCase()]);
}

/**
 * The members of an entity class with the checker of the file declaring each: those of every class it extends first (a column base
 * such as UuidAbstractEntity of platform/database maps no table of its own but gives its columns and its primary key to the entity),
 * then its own.
 */
function entityMembers(kit: MachineKit, checker: TypeChecker, statement: ClassDeclaration, seen = new Set<ClassDeclaration>()): EntityMember[] {
  const { ts } = kit;
  if (seen.has(statement)) return [];
  seen.add(statement);
  const bases = (statement.heritageClauses ?? []).filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
    .flatMap(clause => clause.types).flatMap(type => kit.declarationsOf(checker, type.expression)).filter((node): node is ClassDeclaration => ts.isClassDeclaration(node));
  const inherited = bases.flatMap(base => entityMembers(kit, kit.checkerOf(base.getSourceFile()) ?? checker, base, seen));
  return [...inherited, ...statement.members.map((member): EntityMember => ({ member, checker }))];
}

function entityColumnSets(kit: MachineKit, checker: TypeChecker, statement: ClassDeclaration): { dbName: Map<string, string>; sets: string[][] } {
  const { ts } = kit;
  const dbName = new Map<string, string>();
  const primary: string[] = [];
  const sets: string[][] = [];
  for (const { member, checker: memberChecker } of entityMembers(kit, checker, statement)) {
    if (!ts.isPropertyDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
    const property = member.name.text;
    const column = mappedColumnName(kit, member, property);
    dbName.set(property, column.toLowerCase());
    for (const decorator of kit.decorators(member)) addUniqueColumnSet(kit, memberChecker, decorator, column, primary, sets);
  }
  if (primary.length) sets.push(primary);
  return { dbName, sets };
}

function addEntityUniqueSets(kit: MachineKit, checker: TypeChecker, statement: ClassDeclaration, dbName: Map<string, string>, sets: string[][]): void {
  const { ts } = kit;
  for (const decorator of kit.decorators(statement)) {
    const args: readonly Expression[] = ts.isCallExpression(decorator.expression) ? decorator.expression.arguments : [];
    const list = args.find(item => ts.isArrayLiteralExpression(item) && literalStrings(ts, item));
    const columns = list ? literalStrings(ts, list) : null;
    const unique = isTypeormDecorator(kit, checker, decorator, 'Unique') || (isTypeormDecorator(kit, checker, decorator, 'Index') && args.some(item => isUniqueTrue(kit, item)));
    if (unique && columns) sets.push(columns.map(column => (dbName.get(column) ?? column).toLowerCase()));
  }
}

/** Records the entities one `.entity.ts` file declares into `tables`; returns how many of its entities have no readable table name. */
function addFileEntities(kit: MachineKit, file: GraphFile, tables: Map<string, TableDeclaration>): number {
  const checker: TypeChecker = kit.checkerOf(file.sourceFile);
  let unreadable = 0;
  for (const statement of file.sourceFile.statements) {
    if (!kit.ts.isClassDeclaration(statement)) continue;
    const entity = entityTableInfo(kit, checker, statement);
    if (!entity) continue;
    if (entity.table === null) { unreadable += 1; continue; }
    const { dbName, sets } = entityColumnSets(kit, checker, statement);
    addEntityUniqueSets(kit, checker, statement, dbName, sets);
    const key = entity.table.toLowerCase();
    if (!tables.has(key)) tables.set(key, { table: entity.table, owner: file.owner.root, rel: file.rel, uniqueSets: sets });
  }
  return unreadable;
}

export function entitiesOf(kit: MachineKit, graph: HfsGraph): { tables: Map<string, TableDeclaration>; unreadable: number } {
  const tables = new Map<string, TableDeclaration>();
  let unreadable = 0;
  for (const file of graph.files.values()) {
    if (file.slot !== 'be.persistence' || !path.posix.basename(file.rel).endsWith('.entity.ts') || !file.owner) continue;
    unreadable += addFileEntities(kit, file, tables);
  }
  return { tables, unreadable };
}

const capabilityTable = (root: string): string => path.posix.basename(root).replaceAll('-', '_').toLowerCase();

/** SQL-authority declarations (the public tables db/migrations create), with an owner when a table name matches a capability's persistence folder. */
function sqlDeclarations(graph: HfsGraph, appRoot: string): Map<string, TableDeclaration> {
  const keys = sqlUniqueSetsOf(appRoot);
  const tables = new Map<string, TableDeclaration>([...keys.keys()].map((table): [string, TableDeclaration] => [table, { table, owner: null, rel: null, uniqueSets: keys.get(table) ?? [] }]));
  for (const file of graph.files.values()) {
    if (file.slot !== 'be.persistence' || !file.owner) continue;
    const key = capabilityTable(file.owner.root);
    const declaration = tables.get(key);
    if (declaration?.owner === null) tables.set(key, { ...declaration, owner: file.owner.root, rel: file.rel });
  }
  return tables;
}

/** A capability owns the table named for it and the tables that start with its name and an underscore (`realtime`, `realtime_events`). */
const isOwnTable = (table: string, ownTable: string): boolean => {
  const name = table.toLowerCase();
  return name === ownTable || name.startsWith(`${ownTable}_`);
};

function reportSqlWrite({ tables, sqlAuthority, file, ownTable, report }: SqlWriteInput, write: SqlTableUse): void {
  const declaration = tables.get(write.table.toLowerCase());
  if (!declaration) {
    report(sqlAuthority
      ? `SQL writes table ${write.table}, which no db/migrations migration creates; add the table in a migration first.`
      : `SQL writes table ${write.table}, which no @Entity declares; declare the entity in the owning capability's persistence/entities.`, { table: write.table });
  } else if (sqlAuthority) {
    if (isOwnTable(write.table, ownTable) && (declaration.owner === null || declaration.owner === file.owner.root)) return;
    const ownerNote = declaration.owner ? `, owned by ${declaration.owner}` : '';
    report(`SQL in ${file.owner.root} writes table ${write.table}${ownerNote}; under the SQL migration authority a capability writes only its own table (${ownTable}), named for that capability.`, { table: write.table, ...(declaration.owner ? { tableOwner: declaration.owner } : {}) });
  } else if (declaration.owner !== file.owner.root) {
    report(`SQL in ${file.owner.root} writes table ${write.table}, owned by ${declaration.owner}; a capability writes only the tables of its own entities, call the owner's public API instead.`, { table: write.table, tableOwner: declaration.owner });
  }
}

function reportSqlWrites(input: SqlWriteInput & { result: SqlAnalysis }): void {
  for (const write of input.result.writes) reportSqlWrite(input, write);
}

function reportSqlRead(tables: Map<string, TableDeclaration>, sqlAuthority: boolean, file: GraphFile, model: ContextModel, resolver: SlotResolver, report: SqlReport, read: SqlTableUse): void {
  const declaration = tables.get(read.table.toLowerCase());
  if (!declaration) {
    report(sqlAuthority
      ? `SQL reads table ${read.table}, which no db/migrations migration creates; add the table in a migration first.`
      : `SQL reads table ${read.table}, which no @Entity declares; declare the entity in the owning capability's persistence/entities.`, { table: read.table });
    return;
  }
  if (!declaration.owner || declaration.owner === file.owner.root) return;
  const ownContext = model.contextOfCapability(file.owner.root);
  const tableContext = model.contextOfCapability(declaration.owner);
  if (ownContext && tableContext && ownContext !== tableContext) {
    report(`SQL in ${file.owner.root} (context ${ownContext}) reads table ${read.table}, owned by ${declaration.owner} (context ${tableContext}); a context reads and writes only its own context's tables, so a cross-context JOIN or subquery is refused. Keep a local copy fed by the other context's events (a reactor), or read a projection.`, { table: read.table, tableOwner: declaration.owner, context: ownContext, tableContext });
    return;
  }
  const verdict = resolver.importAllowed(file.rel, `${declaration.owner}/index.ts`);
  if (!verdict.allowed) report(`SQL in ${file.owner.root} reads table ${read.table}, owned by ${declaration.owner}, which ${file.owner.root} may not import (${verdict.reason}); read it through the owner's public API.`, { table: read.table, tableOwner: declaration.owner, reason: verdict.reason });
}

function reportSqlReads({ result, tables, sqlAuthority, file, model, resolver, report }: { result: SqlAnalysis; tables: Map<string, TableDeclaration>; sqlAuthority: boolean; file: GraphFile; model: ContextModel; resolver: SlotResolver; report: SqlReport }): void {
  for (const read of result.reads) reportSqlRead(tables, sqlAuthority, file, model, resolver, report, read);
}

function reportSqlSelects({ result, tables, report }: { result: SqlAnalysis; tables: Map<string, TableDeclaration>; report: SqlReport }): void {
  for (const select of result.selects) {
    if (select.bounded || (select.table && !tables.has(select.table.toLowerCase()))) continue;
    const tableNote = select.table ? `on ${select.table} ` : '';
    report(`SELECT ${tableNote}has no LIMIT and does not constrain a primary key or unique column with =; bound it with LIMIT (PAGE_SIZE_MAX, LIST_ROWS_MAX or BATCH_ROWS from platform/database), filter by key, or select only aggregates.`, { table: select.table ?? undefined });
  }
}

function inspectSqlTag(input: SqlInspection, state: SqlState, file: GraphFile, checker: TypeChecker, node: Node): boolean {
  const { kit, ts, tables, sqlAuthority, model, resolver } = input;
  if (!ts.isTaggedTemplateExpression(node)) return true;
  const home = kit.declarationsOf(checker, node.tag).map(kit.ownerOfDeclaration).find(Boolean);
  if (home?.tier !== 'platform' || home?.name !== 'database') { state.foreignTags += 1; return true; }
  state.templates += 1;
  const template = node.template;
  const text = ts.isNoSubstitutionTemplateLiteral(template) ? template.text
    : template.head.text + template.templateSpans.map(span => HOLE + span.literal.text).join('');
  const seen = new Set<string>();
  const report = (message: string, extra: Record<string, unknown> = {}): void => {
    const key = `${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    state.violations.push({ ruleId: RULE, path: file.rel, ...kit.at(file.rel, file.sourceFile, node), message, ...extra });
  };
  const result = analyzeSql(text, { uniqueSetsOf: (table: string, schema: string | null) => {
    if (sqlAuthority && ((schema && schema !== 'public') || table !== table.toLowerCase())) return null;
    return tables.get(table.toLowerCase())?.uniqueSets ?? null;
  } });
  state.dynamic += result.dynamic;
  const ownTable = capabilityTable(file.owner.root);
  reportSqlWrites({ result, tables, sqlAuthority, file, ownTable, report });
  reportSqlReads({ result, tables, sqlAuthority, file, model, resolver, report });
  reportSqlSelects({ result, tables, report });
  return true;
}

function inspectSqlFile(input: SqlInspection, state: SqlState, file: GraphFile): void {
  const { kit } = input;
  if (file.slot !== 'be.persistence' || !path.posix.basename(file.rel).endsWith('.sql.ts') || !file.owner) return;
  const checker: TypeChecker = kit.checkerOf(file.sourceFile);
  kit.walk(file.sourceFile, (node: Node) => inspectSqlTag(input, state, file, checker, node));
}

export function checkSqlOwner(input: HfsCheckInput): CheckResult {
  const { config, graph } = input;
  const kit = machineKit(input);
  const { ts, resolver } = kit;
  const sqlAuthority = resolver.ruleParams().schemaAuthority === 'sql';
  const entityDeclarations: { tables: Map<string, TableDeclaration>; unreadable: number } = sqlAuthority ? { tables: new Map(), unreadable: 0 } : entitiesOf(kit, graph);
  const tables = sqlAuthority ? sqlDeclarations(graph, config.packageRoot) : entityDeclarations.tables;
  const model = contextModelOf(kit, graph);
  const state: SqlState = { violations: [], templates: 0, dynamic: 0, foreignTags: 0 };
  const inspection: SqlInspection = { kit, ts, tables, sqlAuthority, model, resolver };
  for (const file of graph.files.values()) inspectSqlFile(inspection, state, file);
  return { violations: state.violations, coverage: { status: 'checked', entities: entityDeclarations.tables.size, unreadableEntities: entityDeclarations.unreadable,
    ...(sqlAuthority ? { sqlTables: tables.size } : {}), templates: state.templates, dynamicIdentifiers: state.dynamic, foreignTags: state.foreignTags } };
}
