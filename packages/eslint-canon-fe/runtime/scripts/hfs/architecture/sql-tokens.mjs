/**
 * A small PostgreSQL text reader for the R86 machine check (sql-owner). No SQL parser is a dependency of the runtime, so
 * this is a tokenizer plus a clause scanner, written for exactly what the check needs: which tables a statement
 * writes, which it reads, and whether a SELECT is bounded. Comments and string literals never reach the scanner.
 * A substitution of the `sql` tag (a `${...}` hole, the SqlIdent form) is an opaque token: a table position that holds
 * one is counted as dynamic and judged by nobody.
 */
import { depths, equalityColumns, isName, isWord, matching, nameOf, scalarCastAt } from './sql-token-forms.mjs';
export const HOLE = '';
const tokenAt = (tokens, index) => tokens[index];
/** The upper-cased spelling of a word token ('' for a token that has none). */
const upOf = (token) => token?.up ?? '';
const isSpace = (char) => /\s/u.test(char);
const isWordStart = (char) => /[\p{L}_]/u.test(char);
const isWordPart = (char) => /[\p{L}\p{N}_$]/u.test(char);
const commentEnd = (text, index) => {
    if (text[index] === '-' && text[index + 1] === '-') {
        while (index < text.length && text[index] !== '\n')
            index += 1;
        return index;
    }
    if (text[index] !== '/' || text[index + 1] !== '*')
        return null;
    const end = text.indexOf('*/', index + 2);
    return end === -1 ? text.length : end + 2;
};
const singleQuotedEnd = (text, index, push) => {
    if (text[index] !== "'")
        return null;
    index += 1;
    while (index < text.length) {
        if (text[index] === "'" && text[index + 1] === "'") {
            index += 2;
            continue;
        }
        if (text[index] === "'")
            break;
        index += 1;
    }
    push('string', '');
    return index + 1;
};
const quotedIdentifierEnd = (text, index, push) => {
    if (text[index] !== '"')
        return null;
    let value = '';
    index += 1;
    while (index < text.length) {
        if (text[index] === '"' && text[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
        }
        if (text[index] === '"')
            break;
        value += text[index];
        index += 1;
    }
    push('ident', value);
    return index + 1;
};
const dollarTokenEnd = (text, index, push) => {
    if (text[index] !== '$')
        return null;
    const param = /^\$(\d+)/u.exec(text.slice(index, index + 12));
    if (param) {
        push('param', param[0]);
        return index + param[0].length;
    }
    const tag = /^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u.exec(text.slice(index));
    if (!tag)
        return null;
    const end = text.indexOf(tag[0], index + tag[0].length);
    push('string', '');
    return end === -1 ? text.length : end + tag[0].length;
};
const numberEnd = (text, index, push) => {
    if (!/\d/u.test(text[index]))
        return null;
    let end = index;
    while (end < text.length && /[\d.]/u.test(text[end]))
        end += 1;
    push('number', text.slice(index, end));
    return end;
};
const wordEnd = (text, index, push) => {
    if (!isWordStart(text[index]))
        return null;
    let end = index;
    while (end < text.length && isWordPart(text[end]))
        end += 1;
    const word = text.slice(index, end);
    if (text[end] !== "'" || !/^[EeBbXxNn]$/u.test(word)) {
        push('word', word);
        return end;
    }
    const escaped = /^[Ee]$/u.test(word);
    end += 1;
    while (end < text.length) {
        if (escaped && text[end] === '\\') {
            end += 2;
            continue;
        }
        if (text[end] === "'" && text[end + 1] === "'") {
            end += 2;
            continue;
        }
        if (text[end] === "'")
            break;
        end += 1;
    }
    push('string', '');
    return end + 1;
};
const punctuationEnd = (text, index, push) => {
    const two = text.slice(index, index + 2);
    if (['::', '<=', '>=', '<>', '!=', '||', '->'].includes(two)) {
        push('punct', two);
        return index + 2;
    }
    push('punct', text[index]);
    return index + 1;
};
function consumeToken(text, index, push) {
    const comment = commentEnd(text, index);
    if (comment !== null)
        return comment;
    if (text[index] === HOLE) {
        push('hole', HOLE);
        return index + 1;
    }
    const singleQuoted = singleQuotedEnd(text, index, push);
    if (singleQuoted !== null)
        return singleQuoted;
    const identifier = quotedIdentifierEnd(text, index, push);
    if (identifier !== null)
        return identifier;
    const dollarToken = dollarTokenEnd(text, index, push);
    if (dollarToken !== null)
        return dollarToken;
    const number = numberEnd(text, index, push);
    if (number !== null)
        return number;
    const word = wordEnd(text, index, push);
    return word ?? punctuationEnd(text, index, push);
}
/** Tokens: {t: 'word'|'ident'|'string'|'number'|'param'|'hole'|'punct', v, up?} (`up` is the uppercase word). */
export function tokenizeSql(text) {
    const tokens = [];
    let i = 0;
    const push = (t, v) => tokens.push(t === 'word' ? { t, v, up: v.toUpperCase() } : { t, v });
    while (i < text.length) {
        const char = text[i];
        if (isSpace(char)) {
            i += 1;
            continue;
        }
        i = consumeToken(text, i, push);
    }
    return tokens;
}
const CLAUSE_WORDS = new Set(['WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'ON', 'USING', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET',
    'HAVING', 'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW', 'FOR', 'RETURNING', 'SET', 'VALUES', 'SELECT', 'FETCH', 'OUTER', 'TABLESAMPLE', 'WITH', 'AS']);
// PostgreSQL aggregate function names, kept as one string so they read as words, not as failure codes.
const AGGREGATES = new Set('COUNT SUM AVG MIN MAX BOOL_AND BOOL_OR EVERY ARRAY_AGG STRING_AGG JSON_AGG JSONB_AGG JSON_OBJECT_AGG JSONB_OBJECT_AGG BIT_AND BIT_OR STDDEV VARIANCE'.split(' '));
const FROM_INSIDE = new Set(['EXTRACT', 'SUBSTRING', 'TRIM', 'OVERLAY', 'POSITION']);
const NOT_A_WRITE_BEFORE_UPDATE = new Set(['FOR', 'DO', 'ON', 'KEY', 'SHARE', 'OF']);
const WHERE_END = new Set(['GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'FOR', 'WINDOW', 'RETURNING', 'FETCH']);
const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema']);
/**
 * The table reference at `start`: {parts, table, alias, next}, {dynamic: true}, or null (a subquery, a function, nothing).
 * `next` is the index after the reference and its alias.
 */
function tableNameAt(tokens, start) {
    let i = start;
    while (isWord(tokens[i], 'ONLY') || isWord(tokens[i], 'LATERAL'))
        i += 1;
    const first = tokens[i];
    if (first?.t === 'hole')
        return { dynamic: true, next: i + 1 };
    if (!isName(first) || (first.t === 'word' && CLAUSE_WORDS.has(upOf(first)) && first.up !== 'AS'))
        return null;
    const parts = [nameOf(first)];
    i += 1;
    for (;;) {
        const part = tokens[i + 1];
        if (!(tokens[i]?.v === '.' && isName(part)))
            break;
        parts.push(nameOf(part));
        i += 2;
    }
    return { parts, next: i };
}
function tableAliasAt(tokens, index) {
    const current = tokens[index];
    const after = tokens[index + 1];
    if (isWord(current, 'AS') && isName(after))
        return { alias: nameOf(after), next: index + 2 };
    if (isName(current) && !(current.t === 'word' && CLAUSE_WORDS.has(upOf(current))))
        return { alias: nameOf(current), next: index + 1 };
    return { alias: null, next: index };
}
function columnListEnd(tokens, start) {
    let i = start;
    let depth = 0;
    do {
        if (tokenAt(tokens, i).v === '(')
            depth += 1;
        else if (tokenAt(tokens, i).v === ')')
            depth -= 1;
        i += 1;
    } while (i < tokens.length && depth > 0);
    return i;
}
function tableRef(tokens, start, { columns = false } = {}) {
    const reference = tableNameAt(tokens, start);
    if (!reference)
        return null;
    if (reference.dynamic)
        return reference;
    const { parts } = reference;
    let i = reference.next;
    if (tokens[i]?.v === '(' && !columns)
        return null;
    const { alias, next } = tableAliasAt(tokens, i);
    i = next;
    if (alias && tokens[i]?.v === '(')
        i = columnListEnd(tokens, i);
    return { parts, table: parts.at(-1), schema: parts.length > 1 ? parts.at(-2) : null, alias, next: i };
}
function statementsOf(tokens) {
    const statements = [];
    let current = [];
    let depth = 0;
    for (const token of tokens) {
        if (token.t === 'punct' && token.v === '(')
            depth += 1;
        if (token.t === 'punct' && token.v === ')')
            depth -= 1;
        if (token.t === 'punct' && token.v === ';' && depth <= 0) {
            if (current.length) {
                statements.push(current);
            }
            current = [];
            continue;
        }
        current.push(token);
    }
    if (current.length)
        statements.push(current);
    return statements;
}
function cteNameBefore(tokens, index) {
    let afterAs = index + 1;
    if (isWord(tokens[afterAs], 'NOT'))
        afterAs += 1;
    if (isWord(tokens[afterAs], 'MATERIALIZED'))
        afterAs += 1;
    if (tokens[afterAs]?.v !== '(')
        return null;
    let nameIndex = index - 1;
    if (tokens[nameIndex]?.v === ')') {
        let depth = 0;
        do {
            if (tokenAt(tokens, nameIndex).v === ')')
                depth += 1;
            else if (tokenAt(tokens, nameIndex).v === '(')
                depth -= 1;
            nameIndex -= 1;
        } while (nameIndex >= 0 && depth > 0);
    }
    const before = tokens[nameIndex - 1];
    const named = tokens[nameIndex];
    if (isName(named) && (isWord(before, 'WITH') || isWord(before, 'RECURSIVE') || before?.v === ','))
        return nameOf(named);
    return null;
}
/** The CTE names a statement declares: `name [(cols)] AS [NOT] [MATERIALIZED] (`. */
function cteNames(tokens) {
    const names = new Set();
    for (let i = 1; i < tokens.length; i += 1) {
        if (!isWord(tokens[i], 'AS'))
            continue;
        const name = cteNameBefore(tokens, i);
        if (name !== null)
            names.add(name);
    }
    return names;
}
function isAggregateItem(item) {
    for (let i = 0; i < item.length; i += 1) {
        const token = tokenAt(item, i);
        if (token.t === 'word' && AGGREGATES.has(upOf(token)) && item[i + 1]?.v === '(') {
            const close = matching(item, i + 1);
            if (!isWord(item[close + 1], 'OVER'))
                return true;
        }
    }
    return false;
}
/** The unique-key columns `columns` (lowercase Set of `=`-constrained column names) satisfy for one of `uniqueSets`. */
const covers = (uniqueSets, columns) => uniqueSets.some(set => set.length > 0 && set.every(column => columns.has(column)));
/**
 * Judge one statement that reads rows (no INSERT/UPDATE/DELETE/MERGE at its own depth): `{bounded, basis}`. Bounded is
 * a LIMIT/FETCH at the statement depth, no FROM at all (one row), only aggregates without GROUP BY, or an equality on
 * every column of the primary key or of one unique key of a single FROM relation. Unknown projection calls can
 * multiply rows even when that relation contributes at most one, so they need an explicit statement bound.
 */
function aggregateSelectItems(tokens, level, select, from) {
    const items = [];
    let item = [];
    for (let i = select + 1; i < from; i += 1) {
        const token = tokenAt(tokens, i);
        if (level[i] === 0 && token.v === ',' && token.t === 'punct') {
            items.push(item);
            item = [];
            continue;
        }
        if (!(items.length === 0 && item.length === 0 && (isWord(token, 'DISTINCT') || isWord(token, 'ALL'))))
            item.push(token);
    }
    items.push(item);
    return items;
}
function whereRegion(tokens, level, where) {
    const region = [];
    for (let i = where + 1; i < tokens.length; i += 1) {
        const token = tokenAt(tokens, i);
        if (level[i] === 0 && token.t === 'word' && WHERE_END.has(upOf(token)))
            break;
        region.push({ token, level: level[i] });
    }
    return region;
}
/** The tokens of a WHERE region split at its top-level AND; the AND of a BETWEEN stays inside its conjunct. */
function splitConjuncts(region) {
    const conjuncts = [[]];
    let between = false;
    for (const entry of region) {
        const top = entry.level === 0;
        if (top && isWord(entry.token, 'BETWEEN'))
            between = true;
        const isAnd = top && isWord(entry.token, 'AND');
        if (isAnd && !between) {
            conjuncts.push([]);
            continue;
        }
        if (isAnd)
            between = false;
        conjuncts.at(-1).push(entry.token);
    }
    return conjuncts;
}
function uniqueWhereColumns(region, primary) {
    if (region.some(entry => entry.level === 0 && isWord(entry.token, 'OR')))
        return null;
    const conjuncts = splitConjuncts(region);
    const qualifiers = new Set([primary.table, primary.alias].filter((name) => Boolean(name)));
    const columns = new Set();
    for (const conjunct of conjuncts)
        for (const column of equalityColumns(conjunct, qualifiers))
            columns.add(column);
    return columns;
}
function findTopWord(tokens, level, up, from = 0) {
    for (let i = from; i < tokens.length; i += 1) {
        if (level[i] === 0 && isWord(tokens[i], up))
            return i;
    }
    return -1;
}
const hasTopGroupBy = (tokens, level) => tokens.some((token, i) => level[i] === 0 && isWord(token, 'GROUP') && isWord(tokens[i + 1], 'BY'));
function isUniqueBounded(tokens, level, from, primary, uniqueSets) {
    const where = findTopWord(tokens, level, 'WHERE', from);
    if (!uniqueSets?.length || where < 0)
        return false;
    const columns = uniqueWhereColumns(whereRegion(tokens, level, where), primary);
    return columns !== null && covers(uniqueSets, columns);
}
function singleFromRelation(tokens, level, from) {
    for (let index = from + 1; index < tokens.length; index += 1) {
        if (level[index] !== 0)
            continue;
        const token = tokenAt(tokens, index);
        if (isWord(token, 'WHERE') || (token.t === 'word' && WHERE_END.has(upOf(token))))
            break;
        if (isWord(token, 'JOIN') || (token.t === 'punct' && token.v === ','))
            return false;
    }
    return true;
}
// Functions that return a set of rows when they stand in a select list. A select list holding one multiplies the rows.
const SET_RETURNING = new Set(`GENERATE_SERIES GENERATE_SUBSCRIPTS UNNEST REGEXP_MATCHES REGEXP_SPLIT_TO_TABLE STRING_TO_TABLE
JSON_EACH JSONB_EACH JSON_EACH_TEXT JSONB_EACH_TEXT JSON_ARRAY_ELEMENTS JSONB_ARRAY_ELEMENTS JSON_ARRAY_ELEMENTS_TEXT JSONB_ARRAY_ELEMENTS_TEXT
JSON_OBJECT_KEYS JSONB_OBJECT_KEYS JSON_TO_RECORDSET JSONB_TO_RECORDSET JSON_POPULATE_RECORDSET JSONB_POPULATE_RECORDSET
JSONB_PATH_QUERY JSONB_PATH_QUERY_TZ JSON_TABLE PG_LS_DIR PG_LS_WALDIR PG_LS_LOGDIR PG_LISTENING_CHANNELS PG_SHOW_ALL_SETTINGS PG_GET_KEYWORDS ACLEXPLODE TS_STAT TS_DEBUG`.split(/\s+/u));
// Scalar builtins and operator-like words that are no row-multiplying call; the aggregate-only shape accepts these around its aggregates.
const SCALAR_CALLS = new Set(`COALESCE NULLIF GREATEST LEAST ROUND CEIL CEILING FLOOR ABS TRUNC EXTRACT DATE_PART DATE_TRUNC TO_CHAR LOWER UPPER LENGTH CONCAT
JSONB_BUILD_OBJECT JSONB_BUILD_ARRAY JSON_BUILD_OBJECT JSON_BUILD_ARRAY TO_JSONB TO_JSON`.split(/\s+/u));
const NOT_A_CALL = new Set(['IN', 'ANY', 'ALL', 'SOME', 'AND', 'OR', 'NOT', 'FILTER', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'AS', 'ON', 'DISTINCT', 'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'WITHIN', 'FROM']);
const callAt = (tokens, index) => {
    const token = tokens[index];
    return isName(token) && tokens[index + 1]?.v === '(' && !(token.t === 'word' && (NOT_A_CALL.has(upOf(token)) || CLAUSE_WORDS.has(upOf(token))));
};
/** A call to a set-returning function anywhere in the statement (conservative: nested positions count). */
const hasSetReturningCall = (tokens) => tokens.some((token, index) => callAt(tokens, index) && token.t === 'word' && SET_RETURNING.has(upOf(token)));
const hasWindow = (tokens) => tokens.some(token => isWord(token, 'OVER'));
/** Plain known aggregate calls and known scalar builtins are scalar; other calls, including wrappers around aggregates, may return sets. */
function unprovenProjectionCall(tokens, level, select, from) {
    const end = from < 0 ? tokens.length : from;
    for (let index = select + 1; index < end; index += 1) {
        const token = tokenAt(tokens, index);
        if (level[index] === 0 && (isWord(token, 'WHERE') || (token.t === 'word' && WHERE_END.has(upOf(token)))))
            break;
        if (!callAt(tokens, index))
            continue;
        if (scalarCastAt(tokens, index))
            continue;
        const known = token.t === 'word' && tokens[index - 1]?.v !== '.' && (AGGREGATES.has(upOf(token)) || SCALAR_CALLS.has(upOf(token)));
        if (!known)
            return true;
    }
    return false;
}
/**
 * A SELECT that returns at most one row by construction: it has no FROM (one row, unless a set-returning function multiplies it),
 * or it selects only aggregates (plain or inside known scalar calls and casts) with no GROUP BY, window or set-returning function.
 */
function singleRowBound(tokens, level, select, from, grouped) {
    if (hasSetReturningCall(tokens) || hasWindow(tokens))
        return null;
    if (from < 0)
        return grouped ? null : { bounded: true, basis: 'no from' };
    if (!grouped && !unprovenProjectionCall(tokens, level, select, from) && aggregateSelectItems(tokens, level, select, from).every(isAggregateItem))
        return { bounded: true, basis: 'aggregate' };
    return null;
}
function selectBound(tokens, level, uniqueSetsOf, cte) {
    if (findTopWord(tokens, level, 'LIMIT') >= 0 || findTopWord(tokens, level, 'FETCH') >= 0)
        return { bounded: true, basis: 'limit' };
    const select = findTopWord(tokens, level, 'SELECT');
    const from = findTopWord(tokens, level, 'FROM', select);
    const primary = from < 0 ? null : tableRef(tokens, from + 1);
    const unbounded = { bounded: false, basis: 'unbounded', table: primary && !primary.dynamic ? primary.table : null };
    const grouped = hasTopGroupBy(tokens, level);
    if (tokens.some((token, index) => level[index] === 0 && (isWord(token, 'UNION') || isWord(token, 'INTERSECT') || isWord(token, 'EXCEPT'))))
        return unbounded;
    const single = singleRowBound(tokens, level, select, from, grouped);
    if (single)
        return single;
    if (unprovenProjectionCall(tokens, level, select, from) || hasSetReturningCall(tokens))
        return unbounded;
    if (grouped || from < 0 || !primary || primary.dynamic || cte.has(primary.table) || !singleFromRelation(tokens, level, from))
        return unbounded;
    if (isUniqueBounded(tokens, level, from, primary, uniqueSetsOf(primary.table, primary.schema)))
        return { bounded: true, basis: 'unique' };
    return unbounded;
}
function recordSqlReference(list, ref, reads, cte, state) {
    if (!ref)
        return;
    if (ref.dynamic) {
        state.dynamic += 1;
        return;
    }
    if (ref.schema && SYSTEM_SCHEMAS.has(ref.schema))
        return;
    if (ref.table.startsWith('pg_'))
        return;
    if (list === reads && !ref.schema && cte.has(ref.table))
        return;
    list.push({ table: ref.table, schema: ref.schema });
}
function recordTableList(tokens, start, list, record, commaIsPunctuation) {
    let i = start;
    for (;;) {
        const ref = tableRef(tokens, i);
        record(list, ref);
        if (ref && tokens[ref.next]?.v === ',' && (!commaIsPunctuation || tokenAt(tokens, ref.next).t === 'punct')) {
            i = ref.next + 1;
            continue;
        }
        break;
    }
}
// Where the table reference of a write verb starts (an offset from the verb) and whether it may carry a column list; null for any other token.
function writeTarget(token, next, previous) {
    if (token.up === 'INSERT' && isWord(next, 'INTO'))
        return { offset: 2, columns: true };
    if (token.up === 'UPDATE' && !(previous?.t === 'word' && NOT_A_WRITE_BEFORE_UPDATE.has(upOf(previous))))
        return { offset: 1, columns: false };
    if ((token.up === 'DELETE' && isWord(next, 'FROM')) || (token.up === 'MERGE' && isWord(next, 'INTO')))
        return { offset: 2, columns: false };
    return null;
}
function processWriteToken(tokens, level, index, token, record, state) {
    const target = writeTarget(token, tokens[index + 1], state.previous);
    if (target) {
        if (level[index] === 0)
            state.hasWriteVerb = true;
        record(state.writes, tableRef(tokens, index + target.offset, { columns: target.columns }));
        return true;
    }
    if (token.up !== 'TRUNCATE')
        return false;
    let start = index + 1;
    if (isWord(tokens[start], 'TABLE'))
        start += 1;
    recordTableList(tokens, start, state.writes, record, false);
    return true;
}
function processReadToken(tokens, index, token, record, state, mergeOrDelete) {
    if (token.up === 'FROM' && !isWord(state.previous, 'DISTINCT') && !isWord(state.previous, 'DELETE') && state.parens.at(-1) !== true) {
        recordTableList(tokens, index + 1, state.reads, record, true);
        return;
    }
    if (token.up === 'JOIN') {
        record(state.reads, tableRef(tokens, index + 1));
        return;
    }
    if (token.up === 'USING' && mergeOrDelete && tokens[index + 1]?.v !== '(')
        record(state.reads, tableRef(tokens, index + 1));
}
function trackParenthesis(tokens, index, state) {
    const token = tokenAt(tokens, index);
    if (token.t !== 'punct')
        return false;
    if (token.v === '(') {
        const before = tokens[index - 1];
        state.parens.push(index > 0 && before !== undefined && before.t === 'word' && FROM_INSIDE.has(upOf(before)));
        return true;
    }
    if (token.v !== ')')
        return false;
    state.parens.pop();
    return true;
}
function statementReferences(tokens, level, cte) {
    const state = { writes: [], reads: [], parens: [], dynamic: 0, hasWriteVerb: false };
    const record = (list, ref) => recordSqlReference(list, ref, state.reads, cte, state);
    const mergeOrDelete = tokens.some(token => isWord(token, 'MERGE')) || tokens.some(token => isWord(token, 'DELETE'));
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokenAt(tokens, i);
        if (trackParenthesis(tokens, i, state) || token.t !== 'word')
            continue;
        state.previous = tokens[i - 1];
        if (processWriteToken(tokens, level, i, token, record, state)) {
            if (token.up === 'DELETE')
                i += 1;
            continue;
        }
        processReadToken(tokens, i, token, record, state, mergeOrDelete);
    }
    return state;
}
function statementAnalysis(tokens, uniqueSetsOf) {
    const cte = cteNames(tokens);
    const level = depths(tokens);
    const references = statementReferences(tokens, level, cte);
    const selects = [];
    const hasSelect = tokens.some((candidate, i) => level[i] === 0 && isWord(candidate, 'SELECT'));
    if (hasSelect && !references.hasWriteVerb)
        selects.push(selectBound(tokens, level, uniqueSetsOf, cte));
    return { ...references, selects };
}
/**
 * Read one SQL text. `uniqueSetsOf(table, schema)` returns the unique-key column sets (each a lowercase column list)
 * proven for that relation by its declared schema authority, or null when no key is known.
 * Returns {writes: [{table, schema}], reads: [{table, schema}], selects: [{bounded, basis, table}], dynamic}.
 */
export function analyzeSql(text, { uniqueSetsOf = () => null } = {}) {
    const writes = [];
    const reads = [];
    const selects = [];
    let dynamic = 0;
    for (const tokens of statementsOf(tokenizeSql(text))) {
        const statement = statementAnalysis(tokens, uniqueSetsOf);
        for (const write of statement.writes)
            writes.push(write);
        for (const read of statement.reads)
            reads.push(read);
        for (const select of statement.selects)
            selects.push(select);
        dynamic += statement.dynamic;
    }
    return { writes, reads, selects, dynamic };
}
