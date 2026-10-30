// graphql-sdl.mjs - the GraphQL tokenizer and the schema (SDL) reader of graphql-contract.mjs: tokens, a cursor over them, the
// type, value and directive readers a document shares, and `parseSchema` over the SDL `starci app emit` writes. No dependency:
// the runtime ships no GraphQL library.

const PUNCTUATORS = new Set(['{', '}', '(', ')', '[', ']', ':', '!', '=', '$', '@', '|', '&']);

/** One token of a GraphQL source. */
export interface Token { kind: 'name' | 'punct' | 'spread' | 'string' | 'number'; value: string }
/** A reference to a type: `[T!]!` is a non-null list whose item is the non-null named type `T`. */
export interface TypeRef { name: string; list: boolean; nonNull: boolean; item?: TypeRef }
/** A field or input value of an object, interface or input type. */
export interface FieldDefinition { type: TypeRef; args: Map<string, { type: TypeRef; hasDefault: boolean }>; hasDefault: boolean }
/** One type of a parsed schema. */
export type SchemaType =
  | { kind: 'scalar' }
  | { kind: 'enum'; values: Set<string> }
  | { kind: 'union'; members: string[] }
  | { kind: 'object' | 'input' | 'interface'; fields: Map<string, FieldDefinition> };
/** The root operation type names. */
export interface SchemaRoots { query: string; mutation: string; subscription: string; [operation: string]: string }
/** A parsed schema. */
export interface ParsedSchema { types: Map<string, SchemaType>; roots: SchemaRoots }
/** A cursor over tokens with the expectations both parsers share. */
export interface Cursor {
  peek(offset?: number): Token | null;
  next(): Token;
  is(value: string): boolean;
  done(): boolean;
  take(value: string): boolean;
  expect(value: string): Token;
  name(): string;
}

/** The tokens of a GraphQL source: names, punctuators, `...`, strings and numbers; comments and commas are insignificant. */
function commentEnd(source: string, index: number): number { while (index < source.length && source[index] !== '\n') { index += 1; } return index; }
function blockStringAt(source: string, index: number): { token: Token; next: number } { const end = source.indexOf('"""', index + 3); if (end === -1) { throw new SyntaxError('unterminated block string'); } return { token: { kind: 'string', value: source.slice(index + 3, end) }, next: end + 3 }; }
function quotedStringAt(source: string, index: number): { token: Token; next: number } { let end = index + 1; while (end < source.length && source[end] !== '"') { end += source[end] === '\\' ? 2 : 1; } return { token: { kind: 'string', value: source.slice(index + 1, end) }, next: end + 1 }; }
function nameAt(source: string, index: number): { token: Token; next: number } { const match = /^[_A-Za-z]\w*/.exec(source.slice(index)) as RegExpExecArray; return { token: { kind: 'name', value: match[0] }, next: index + match[0].length }; }
function numberAt(source: string, index: number): RegExpExecArray | null { return /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index)); }
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === '#') {
      index = commentEnd(source, index);
    } else if (/[\s,﻿]/.test(char)) {
      index += 1;
    } else if (source.startsWith('...', index)) {
      tokens.push({ kind: 'spread', value: '...' });
      index += 3;
    } else if (source.startsWith('"""', index)) {
      const parsed = blockStringAt(source, index);
      tokens.push(parsed.token);
      index = parsed.next;
    } else if (char === '"') {
      const parsed = quotedStringAt(source, index);
      tokens.push(parsed.token);
      index = parsed.next;
    } else if (PUNCTUATORS.has(char)) {
      tokens.push({ kind: 'punct', value: char });
      index += 1;
    } else if (/[_A-Za-z]/.test(char)) {
      const parsed = nameAt(source, index);
      tokens.push(parsed.token);
      index = parsed.next;
    } else if (/[-0-9]/.test(char)) {
      const match = numberAt(source, index);
      if (!match) throw new SyntaxError(`unexpected character "${char}"`);
      tokens.push({ kind: 'number', value: match[0] });
      index += match[0].length;
    } else {
      throw new SyntaxError(`unexpected character "${char}"`);
    }
  }
  return tokens;
}

/** A cursor over tokens with the expectations both parsers share. */
export function cursorOf(tokens: readonly Token[]): Cursor {
  let index = 0;
  const cursor: Cursor = {
    peek: (offset = 0) => tokens[index + offset] ?? null,
    next: () => {
      const token = tokens[index];
      if (token === undefined) throw new SyntaxError('unexpected end of document');
      index += 1;
      return token;
    },
    is: (value) => tokens[index]?.value === value && tokens[index]?.kind !== 'string',
    done: () => index >= tokens.length,
    take: (value) => {
      if (!cursor.is(value)) return false;
      index += 1;
      return true;
    },
    expect: (value) => {
      const token = cursor.next();
      if (token.value !== value || token.kind === 'string') throw new SyntaxError(`expected "${value}", found "${token.value}"`);
      return token;
    },
    name: () => {
      const token = cursor.next();
      if (token.kind !== 'name') throw new SyntaxError(`expected a name, found "${token.value}"`);
      return token.value;
    },
  };
  return cursor;
}

/** A type reference: `{ name, list, nonNull, item }`. */
export function parseTypeRef(cursor: Cursor): TypeRef {
  let type: TypeRef;
  if (cursor.take('[')) {
    const item = parseTypeRef(cursor);
    cursor.expect(']');
    type = { list: true, item, name: item.name, nonNull: false };
  } else {
    type = { list: false, name: cursor.name(), nonNull: false };
  }
  if (cursor.take('!')) type = { ...type, nonNull: true };
  return type;
}

