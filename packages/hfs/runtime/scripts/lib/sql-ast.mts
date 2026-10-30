// PostgreSQL AST primitives shared by database verbs and synchronous content rules.

/** String identifier components from libpg-query's wrapped String nodes. */
// reason: libpg-query's parse tree is an untyped input boundary (a wrapped-node JSON document); every function here narrows what it reads.
export type SqlNode = any;

export const sqlStringParts = (nodes?: SqlNode[] | null): string[] => (nodes ?? []).map((node) => node?.String?.sval).filter((value) => value !== undefined);

/** Traverse SQL/PLpgSQL objects; executable scans leave function declarations inert. */
export function walkSqlAst(value: SqlNode, visit: (node: SqlNode) => void, executable = false): void {
  if (!value || typeof value !== 'object' || (executable && value.CreateFunctionStmt)) return;
  visit(value);
  for (const child of Object.values(value)) walkSqlAst(child, visit, executable);
}

/** Build a synchronous parser with the caller's failure policy and initialized parser. */
export function sqlParser<R = null>(parser: { parseSync(text: string): SqlNode } | null | undefined, reject: (error: unknown) => R = () => null as R): (text: string) => SqlNode | R {
  return (text: string) => {
    try { return parser?.parseSync(text) ?? null; }
    catch (error) { return reject(error); }
  };
}

/** Resolve named arguments before positional arguments, as PostgreSQL does. */
export function sqlCallArgument(call: SqlNode, position: number, names: readonly string[] = []): SqlNode {
  const args: SqlNode[] = call.args ?? [];
  return args.find((item) => names.includes(item?.NamedArgExpr?.name))?.NamedArgExpr?.arg
    ?? args.filter((item) => !item.NamedArgExpr)[position];
}

/** Read a literal string through static casts without evaluating an expression. */
export function sqlStringLiteral(node: SqlNode): string | null {
  if (node?.TypeCast) return sqlStringLiteral(node.TypeCast.arg);
  return node?.A_Const?.sval?.sval ?? null;
}
