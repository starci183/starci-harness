// js-lex.mjs - reads a JavaScript, TypeScript or stylesheet source as three layers: its code, its comments and its string contents.
// A scanner that looks for a spelling in text (a bypass marker, a command in a string) needs to know which layer the spelling is in: a marker
// quoted inside a string or a template literal is data, a marker at the start of a comment is a directive, a marker in code is a call.
// One pass, no dependency, no AST: strings (single, double, template with nested `${}`), line and block comments and regular expression
// literals are told apart by the previous significant character; a `)` that closes an `if`, `while`, `for` or `with` head is followed by a
// statement, so a `/` after it opens a regular expression. A line ends at \n, \r, U+2028 and U+2029, as in JavaScript. A quote with no closing
// quote on its line is not a string (an apostrophe in JSX text or prose), so it cannot swallow a comment behind it.
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'delete', 'void', 'throw', 'in', 'of', 'else', 'yield', 'await']);
const HEAD_KEYWORDS = new Set(['if', 'while', 'for', 'with']);
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);
const LINE_BREAKS = new Set(['\n', '\r', LINE_SEPARATOR, PARAGRAPH_SEPARATOR]);
const LINE_SPLIT = new RegExp(String.raw`\r\n|[\n\r${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`);
const isBreak = (char) => LINE_BREAKS.has(char);

/** What `kind` of source this is: `css` has block comments only, `scss` and `less` add line comments, anything else is script. */
export const langOf = (file) => {
  if (file.endsWith('.css')) return 'css';
  if (/\.(?:scss|less)$/.test(file)) return 'scss';
  return 'script';
};

