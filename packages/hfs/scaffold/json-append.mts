// Byte-preserving addition of one item to a JSON array an app owns (hfs.json): every other byte of the text (key order, inline or broken
// arrays, indentation, line endings) is kept, and the result is accepted only when it parses to the original with the item appended.
import { isDeepStrictEqual } from 'node:util';
import { ScaffoldError } from './service.mjs';

/** Where one JSON value sits in its text. */
interface Span { readonly start: number; readonly end: number }

/** One parsed JSON value with its place, and for an object or array the places of its members. */
type Node =
  | { readonly kind: 'object'; readonly span: Span; readonly members: ReadonlyArray<{ readonly key: string; readonly keyStart: number; readonly value: Node }> }
  | { readonly kind: 'array'; readonly span: Span; readonly items: readonly Node[] }
  | { readonly kind: 'scalar'; readonly span: Span };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A positional reader of a text JSON.parse already accepted. */
function parseSpans(text: string): Node {
  let at = 0;
  const skip = (): void => { while (at < text.length && /\s/.test(text.charAt(at))) at += 1; };
  const string = (): string => {
    const start = at;
    at += 1;
    while (text.charAt(at) !== '"') at += text.charAt(at) === '\\' ? 2 : 1;
    at += 1;
    return JSON.parse(text.slice(start, at)) as string;
  };
  const value = (): Node => {
    skip();
    const start = at;
    const head = text.charAt(at);
    if (head === '{') {
      at += 1;
      const members: Array<{ key: string; keyStart: number; value: Node }> = [];
      skip();
      while (text.charAt(at) !== '}') {
        skip();
        const keyStart = at;
        const key = string();
        skip();
        at += 1;
        members.push({ key, keyStart, value: value() });
        skip();
        if (text.charAt(at) === ',') at += 1;
        skip();
      }
      at += 1;
      return { kind: 'object', span: { start, end: at }, members };
    }
    if (head === '[') {
      at += 1;
      const items: Node[] = [];
      skip();
      while (text.charAt(at) !== ']') {
        items.push(value());
        skip();
        if (text.charAt(at) === ',') at += 1;
        skip();
      }
      at += 1;
      return { kind: 'array', span: { start, end: at }, items };
    }
    if (head === '"') { string(); return { kind: 'scalar', span: { start, end: at } }; }
    while (at < text.length && !/[\s,\]}]/.test(text.charAt(at))) at += 1;
    return { kind: 'scalar', span: { start, end: at } };
  };
  return value();
}

/** The whitespace that opens the line `offset` sits on, when only whitespace precedes it there. */
function indentAt(text: string, offset: number): string | undefined {
  const lead = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  return /^[ \t]*$/.test(lead) ? lead : undefined;
}

const memberOf = (node: Node, key: string): Node | undefined => (node.kind === 'object' ? node.members.find((member) => member.key === key)?.value : undefined);

/** `value` printed on one line the way an inline object of an app file is written: `{ "a": 1, "b": "x" }`. */
const inline = (value: unknown): string => (isRecord(value) ? `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${JSON.stringify(entry)}`).join(', ')} }` : JSON.stringify(value));

/**
 * The text with `item` appended to the array at `path` (created as the last member of its parent object when absent). A broken array gets
 * the item broken like its last item (same indentation step), an inline array one inline item. Refused (HFS_ADD_JSON_EDIT) when the parent
 * is no object or the edit would change more than that list.
 */
export function appendToArray(text: string, path: readonly string[], item: unknown): string {
  const parsed: unknown = JSON.parse(text);
  const parentPath = path.slice(0, -1);
  const leaf = path.at(-1);
  if (leaf === undefined) throw new ScaffoldError('HFS_ADD_JSON_EDIT', 'an empty JSON path names no array');
  let holder: unknown = parsed;
  for (const key of parentPath) holder = isRecord(holder) ? holder[key] : undefined;
  if (!isRecord(holder)) throw new ScaffoldError('HFS_ADD_JSON_EDIT', `${parentPath.join('.')} is no object`);
  const current = holder[leaf];
  if (current !== undefined && !Array.isArray(current)) throw new ScaffoldError('HFS_ADD_JSON_EDIT', `${path.join('.')} is no list`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const parent = parentPath.reduce<Node | undefined>((node, key) => (node === undefined ? undefined : memberOf(node, key)), parseSpans(text));
  if (parent === undefined || parent.kind !== 'object') throw new ScaffoldError('HFS_ADD_JSON_EDIT', `${parentPath.join('.')} is no object`);
  const array = memberOf(parent, leaf);
  let edited: string;
  if (array?.kind === 'array') {
    const last = array.items.at(-1);
    if (last === undefined || !text.slice(array.span.start, array.span.end).includes('\n')) {
      const items = [...array.items.map((entry) => text.slice(entry.span.start, entry.span.end)), inline(item)];
      edited = `${text.slice(0, array.span.start)}[${items.join(', ')}]${text.slice(array.span.end)}`;
    } else {
      const itemIndent = indentAt(text, last.span.start) ?? '';
      const keyIndent = indentAt(text, parent.members.find((member) => member.value === array)!.keyStart) ?? '';
      const step = itemIndent.length > keyIndent.length ? itemIndent.slice(keyIndent.length) : '  ';
      const printed = JSON.stringify(item, null, step).split('\n').join(`${eol}${itemIndent}`);
      edited = `${text.slice(0, last.span.end)},${eol}${itemIndent}${printed}${text.slice(last.span.end)}`;
    }
  } else {
    const last = parent.members.at(-1);
    const keyIndent = last === undefined ? '' : (indentAt(text, last.keyStart) ?? '');
    if (last === undefined) {
      edited = `${text.slice(0, parent.span.start)}{ ${JSON.stringify(leaf)}: [${inline(item)}] }${text.slice(parent.span.end)}`;
    } else if (indentAt(text, last.keyStart) === undefined) {
      edited = `${text.slice(0, last.value.span.end)}, ${JSON.stringify(leaf)}: [${inline(item)}]${text.slice(last.value.span.end)}`;
    } else {
      const step = keyIndent.startsWith('\t') ? '\t' : '  ';
      const printed = JSON.stringify(item, null, step).split('\n').join(`${eol}${keyIndent}${step}`);
      edited = `${text.slice(0, last.value.span.end)},${eol}${keyIndent}${JSON.stringify(leaf)}: [${eol}${keyIndent}${step}${printed}${eol}${keyIndent}]${text.slice(last.value.span.end)}`;
    }
  }
  const expected = structuredClone(parsed);
  let target: unknown = expected;
  for (const key of parentPath) target = isRecord(target) ? target[key] : undefined;
  if (isRecord(target)) target[leaf] = [...(Array.isArray(current) ? current : []), item];
  if (!isDeepStrictEqual(JSON.parse(edited), expected)) throw new ScaffoldError('HFS_ADD_JSON_EDIT', `adding to ${path.join('.')} would change more than that list`);
  return edited;
}
