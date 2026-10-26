/** Token forms shared by SQL relation scanning and conservative singleton-value proofs. */

/** Whether a token can spell an SQL identifier. */
export const isName = token => token && (token.t === 'word' || token.t === 'ident');
/** The identifier spelling after SQL word folding. */
export const nameOf = token => (token.t === 'word' ? token.v.toLowerCase() : token.v);
/** Whether a token is the named SQL keyword. */
export const isWord = (token, up) => token?.t === 'word' && token.up === up;

// The scalar-cast grammar proves only these builtin targets, unqualified or explicitly under pg_catalog.
const SCALAR_CAST_TYPES = new Set(['uuid', 'text']);

/** Depth of each token (the depth before it when it is `(`, after it when it is `)`). */
export function depths(tokens) {
  let depth = 0;
  return tokens.map(token => {
    if (token.v === ')' && token.t === 'punct') depth -= 1;
    const here = depth;
    if (token.v === '(' && token.t === 'punct') depth += 1;
    return here;
  });
}

/** The closing parenthesis of a token group, or the final token when unmatched. */
export function matching(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (tokens[i].t !== 'punct') continue;
    if (tokens[i].v === '(') depth += 1;
    else if (tokens[i].v === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return tokens.length - 1;
}

function unparenthesized(tokens) {
  let part = tokens;
  while (part[0]?.v === '(' && part.at(-1)?.v === ')' && matching(part, 0) === part.length - 1) part = part.slice(1, -1);
  return part;
}

function keyColumn(tokens, qualifiers) {
  const part = unparenthesized(tokens);
  if (singletonValue(part)) return null;
  if (part.length === 1 && isName(part[0])) return nameOf(part[0]);
  if (part.length === 3 && isName(part[0]) && part[1].v === '.' && isName(part[2]) && qualifiers.has(nameOf(part[0]))) return nameOf(part[2]);
  return null;
}

function scalarCastType(tokens) {
  if (tokens.length === 1 && isName(tokens[0])) return SCALAR_CAST_TYPES.has(nameOf(tokens[0]));
  return tokens.length === 3 && isName(tokens[0]) && nameOf(tokens[0]) === 'pg_catalog' && tokens[1].v === '.'
    && isName(tokens[2]) && SCALAR_CAST_TYPES.has(nameOf(tokens[2]));
}

/** SQL CAST is a scalar wrapper; its operand is still inspected separately for row dependence or set-returning calls. */
function castParts(tokens, start = 0) {
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
function singletonValue(tokens) {
  const part = unparenthesized(tokens);
  if (part.length === 2 && ['+', '-'].includes(part[0].v) && part[1].t === 'number') return true;
  if (part.length === 1) {
    const [token] = part;
    return ['param', 'string', 'number'].includes(token.t) || isWord(token, 'NULL') || isWord(token, 'TRUE') || isWord(token, 'FALSE');
  }
  const cast = castParts(part);
  if (cast?.next === part.length && scalarCastType(cast.type)) return singletonValue(cast.value);
  const level = depths(part);
  for (let index = part.length - 1; index > 0; index -= 1) {
    if (level[index] === 0 && part[index].v === '::') return scalarCastType(part.slice(index + 1)) && singletonValue(part.slice(0, index));
  }
  return false;
}

/** Key columns equated to proven row-independent singleton values in either operand order. */
export function equalityColumns(conjunct, qualifiers) {
  const found = new Set();
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
export function scalarCastAt(tokens, index) {
  if (tokens[index - 1]?.v === '.') return false;
  const cast = castParts(tokens, index);
  return Boolean(cast && scalarCastType(cast.type));
}