const NOT_A_BREAK = new RegExp(String.raw`[^\n\r${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g');
const blank = (text) => text.replace(NOT_A_BREAK, ' ');

/** The index right after the last non-blank character before `end` (a scan back over blanks only, so a long source stays linear). */
function contentEnd(code, end) {
  let stop = end;
  while (stop > 0 && /\s/.test(code[stop - 1])) stop -= 1;
  return stop;
}

/** The word that ends at `end` of `code` (letters, digits, `$`, `_`). */
function wordBefore(code, end) {
  let start = end;
  while (start > 0 && /[\w$]/.test(code[start - 1])) start -= 1;
  return code.slice(start, end);
}

class Reader {
  constructor(text, lang) {
    this.text = text;
    this.lang = lang;
    this.at = 0;
    this.line = 1;
    this.code = '';
    this.comments = [];
    this.strings = [];
    this.lastSignificant = '';
    this.heads = [];
    this.headClosed = false;
  }

  /** Consumes `count` characters as non-code (blanked in `code`). */
  skip(count) {
    const piece = this.text.slice(this.at, this.at + count);
    this.code += blank(piece);
    this.advanceLines(piece);
    this.at += count;
  }

  advanceLines(piece) {
    for (let index = 0; index < piece.length; index += 1) {
      if (piece[index] === '\r' && piece[index + 1] === '\n') continue;
      if (isBreak(piece[index])) this.line += 1;
    }
  }

  /** Consumes one code character. */
  take() {
    const char = this.text[this.at];
    this.code += char;
    if (isBreak(char)) { if (!(char === '\r' && this.text[this.at + 1] === '\n')) this.line += 1; } else if (!/\s/.test(char)) this.trackParens(char);
    this.at += 1;
  }

  /** Remembers which parenthesis closes the head of an if, while, for or with: a statement, and so possibly a regular expression, follows it. */
  trackParens(char) {
    this.headClosed = false;
    if (char === '(') this.heads.push(HEAD_KEYWORDS.has(wordBefore(this.code, contentEnd(this.code, this.code.length - 1))));
    else if (char === ')') this.headClosed = this.heads.pop() === true;
    this.lastSignificant = char;
  }

  regexAllowed() {
    if (this.lastSignificant === ')') return this.headClosed;
    if (!REGEX_AFTER.has(this.lastSignificant)) return REGEX_KEYWORDS.has(wordBefore(this.code, contentEnd(this.code, this.code.length)));
    return true;
  }

  lineEnd(from) {
    let end = from;
    while (end < this.text.length && !isBreak(this.text[end])) end += 1;
    return end;
  }

  lineComment() {
    const stop = this.lineEnd(this.at);
    this.comments.push({ line: this.line, text: this.text.slice(this.at + 2, stop), first: true, last: true, block: false });
    this.skip(stop - this.at);
  }

  blockComment() {
    const close = this.text.indexOf('*/', this.at + 2);
    const stop = close < 0 ? this.text.length : close + 2;
    const body = this.text.slice(this.at + 2, close < 0 ? stop : close);
    const pieces = body.split(LINE_SPLIT);
    pieces.forEach((piece, index) => this.comments.push({ line: this.line + index, text: piece, first: index === 0, last: index === pieces.length - 1, block: true }));
    this.skip(stop - this.at);
  }

  quoted(quote) {
    let end = this.at + 1;
    while (end < this.text.length && this.text[end] !== quote && !isBreak(this.text[end])) end += this.text[end] === '\\' ? 2 : 1;
    if (this.text[end] !== quote) { this.take(); return; }
    this.strings.push({ line: this.line, at: this.at + 1, text: this.text.slice(this.at + 1, end) });
    this.skip(end + 1 - this.at);
    this.lastSignificant = quote;
  }

  regex() {
    let end = this.at + 1;
    let inClass = false;
    while (end < this.text.length && !isBreak(this.text[end])) {
      const char = this.text[end];
      if (char === '\\') end += 1;
      else if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) break;
      end += 1;
    }
    if (this.text[end] !== '/') { this.take(); return; }
    end += 1;
    while (/[a-z]/i.test(this.text[end] ?? '')) end += 1;
    this.skip(end - this.at);
    this.lastSignificant = '/';
  }

  /** A template literal: the text pieces are strings, each `${ ... }` is code again. */
  template() {
    this.skip(1);
    let piece = '';
    let from = this.at;
    const flush = () => { this.strings.push({ line: this.line, at: from, text: piece }); piece = ''; };
    while (this.at < this.text.length && this.text[this.at] !== '`') {
      if (this.text[this.at] === '\\') { piece += this.text.slice(this.at, this.at + 2); this.skip(2); continue; }
      if (this.text[this.at] === '$' && this.text[this.at + 1] === '{') {
        flush();
        this.skip(2);
        this.expression();
        from = this.at;
        continue;
      }
      piece += this.text[this.at];
      this.skip(1);
    }
    flush();
    if (this.text[this.at] === '`') this.skip(1);
    this.lastSignificant = '`';
  }

  /** Code up to the `}` that closes the current `${`. */
  expression() {
    let depth = 0;
    while (this.at < this.text.length) {
      const char = this.text[this.at];
      if (char === '}' && depth === 0) { this.skip(1); return; }
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      this.step();
    }
  }

  step() {
    const char = this.text[this.at];
    const next = this.text[this.at + 1];
    if (char === '/' && next === '*') this.blockComment();
    else if (char === '/' && next === '/' && this.lang !== 'css') this.lineComment();
    else if (char === '"' || char === "'") this.quoted(char);
    else if (char === '`' && this.lang === 'script') this.template();
    else if (char === '/' && this.lang === 'script' && this.regexAllowed()) this.regex();
    else this.take();
  }

  run() {
    while (this.at < this.text.length) this.step();
    return { code: this.code, comments: this.comments, strings: this.strings };
  }
}

/**
 * `text` as { code, comments, strings }. `code` is the source with every comment, string and regular expression blanked (same length, same
 * lines); `comments` are { line, text, first, last } per physical line of each comment (the text without its opener; `first` and `last`
 * mark the ends of a block comment); `strings` are { line, at, text } per string or template piece, the content without its quotes and its offset.
 */
export const lexSource = (text, lang = 'script') => new Reader(String(text ?? ''), lang).run();

/** `text` as its physical lines (a line ends at \n, \r\n, \r, U+2028 and U+2029). */
export const splitLines = (text) => String(text ?? '').split(LINE_SPLIT);
