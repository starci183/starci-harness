// Comment-preserving additions to a block-style YAML file an app owns (its stack declaration, its Swarm model). The caller
// applies every addition to the parsed document as well and accepts the edited text only when it parses to that document, so
// a shape this editor does not understand refuses instead of writing a wrong file.
import { isDeepStrictEqual } from 'node:util';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { ScaffoldError } from './service.mjs';

// reason: the parsed YAML document of an application file (stack declaration, Swarm model) as parseYaml returns it; its shape is
// the repository's, the callers walk and edit it in place and YamlBlockEdit accepts the result only when the edited text parses back to it.
export type YamlDocument = any;

/** The span of a value's lines and the indent of its children (null while it has none). */
interface Body {
  readonly from: number;
  readonly to: number;
  readonly childIndent: number | null;
}

/** A step of a path: a mapping key, or the sequence item whose `item` key is `is`. */
export type YamlStep = string | { readonly item: string; readonly is: string };

/** Where a path lands: the opening line, the indent of its keys, the item line it sits in, and its body. */
interface Located {
  readonly line: number;
  readonly indent: number;
  readonly itemLine: number;
  readonly body: Body;
}

const significant = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');
const indentOf = (line: string) => line.length - line.trimStart().length;
const isItem = (line: string) => /^\s*-(?:\s|$)/.test(line);

/** The key's own indent: a `- key:` item line carries its first key two columns after the dash. */
const keyIndentOf = (line: string) => (isItem(line) ? indentOf(line) + 2 : indentOf(line));

/** The body of the value that starts after line `at` (a key line, or an item line for an item's body): its lines and their indent. */
function bodyOf(lines: readonly string[], at: number, ownIndent: number): Body {
  let last = at;
  let childIndent: number | null = null;
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!significant(line)) continue;
    const indent = indentOf(line);
    const indentless = indent === ownIndent && isItem(line) && (childIndent === null || childIndent === ownIndent);
    if (indent <= ownIndent && !indentless) break;
    childIndent ??= indent;
    last = index;
  }
  return { from: at + 1, to: last + 1, childIndent };
}

/** The line of `key` among the direct children (indent `indent`) of lines [from, to); `itemLine` may hold the first key of an item. */
function keyLine(lines: readonly string[], { from, to }: { from: number, to: number }, indent: number | null, key: string, itemLine = -1): number {
  const pattern = new RegExp(`^\\s*(?:- )?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(?:\\s|$)`);
  for (let index = itemLine >= 0 ? itemLine : from; index < to; index += 1) {
    const line = lines[index]!;
    if (!significant(line) || keyIndentOf(line) !== indent || (isItem(line) && index !== itemLine)) continue;
    if (pattern.test(line)) return index;
  }
  return -1;
}

/**
 * Resolves `path` to the value it names: a string steps into a mapping key, `{ item: key, is: value }` into the sequence item whose
 * `key` is `value`. Returns the line that opens the value (the key or item line), the indent of its keys and its body.
 */
function locate(lines: readonly string[], path: readonly YamlStep[], file: string): Located {
  let at: Located = { line: -1, indent: -1, itemLine: -1, body: { from: 0, to: lines.length, childIndent: 0 } };
  for (const step of path) {
    const { body } = at;
    if (typeof step === 'string') {
      const indent = at.itemLine >= 0 ? at.indent : body.childIndent;
      const line = keyLine(lines, body, indent, step, at.itemLine);
      if (line < 0) throw new ScaffoldError('HFS_ADD_STACK_SHAPE', `${file} has no ${path.map(describe).join('.')}; add the declared Redis by hand`);
      at = { line, indent: keyIndentOf(lines[line]!), itemLine: -1, body: bodyOf(lines, line, keyIndentOf(lines[line]!)) };
      continue;
    }
    const items: number[] = [];
    for (let index = body.from; index < body.to; index += 1) if (significant(lines[index]!) && isItem(lines[index]!) && indentOf(lines[index]!) === body.childIndent) items.push(index);
    const match = items.find((line, position) => {
      const end = items[position + 1] ?? body.to;
      return keyLine(lines, { from: line, to: end }, (body.childIndent ?? 0) + 2, step.item, line) >= 0
        && new RegExp(`^\\s*(?:- )?${step.item}:\\s*${step.is}\\s*$`).test(lines[keyLine(lines, { from: line, to: end }, (body.childIndent ?? 0) + 2, step.item, line)]!);
    });
    if (match === undefined) throw new ScaffoldError('HFS_ADD_STACK_SHAPE', `${file} has no ${path.map(describe).join('.')}; add the declared Redis by hand`);
    const itemBody = bodyOf(lines, match, body.childIndent ?? 0);
    at = { line: match, indent: (body.childIndent ?? 0) + 2, itemLine: match, body: { ...itemBody, from: match, childIndent: (body.childIndent ?? 0) + 2 } };
  }
  return at;
}

const describe = (step: YamlStep) => (typeof step === 'string' ? step : `[${step.item}=${step.is}]`);

/** The lines of `block` (written at indent 0) moved to `indent`. */
const indented = (block: string, indent: number) => block.replace(/\n$/, '').split('\n').map((line) => (line ? ' '.repeat(indent) + line : line));

/** A YAML text that adds entries under one mapping or items to one block sequence, and applies the same change to its document. */
export class YamlBlockEdit {
  readonly file: string;
  readonly newline: string;
  readonly lines: string[];
  readonly document: YamlDocument;
  readonly expected: YamlDocument;

  constructor(text: string, file: string) {
    this.file = file;
    this.newline = text.includes('\r\n') ? '\r\n' : '\n';
    this.lines = text.replace(/\r\n/g, '\n').split('\n');
    this.document = parseYaml(text);
    this.expected = structuredClone(this.document);
  }

  /** The parsed document as the edits leave it; mutate it in step with each text edit. */
  get value(): YamlDocument { return this.expected; }

  /** Appends `block` (YAML lines at indent 0) as the last children of the mapping or sequence at `path`. */
  append(path: readonly YamlStep[], block: string): this {
    const at = locate(this.lines, path, this.file);
    const { body } = at;
    const indent = body.to > body.from && body.childIndent !== null ? body.childIndent : at.indent + 2;
    this.lines.splice(body.to, 0, ...indented(block, indent));
    return this;
  }

  /** Adds `value` to the flow sequence (`key: [a, b]`) at `path`. */
  extendFlow(path: readonly YamlStep[], value: string): this {
    const at = locate(this.lines, path, this.file);
    const line = this.lines[at.line]!;
    const flow = /^(.*:\s*\[)(.*)\](\s*)$/.exec(line);
    if (!flow) throw new ScaffoldError('HFS_ADD_STACK_SHAPE', `${this.file} writes ${path.map(describe).join('.')} as no one-line flow sequence; add the declared Redis by hand`);
    const items = flow[2]!.trim();
    this.lines[at.line] = `${flow[1]}${items ? `${items}, ` : ''}${value}]${flow[3]}`;
    return this;
  }

  /** The edited text, or a refusal when it does not parse to the expected document. */
  text(): string {
    const text = this.lines.join(this.newline);
    let parsed: YamlDocument;
    try { parsed = parseYaml(text); } catch { parsed = undefined; }
    if (!isDeepStrictEqual(parsed, this.expected)) throw new ScaffoldError('HFS_ADD_STACK_SHAPE', `${this.file} is not in a shape the declared Redis can be added to; add it by hand`);
    return text;
  }
}
