// JSX and static role-expression readers shared by the Grammar vendor judge.

/** One attribute of an opening tag: its name (a spread is `...`), its raw expression text and where the value starts in the source. */
export interface JsxAttribute { name: string; raw: string; offset?: number }
/** One opening tag: the import alias, the compound part (`Root` for the bare alias), its attributes and its source offset. */
export interface JsxTag { alias: string; part: string; attrs: JsxAttribute[]; index: number }
/** A vendor tag with its 1-based line instead of its offset. */
export type HeroTag = Omit<JsxTag, 'index'> & { line: number };
/** What the vendor role index states about one role. */
export interface RoleDeclaration { componentRole?: boolean; contracts: string[]; publicApi?: string }
interface RenderCallback { raw: string; offset: number | undefined; owner: string | undefined }
interface ExpressionOperator { operator: string; index: number }

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** The index after the quoted string that starts at `start`. */
function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== quote) index += text[index] === '\\' ? 2 : 1;
  return index + 1;
}

/** The index after the template literal that starts at `start`, `${...}` substitutions included. */
function skipTemplate(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '`') {
    if (text[index] === '\\') index += 2;
    else if (text[index] === '$' && text[index + 1] === '{') index = skipBraces(text, index + 1);
    else index += 1;
  }
  return index + 1;
}

/** The index after the balanced `{...}` that starts at `start`. */
function skipBraces(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") index = skipQuoted(text, index);
    else if (char === '`') index = skipTemplate(text, index);
    else {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      index += 1;
      if (depth === 0 && char === '}') return index;
    }
  }
  return index;
}

/** The index after the value (a string, a template or a braced expression) that starts at `start`. */
function skipValue(text: string, start: number): number {
  const char = text[start];
  if (char === '"' || char === "'") return skipQuoted(text, start);
  if (char === '`') return skipTemplate(text, start);
  return char === '{' ? skipBraces(text, start) : start + 1;
}

/** Attributes of the opening tag whose name ended at `from`: `{name, raw}` (a spread is named `...`). */
function readAttributes(text: string, from: number): JsxAttribute[] {
  const attrs: JsxAttribute[] = [];
  let index = from;
  while (index < text.length) {
    while (/\s/.test(text[index] ?? '')) index += 1;
    if (text[index] === '>' || text.startsWith('/>', index)) break;
    if (text[index] === '{') {
      const end = skipBraces(text, index);
      attrs.push({ name: '...', raw: text.slice(index + 1, end - 1) });
      index = end;
      continue;
    }
    const name = /^[\w:-]+/.exec(text.slice(index, index + 80))?.[0];
    if (!name) break;
    index += name.length;
    if (text[index] !== '=') {
      attrs.push({ name, raw: 'true' });
      continue;
    }
    index += 1;
    const end = skipValue(text, index);
    const raw = text.slice(index, end);
    attrs.push({ name, raw: raw.startsWith('{') ? raw.slice(1, -1) : raw, offset: raw.startsWith('{') ? index + 1 : index });
    index = end;
  }
  return attrs;
}

/** The opening tags of the given import aliases: `{alias, part, attrs, line}` (`part` is `Root` for the bare alias). */
export function heroTags(text: string, aliases: Iterable<string>): HeroTag[] {
  const known = new Set(aliases);
  return jsxTags(text).filter((tag) => known.has(tag.alias)).map(({ index, ...tag }) => ({ ...tag, line: lineOf(text, index) }));
}

