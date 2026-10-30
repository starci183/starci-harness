/** Token forms shared by SQL relation scanning and conservative singleton-value proofs. */

/** One SQL token: its kind `t`, its text `v` and, for a word, the upper-cased spelling `up`. */
export interface SqlToken {
  t: string;
  v: string;
  up?: string;
}

/** Whether a token can spell an SQL identifier. */
export const isName = (token: SqlToken | undefined): token is SqlToken => Boolean(token && (token.t === 'word' || token.t === 'ident'));
/** The identifier spelling after SQL word folding. */
export const nameOf = (token: SqlToken): string => (token.t === 'word' ? token.v.toLowerCase() : token.v);
/** Whether a token is the named SQL keyword. */
export const isWord = (token: SqlToken | undefined, up: string): boolean => token?.t === 'word' && token.up === up;

// The scalar-cast grammar proves only these builtin targets, unqualified or explicitly under pg_catalog.
const SCALAR_CAST_TYPES = new Set(['uuid', 'text']);

/** Depth of each token (the depth before it when it is `(`, after it when it is `)`). */
export function depths(tokens: SqlToken[]): number[] {
  let depth = 0;
  return tokens.map(token => {
    if (token.v === ')' && token.t === 'punct') depth -= 1;
    const here = depth;
    if (token.v === '(' && token.t === 'punct') depth += 1;
    return here;
  });
}

/** The closing parenthesis of a token group, or the final token when unmatched. */
export function matching(tokens: SqlToken[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if ((tokens[i] as SqlToken).t !== 'punct') continue;
    if ((tokens[i] as SqlToken).v === '(') depth += 1;
    else if ((tokens[i] as SqlToken).v === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return tokens.length - 1;
}

function unparenthesized(tokens: SqlToken[]): SqlToken[] {
  let part = tokens;
  while (part[0]?.v === '(' && part.at(-1)?.v === ')' && matching(part, 0) === part.length - 1) part = part.slice(1, -1);
  return part;
}

function keyColumn(tokens: SqlToken[], qualifiers: Set<string>): string | null {
  const part = unparenthesized(tokens);
  if (singletonValue(part)) return null;
  if (part.length === 1 && isName(part[0])) return nameOf(part[0]);
  if (part.length === 3 && isName(part[0]) && part[1]?.v === '.' && isName(part[2]) && qualifiers.has(nameOf(part[0]))) return nameOf(part[2]);
  return null;
}

function scalarCastType(tokens: SqlToken[]): boolean {
  if (tokens.length === 1 && isName(tokens[0])) return SCALAR_CAST_TYPES.has(nameOf(tokens[0]));
  return tokens.length === 3 && isName(tokens[0]) && nameOf(tokens[0]) === 'pg_catalog' && tokens[1]?.v === '.'
    && isName(tokens[2]) && SCALAR_CAST_TYPES.has(nameOf(tokens[2]));
}

/** SQL CAST is a scalar wrapper; its operand is still inspected separately for row dependence or set-returning calls. */
function castParts(tokens: SqlToken[], start = 0): { value: SqlToken[]; type: SqlToken[]; next: number } | null {
  if (!isWord(tokens[start], 'CAST') || tokens[start + 1]?.v !== '(') return null;
  const end = matching(tokens, start + 1);
  if (tokens[end]?.v !== ')') return null;
  const inside = tokens.slice(start + 2, end);
  const level = depths(inside);
  const separator = inside.findIndex((token, index) => level[index] === 0 && isWord(token, 'AS'));
  if (separator < 1 || separator === inside.length - 1) return null;
  return { value: inside.slice(0, separator), type: inside.slice(separator + 1), next: end + 1 };
}

/** A scalar atom, optionally cast through the supported builtin grammar, proves a row-independent equality value. */
function singletonValue(tokens: SqlToken[]): boolean {
  const part = unparenthesized(tokens);
  if (part.length === 2 && ['+', '-'].includes((part[0] as SqlToken).v) && part[1]?.t === 'number') return true;
  if (part.length === 1) {
    const [token] = part as [SqlToken];
    return ['param', 'string', 'number'].includes(token.t) || isWord(token, 'NULL') || isWord(token, 'TRUE') || isWord(token, 'FALSE');
  }
  const cast = castParts(part);
  if (cast && cast.next === part.length && scalarCastType(cast.type)) return singletonValue(cast.value);
  const level = depths(part);
  for (let index = part.length - 1; index > 0; index -= 1) {
    if (level[index] === 0 && (part[index] as SqlToken).v === '::') return scalarCastType(part.slice(index + 1)) && singletonValue(part.slice(0, index));
  }
  return false;
}

/** Key columns equated to proven row-independent singleton values in either operand order. */
export function equalityColumns(conjunct: SqlToken[], qualifiers: Set<string>): Set<string> {
  const found = new Set<string>();
  const part = unparenthesized(conjunct);
  const level = depths(part);
  const equals = part.findIndex((token, index) => level[index] === 0 && token.t === 'punct' && token.v === '=');
  if (equals < 0) return found;
  const left = part.slice(0, equals);
  const right = part.slice(equals + 1);
  const leftColumn = keyColumn(left, qualifiers);
  const rightColumn = keyColumn(right, qualifiers);
  if (leftColumn && singletonValue(right)) found.add(leftColumn);
  if (rightColumn && singletonValue(left)) found.add(rightColumn);
  return found;
}

/** Whether a call position is SQL CAST through the supported scalar type grammar. */
export function scalarCastAt(tokens: SqlToken[], index: number): boolean {
  if (tokens[index - 1]?.v === '.') return false;
  const cast = castParts(tokens, index);
  return Boolean(cast && scalarCastType(cast.type));
}
