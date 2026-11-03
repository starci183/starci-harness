// canon-layout.mts - the layout of the canon Prettier config (@starci/prettier-config) that the code and JSON `starci app sync` renders by
// itself are written in, so a managed file passes the app's `prettier --check` (HFS_FORMAT, the pre-commit hook) as rendered and formatting it
// never makes HFS_SYNC_DRIFT. A rendered file is laid out the way Prettier lays it out: a list on one line while the line fits the print width,
// else one item a line with a trailing comma. src/sync-prettier.spec.mts holds these numbers to the canon config and every managed file to
// `prettier --check`.

/** The print width of the canon config. */
export const CANON_PRINT_WIDTH = 120;
/** One indent level of code (`tabWidth` of the canon config). */
export const CANON_INDENT = '    ';
/** One indent level of JSON (the canon config's override for `*.json`). */
export const CANON_JSON_INDENT = '  ';

/** `open` + the items + `close` on one line when it fits or `breaks` is false, else one item a line, one level deeper, with a trailing comma. */
function fitted(open: string, items: readonly string[], close: string, flat: string, breaks: boolean): string {
  if (!breaks || flat.length <= CANON_PRINT_WIDTH) return flat;
  return [open, ...items.map((item) => `${CANON_INDENT}${item},`), close].join('\n');
}

/**
 * `head` + an array literal of the items + `tail`, the way Prettier prints it: `head[a, b]tail` on one line while it fits the print width,
 * else every item on its own line with a trailing comma.
 *
 * @param {object} list - The text before the array, its items and the text after it.
 * @returns {string} The lines, without a final newline.
 */
export const canonList = ({ head, items, tail = '' }: { head: string; items: readonly string[]; tail?: string }): string =>
  fitted(`${head}[`, items, `]${tail}`, `${head}[${items.join(', ')}]${tail}`, items.length > 0);

/**
 * A named import, the way Prettier prints it: `import { a, b } from "x"` on one line while it fits, else one name a line; an import of one
 * name is never broken.
 *
 * @param {object} declaration - The imported names, the module and whether it imports types only.
 * @returns {string} The lines, without a final newline.
 */
export const canonImport = ({ names, from, type = false }: { names: readonly string[]; from: string; type?: boolean }): string => {
  const head = `import ${type ? 'type ' : ''}{`;
  const tail = `} from ${JSON.stringify(from)}`;
  return fitted(head, names, tail, `${head} ${names.join(', ')} ${tail}`, names.length > 1);
};

const isContainer = (value: unknown): value is object => typeof value === 'object' && value !== null;
const isEmpty = (value: object): boolean => (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);

/** One JSON value at `indent`, after `prefix` (`"key": `) and before `suffix` (`,` or nothing), as the canon prints a `.json` file. */
function jsonValue(value: unknown, indent: string, prefix: string, suffix: string): string {
  if (!isContainer(value) || isEmpty(value)) return `${indent}${prefix}${JSON.stringify(value)}${suffix}`;
  const inner = `${indent}${CANON_JSON_INDENT}`;
  if (Array.isArray(value)) {
    // An array of scalars stays on one line while it fits; an array holding an object or a list breaks, since the object is kept open.
    const flat = `${indent}${prefix}[${value.map((item) => JSON.stringify(item)).join(', ')}]${suffix}`;
    if (value.every((item) => !isContainer(item) || isEmpty(item)) && flat.length <= CANON_PRINT_WIDTH) return flat;
    return [`${indent}${prefix}[`, ...value.map((item, index) => jsonValue(item, inner, '', index < value.length - 1 ? ',' : '')), `${indent}]${suffix}`].join('\n');
  }
  const entries = Object.entries(value);
  return [`${indent}${prefix}{`, ...entries.map(([key, item], index) => jsonValue(item, inner, `${JSON.stringify(key)}: `, index < entries.length - 1 ? ',' : '')), `${indent}}${suffix}`].join('\n');
}

/**
 * A JSON document as the canon prints a `.json` file (not a `package.json`, which Prettier prints the way `JSON.stringify` does): every
 * object open one key a line, an array of scalars on one line while it fits, and a final newline.
 *
 * @param {unknown} value - The document.
 * @returns {string} Its text.
 */
export const canonJson = (value: unknown): string => `${jsonValue(value, '', '', '')}\n`;
