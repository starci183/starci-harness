// R311: the Vietnamese copy of an app reaches users as written. A message catalog (`<owner>.messages.ts` or a `vi.json` locale file)
// is valid UTF-8, and no `vi` string carries the mark of a lossy re-encode: a diacritic letter replaced by a literal `?`
// (so a word reads as letters around a question mark) or by the U+FFFD replacement character.
import { found, readText } from './read.mjs';

export const HFS_TEXT_CORRUPT = 'HFS_TEXT_CORRUPT';
const CATALOG_TS_SUFFIX = '.messages.ts';
const CATALOG_JSON = /(?:^|\/)vi\.json$/;
const OUTSIDE = /(?:^|\/)(?:node_modules|\.git|dist|build)\//;
const REPLACEMENT = '\uFFFD';
// A `?` between letters, doubled, or closing a word before punctuation is a lost diacritic; a sentence-final "?" and a lone "?" are not.
const LOST_LETTER = /\p{L}\?(?=[\p{L}?])|\?\?|\p{L}\?(?=[.,;:)])|(?:^|[\s("])\?\p{L}/u;
const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// The text of the `vi:` map of a catalog bundle: from `vi:` to the first closing brace at the bundle's own indent.
function viBlocks(text) {
  const blocks = [];
  for (const start of text.matchAll(/\bvi:\s*\{/g)) {
    const from = start.index + start[0].length;
    const end = text.indexOf('\n    }', from);
    blocks.push({ from, to: end < 0 ? text.length : end });
  }
  return blocks;
}

function jsonStrings(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const value of Object.values(node)) jsonStrings(value, out);
}

function corruptLine(file, line, value) {
  return found(HFS_TEXT_CORRUPT, file, `${file}:${line} Vietnamese text ${JSON.stringify(value)} lost its diacritics (a "?" or U+FFFD stands for a letter); rewrite the file as UTF-8 with an editor or Node, never a shell pipe`, { line });
}

function tsFindings(file, text) {
  const findings = [];
  for (const { from, to } of viBlocks(text)) {
    for (const literal of text.slice(from, to).matchAll(STRING_LITERAL)) {
      if (LOST_LETTER.test(literal[1])) findings.push(corruptLine(file, lineOf(text, from + literal.index), literal[1]));
    }
  }
  return findings;
}

function jsonFindings(file, text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  const strings = [];
  jsonStrings(doc, strings);
  return strings.filter((value) => LOST_LETTER.test(value)).map((value) => corruptLine(file, lineOf(text, text.indexOf(value)), value));
}

/** Corrupted Vietnamese copy in the message catalogs of this root/side scope. */
export function textIntegrityFindings({ repoRoot, files, repo, inScope = () => true }) {
  if (repo.kind === 'runtime' || !['lite', 'full'].includes(repo.edition ?? 'full')) return [];
  const findings = [];
  for (const file of files) {
    const ts = file.endsWith(CATALOG_TS_SUFFIX);
    if (!inScope(file) || OUTSIDE.test(file) || !(ts || CATALOG_JSON.test(file))) continue;
    const text = readText(repoRoot, file);
    if (text === null) continue;
    if (text.includes(REPLACEMENT)) {
      findings.push(found(HFS_TEXT_CORRUPT, file, `${file}:${lineOf(text, text.indexOf(REPLACEMENT))} is not valid UTF-8 (it holds U+FFFD); rewrite the file as UTF-8 with an editor or Node`, { line: lineOf(text, text.indexOf(REPLACEMENT)) }));
      continue;
    }
    findings.push(...(ts ? tsFindings(file, text) : jsonFindings(file, text)));
  }
  return findings;
}