/** The string literals of an expression, without their quotes. */
export const stringLiterals = (raw: unknown): string[] => (String(raw).match(/"[^"\n]*"|'[^'\n]*'|`[^`$]*`/g) ?? []).map((literal) => literal.slice(1, -1));

/** The class tokens an element carries: the literals of its className, with a bare constant resolved one level in the file. */
export function classTokens(text: string, attrs: readonly JsxAttribute[]): string[] {
  const raw = attrs.find((attr) => attr.name === 'className')?.raw;
  if (raw === undefined) return [];
  const names = String(raw).match(/\b[A-Za-z_]\w*\b/g) ?? [];
  const resolved = names.flatMap((name) => {
    const declaration = new RegExp(String.raw`\bconst\s+${name}\s*=\s*([^\n]*(?:\n[^\n;]*)?)`).exec(text);
    return declaration ? stringLiterals(declaration[1]) : [];
  });
  return [...stringLiterals(raw), ...resolved].flatMap((value) => value.split(/\s+/)).filter(Boolean);
}

/** The vendor imports of a source: alias -> vendor component name. */
export function importAliases(text: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@heroui\/react["']/g)) {
    for (const entry of (match[1] as string).split(',').map((part) => part.trim()).filter(Boolean)) {
      const found = /^(?!type\s)(\w+)(?:\s+as\s+(\w+))?$/.exec(entry);
      if (found) aliases.set((found[2] ?? found[1]) as string, found[1] as string);
    }
  }
  return aliases;
}

/** Whether the cursor starts a JavaScript string or template. */
const isQuoted = (char: string | undefined): boolean => char === '"' || char === "'" || char === '`';

/** Skip strings and comments while looking for JSX rather than text that only resembles it. */
function skipJsTrivia(text: string, index: number): number | undefined {
  if (isQuoted(text[index])) return skipValue(text, index);
  if (text.startsWith('//', index)) {
    const end = text.indexOf('\n', index);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith('/*', index)) {
    const end = text.indexOf('*/', index + 2);
    return end < 0 ? text.length : end + 2;
  }
  return undefined;
}

/** The end of an opening tag, keeping greater-than signs inside attribute expressions intact. */
function jsxOpeningEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length && text[index] !== '>') {
    index = /["'{`]/.test(text.charAt(index)) ? skipValue(text, index) : index + 1;
  }
  return index;
}

/** Read one opening tag and the cursor after its attributes. */
function jsxOpening(text: string, index: number): { tag: JsxTag; end: number } | undefined {
  if (text[index] !== '<') return undefined;
  const opening = /^<([A-Za-z][\w.:-]*)(?=[\s/>])/.exec(text.slice(index));
  if (!opening) return undefined;
  const from = index + opening[0].length;
  const [alias, part = 'Root'] = (opening[1] as string).split('.') as [string, string?];
  return { tag: { alias, part, attrs: readAttributes(text, from), index }, end: jsxOpeningEnd(text, from) };
}

/** Opening JSX tags, excluding JavaScript strings and comments; attribute expressions remain intact. */
function jsxTags(text: string): JsxTag[] {
  const tags: JsxTag[] = [];
  let index = 0;
  while (index < text.length) {
    const skipped = skipJsTrivia(text, index);
    if (skipped !== undefined) {
      index = skipped;
      continue;
    }
    const opening = jsxOpening(text, index);
    if (!opening) {
      index += 1;
      continue;
    }
    tags.push(opening.tag);
    for (const attr of opening.tag.attrs.filter((candidate) => candidate.name !== '...')) {
      tags.push(...jsxTags(attr.raw).map((tag) => ({ ...tag, index: tag.index + (attr.offset as number) })));
    }
    index = opening.end + 1;
  }
  return tags;
}

/** Apply the delimiter at a cursor to an expression's nesting depth. */
const expressionDepth = (depth: number, char: string): number => {
  if ('({['.includes(char)) return depth + 1;
  return ')}]'.includes(char) ? depth - 1 : depth;
};

/** The top-level operator at this cursor, with nullish and logical operators kept whole. */
function expressionOperator(raw: string, index: number): string | undefined {
  const logical = /^(?:\?\?|\|\||&&)/.exec(raw.slice(index));
  if (logical) return logical[0];
  if (/\s/.test(raw[index - 1] ?? '') && /^(?:as|satisfies)\s/.test(raw.slice(index))) return 'type';
  return ['?', ':', ','].includes(raw.charAt(index)) ? raw.charAt(index) : undefined;
}

/** Top-level expression operators, excluding strings, nested expressions and nullish `??`. */
function expressionOperators(raw: string): ExpressionOperator[] {
  const operators: ExpressionOperator[] = [];
  let depth = 0;
  let index = 0;
  while (index < raw.length) {
    const char = raw.charAt(index);
    if (isQuoted(char)) {
      index = skipValue(raw, index);
      continue;
    }
    depth = expressionDepth(depth, char);
    const operator = depth === 0 ? expressionOperator(raw, index) : undefined;
    if (operator !== undefined) operators.push({ operator, index });
    index += operator !== undefined && ['??', '||', '&&'].includes(operator) ? 2 : 1;
  }
  return operators;
}