/** Skips one value of any shape (a default value, a directive argument). */
export function skipValue(cursor: Cursor): void {
  const token = cursor.next();
  if (token.kind !== 'punct') return;
  if (token.value === '$') return void cursor.name();
  let close = null;
  if (token.value === '{') close = '}';
  else if (token.value === '[') close = ']';
  if (close === null) return;
  while (!cursor.take(close)) {
    if (token.value === '{') {
      cursor.name();
      cursor.expect(':');
    }
    skipValue(cursor);
  }
}

export function skipDirectives(cursor: Cursor): void {
  while (cursor.take('@')) {
    cursor.name();
    if (cursor.take('(')) {
      while (!cursor.take(')')) {
        cursor.name();
        cursor.expect(':');
        skipValue(cursor);
      }
    }
  }
}

function skipDescription(cursor: Cursor): void {
  if (cursor.peek()?.kind === 'string') cursor.next();
}

/** Field or input-value definitions between braces. */
function parseFieldDefinitions(cursor: Cursor, withArguments: boolean): Map<string, FieldDefinition> {
  const fields = new Map<string, FieldDefinition>();
  cursor.expect('{');
  while (!cursor.take('}')) {
    skipDescription(cursor);
    const name = cursor.name();
    const args = new Map<string, { type: TypeRef; hasDefault: boolean }>();
    if (withArguments && cursor.take('(')) {
      while (!cursor.take(')')) {
        skipDescription(cursor);
        const argName = cursor.name();
        cursor.expect(':');
        const type = parseTypeRef(cursor);
        const hasDefault = cursor.take('=');
        if (hasDefault) skipValue(cursor);
        skipDirectives(cursor);
        args.set(argName, { type, hasDefault });
      }
    }
    cursor.expect(':');
    const type = parseTypeRef(cursor);
    const hasDefault = cursor.take('=');
    if (hasDefault) skipValue(cursor);
    skipDirectives(cursor);
    fields.set(name, { type, args, hasDefault });
  }
  return fields;
}

// `schema { query: Q ... }` (or `extend schema`): the root operation type names.
function readSchemaDefinition(cursor: Cursor, keyword: string, roots: SchemaRoots): void {
  if (keyword === 'extend') cursor.name();
  skipDirectives(cursor);
  cursor.expect('{');
  while (!cursor.take('}')) {
    const operation = cursor.name();
    cursor.expect(':');
    roots[operation] = cursor.name();
  }
}

// `directive @name(args) repeatable on A | B`: read and dropped.
function skipDirectiveDefinition(cursor: Cursor): void {
  cursor.expect('@');
  cursor.name();
  if (cursor.take('(')) parseArgumentList(cursor);
  if (cursor.is('repeatable')) cursor.name();
  cursor.name();
  cursor.take('|');
  cursor.name();
  while (cursor.take('|')) cursor.name();
}

// The type readers by keyword: each returns [name, definition] for the types map.
function readScalar(cursor: Cursor): [string, SchemaType] {
  const name = cursor.name();
  skipDirectives(cursor);
  return [name, { kind: 'scalar' }];
}

function readEnum(cursor: Cursor): [string, SchemaType] {
  const name = cursor.name();
  skipDirectives(cursor);
  const values = new Set<string>();
  cursor.expect('{');
  while (!cursor.take('}')) {
    skipDescription(cursor);
    values.add(cursor.name());
    skipDirectives(cursor);
  }
  return [name, { kind: 'enum', values }];
}

function readUnion(cursor: Cursor): [string, SchemaType] {
  const name = cursor.name();
  skipDirectives(cursor);
  cursor.expect('=');
  cursor.take('|');
  const members = [cursor.name()];
  while (cursor.take('|')) members.push(cursor.name());
  return [name, { kind: 'union', members }];
}

function readObjectLike(cursor: Cursor, keyword: string): [string, SchemaType] {
  const name = cursor.name();
  if (cursor.is('implements')) {
    cursor.name();
    cursor.take('&');
    cursor.name();
    while (cursor.take('&')) cursor.name();
  }
  skipDirectives(cursor);
  let kind: 'object' | 'input' | 'interface' = 'object';
  if (keyword === 'input') kind = 'input';
  else if (keyword === 'interface') kind = 'interface';
  return [name, { kind, fields: parseFieldDefinitions(cursor, kind !== 'input') }];
}

const TYPE_READERS = new Map<string, (cursor: Cursor, keyword: string) => [string, SchemaType]>([['scalar', readScalar], ['enum', readEnum], ['union', readUnion], ['type', readObjectLike], ['interface', readObjectLike], ['input', readObjectLike]]);

/** The types of an SDL source: Map(name -> { kind, fields? , values? , members? }), plus the root operation type names. */
export function parseSchema(source: string): ParsedSchema {
  const cursor = cursorOf(tokenize(source));
  const types = new Map<string, SchemaType>();
  const roots: SchemaRoots = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' };
  while (!cursor.done()) {
    skipDescription(cursor);
    const keyword = cursor.name();
    const readType = TYPE_READERS.get(keyword);
    if (keyword === 'schema' || (keyword === 'extend' && cursor.is('schema'))) readSchemaDefinition(cursor, keyword, roots);
    else if (keyword === 'directive') skipDirectiveDefinition(cursor);
    else if (readType) {
      const [name, definition] = readType(cursor, keyword);
      types.set(name, definition);
    } else throw new SyntaxError(`unexpected "${keyword}" in a schema`);
  }
  return { types, roots };
}

function parseArgumentList(cursor: Cursor): void {
  while (!cursor.take(')')) {
    skipDescription(cursor);
    cursor.name();
    cursor.expect(':');
    parseTypeRef(cursor);
    if (cursor.take('=')) skipValue(cursor);
    skipDirectives(cursor);
  }
}