/** The first top-level expression terminator; constant initializers can continue a conditional on the next line. */
function expressionEnd(text: string, start: number, continuedConditional = false): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text.charAt(index);
    if (isQuoted(char)) {
      index = skipValue(text, index);
      continue;
    }
    depth = expressionDepth(depth, char);
    if (depth === 0 && char === ';') break;
    if (depth === 0 && char === '\n') {
      const continues = continuedConditional && /^\s*(?:\?(?!\.)|:|\|\||&&)/.test(text.slice(index + 1));
      if (!continues) break;
    }
    index += 1;
  }
  return index;
}

/** A local constant initializer, including balanced objects and multiline conditional branches. */
function constantExpression(text: string, identifier: string): string | undefined {
  const declaration = new RegExp(String.raw`\bconst\s+${identifier}(?:\s*:\s*[^=;\n]+)?\s*=`).exec(text);
  if (!declaration) return undefined;
  const start = declaration.index + declaration[0].length;
  return text.slice(start, expressionEnd(text, start, true)).trim();
}

/** The static entries of an object constant used as a role lookup table. */
function expressionEntries(raw: string): { key: string; value: string }[] {
  raw = raw.trim();
  const assertion = expressionOperators(raw).find((entry) => entry.operator === 'type');
  if (assertion) raw = raw.slice(0, assertion.index).trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return [];
  const body = raw.slice(1, -1);
  const separators = expressionOperators(body).filter((entry) => entry.operator === ',').map((entry) => entry.index);
  const entries: { key: string; value: string }[] = [];
  let start = 0;
  for (const end of [...separators, body.length]) {
    const entry = body.slice(start, end).trim();
    const colon = expressionOperators(entry).find((operator) => operator.operator === ':');
    if (colon) entries.push({ key: entry.slice(0, colon.index).trim().replace(/^['"]|['"]$/g, ''), value: entry.slice(colon.index + 1) });
    start = end + 1;
  }
  return entries;
}

/** Whether one balanced pair encloses the complete expression rather than only its first operand. */
function enclosesExpression(raw: string): boolean {
  if (!raw.startsWith('(') || !raw.endsWith(')')) return false;
  let depth = 0;
  let index = 0;
  while (index < raw.length) {
    const char = raw.charAt(index);
    if (isQuoted(char)) {
      index = skipValue(raw, index);
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) return index === raw.length - 1;
    index += 1;
  }
  return false;
}

/** Match a conditional's colon without confusing nested conditionals with its own branches. */
function conditionalColon(operators: readonly ExpressionOperator[], question: number): ExpressionOperator | undefined {
  let nested = 0;
  return operators.slice(question + 1).find((entry) => {
    if (entry.operator === '?') nested += 1;
    if (entry.operator !== ':') return false;
    if (nested > 0) {
      nested -= 1;
      return false;
    }
    return true;
  });
}

/** Resolve a role lookup through a local object constant, considering every possible computed key. */
function memberExpressionStrings(text: string, member: RegExpExecArray, seen: Set<string>): string[] {
  if (seen.has(member[1] as string)) return [];
  const initializer = constantExpression(text, member[1] as string);
  if (!initializer) return [];
  seen.add(member[1] as string);
  const literalKey = member[3] ?? (/^(['"])([^'"]+)\1$/.exec(member[2]?.trim() ?? '')?.[2]);
  return expressionEntries(initializer).filter((entry) => literalKey === undefined || entry.key === literalKey).flatMap((entry) => expressionStrings(text, entry.value, new Set(seen)));
}

/** Result literals of a JSX expression, including local constants; condition literals are not result values. */
function expressionStrings(text: string, raw: string, seen: Set<string> = new Set()): string[] {
  raw = raw.trim();
  if (enclosesExpression(raw)) return expressionStrings(text, raw.slice(1, -1), seen);
  if (/^(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)$/.test(raw)) return [raw.slice(1, -1)];
  const operators = expressionOperators(raw);
  const assertion = operators.find((entry) => entry.operator === 'type');
  if (assertion) return expressionStrings(text, raw.slice(0, assertion.index), seen);
  const question = operators.findIndex((entry) => entry.operator === '?');
  const colon = question >= 0 ? conditionalColon(operators, question) : undefined;
  if (colon) return [...expressionStrings(text, raw.slice((operators[question] as ExpressionOperator).index + 1, colon.index), new Set(seen)), ...expressionStrings(text, raw.slice(colon.index + 1), new Set(seen))];
  const logical = operators.find((entry) => ['??', '||', '&&'].includes(entry.operator));
  if (logical) return [...expressionStrings(text, raw.slice(0, logical.index), new Set(seen)), ...expressionStrings(text, raw.slice(logical.index + 2), new Set(seen))];
  const member = /^([A-Za-z_$][\w$]*)(?:\[([\s\S]+)\]|\.([A-Za-z_$][\w$]*))$/.exec(raw);
  if (member) return memberExpressionStrings(text, member, seen);
  const identifier = /^([A-Za-z_$][\w$]*)$/.exec(raw)?.[1];
  if (!identifier || seen.has(identifier)) return [];
  seen.add(identifier);
  const initializer = constantExpression(text, identifier);
  return initializer ? expressionStrings(text, initializer, seen) : [];
}

/** The first callback parameter, after optional parentheses and surrounding whitespace. */
function callbackParameter(source: string): string | undefined {
  const trimmed = source.trimStart();
  const parameter = trimmed.startsWith('(') ? trimmed.slice(1).trimStart() : trimmed;
  return /^([A-Za-z_$][\w$]*)/.exec(parameter)?.[1];
}

/** A render callback's source offset, resolving a named local callback when present. */
function callbackStart(text: string, callback: RenderCallback): number | undefined {
  if (!/^[\w$]+$/.test(callback.raw)) return callback.offset;
  const declaration = new RegExp(String.raw`\bconst\s+${callback.raw}\s*=`).exec(text);
  return declaration ? declaration.index + declaration[0].length : undefined;
}

/** The native root receiving the vendor's render props and the role contracts it therefore inherits. */
function vendorRenderRoot(text: string, callback: RenderCallback, declarations: Readonly<Record<string, RoleDeclaration>>): { index: number; roles: string[] }[] {
  const start = callbackStart(text, callback);
  if (start === undefined) return [];
  const parameter = callbackParameter(text.slice(start));
  if (!parameter) return [];
  const root = jsxTags(text.slice(start, expressionEnd(text, start)))[0];
  if (!root || !root.attrs.some((attr) => attr.name === '...' && attr.raw.trim() === `...${parameter}`)) return [];
  const roles = Object.entries(declarations).filter(([, entry]) => entry.contracts?.includes(`${callback.owner}.Root`)).map(([role]) => role);
  return [{ index: root.index + start, roles }];
}

/** The local render callbacks supplied to vendor roots keep the vendor's state, semantics and prop custody. */
function vendorRenderRoots(text: string, aliases: ReadonlyMap<string, string>, declarations: Readonly<Record<string, RoleDeclaration>>): { index: number; roles: string[] }[] {
  const callbacks = heroTags(text, [...aliases.keys()]).flatMap((tag) => tag.attrs.filter((attr) => attr.name === 'render').map((attr): RenderCallback => ({ raw: attr.raw.trim(), offset: attr.offset, owner: aliases.get(tag.alias) })));
  return callbacks.flatMap((callback) => vendorRenderRoot(text, callback, declarations));
}

/** The JSX roles a file writes by hand that the measured vendor references expose. */
export function roleFindings<F>({ file, text, allowed, vendorRoles, roleDeclarations, finding }: {
  file: string;
  text: string;
  allowed: (kind: string, target: string) => boolean;
  vendorRoles: ReadonlySet<string>;
  roleDeclarations: Readonly<Record<string, RoleDeclaration>>;
  finding: (rule: string, file: string, line: number, message: string) => F;
}): F[] {
  const vendorAliases = importAliases(text);
  const vendorRenders = vendorRenderRoots(text, vendorAliases, roleDeclarations);
  const vendorOwnsRole = (tag: JsxTag, role: string): boolean => {
    const owner = vendorAliases.get(tag.alias);
    const declaration = roleDeclarations[role];
    return owner !== undefined && (declaration?.contracts.includes(`${owner}.${tag.part}`) || (tag.part === 'Root' && declaration?.publicApi === owner));
  };
  const roles = jsxTags(text).flatMap((tag) => tag.attrs.filter((attr) => attr.name === 'role').flatMap((attr) => expressionStrings(text, attr.raw)).filter((role) => !vendorOwnsRole(tag, role) && !vendorRenders.some((root) => tag.index === root.index && root.roles.includes(role)))).filter((role) => vendorRoles.has(role));
  return [...new Set(roles)].filter((role) => !allowed('role', `${file}:${role}`)).map((role) => finding('role', file, 0, `hand-rolls role="${role}", which HeroUI has a component for: use it (override target role:${file}:${role})`));
}
