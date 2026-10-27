// css-rules.mjs - a flat reading of a stylesheet: every style rule with its resolved selector, its `@apply` utilities and its
// declarations, nesting (`&`) and wrapping at-rules (@layer, @media, @supports) resolved. Pure: text in, rules out.
// The reader of the vendor CSS (scripts/work/ui/vendor-heroui.mjs) and of Grammar's own CSS (scripts/lib/grammar-vendor-parity.mjs).

import { byCodeUnit } from './list.mjs';

const SKIPPED_AT_RULES = new Set(['keyframes', 'property', 'font-face', 'counter-style', 'page', 'theme', 'utility', 'custom-variant', 'variant', 'source', 'plugin', 'config']);

/** The text without `/* ... *\/` comments. */
export const stripCssComments = (text) => String(text).replaceAll(/\/\*[\s\S]*?\*\//g, '');

/** Split `text` at top-level `separator` characters (outside parentheses, brackets and quotes). */
export function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The matching `}` of the `{` at `open`, or the text length. */
function blockEnd(text, open) {
  let depth = 0;
  let quote = '';
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

/** One block body as its declarations (statements) and its child blocks (prelude + body). */
function members(body) {
  const statements = [];
  const blocks = [];
  let cursor = 0;
  let statementStart = 0;
  while (cursor < body.length) {
    const char = body[cursor];
    if (char === ';') {
      statements.push(body.slice(statementStart, cursor).trim());
      statementStart = cursor + 1;
    } else if (char === '{') {
      const end = blockEnd(body, cursor);
      blocks.push({ prelude: body.slice(statementStart, cursor).trim(), body: body.slice(cursor + 1, end) });
      cursor = end;
      statementStart = end + 1;
    } else if (char === '"' || char === "'") {
      let next = cursor + 1;
      while (next < body.length && body[next] !== char) next += body[next] === '\\' ? 2 : 1;
      cursor = next;
    }
    cursor += 1;
  }
  const tail = body.slice(statementStart).trim();
  if (tail) statements.push(tail);
  return { statements: statements.filter(Boolean), blocks };
}

/** Resolve a nested selector list against its parent selector list (`&` is the parent; no `&` means a descendant). */
function resolveSelectors(parents, prelude) {
  const own = splitTopLevel(prelude, ',');
  if (!parents.length) return own;
  return parents.flatMap((parent) => own.map((selector) => (selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`)));
}

function ruleFromStatements(selectors, wraps, statements) {
  const apply = [];
  const declarations = [];
  for (const statement of statements) {
    if (statement.startsWith('@apply ')) apply.push(...statement.slice(7).split(/\s+/).filter(Boolean));
    else {
      const colon = statement.indexOf(':');
      if (colon > 0 && !statement.startsWith('@')) declarations.push({ property: statement.slice(0, colon).trim(), value: statement.slice(colon + 1).trim().replaceAll(/\s+/g, ' ') });
    }
  }
  return { selectors, wraps, apply, declarations };
}

function collect(body, parents, wraps, out) {
  const { statements, blocks } = members(body);
  if (parents.length && (statements.length > 0)) out.push(ruleFromStatements(parents, wraps, statements));
  for (const block of blocks) {
    if (block.prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(block.prelude)?.[1] ?? '';
      if (SKIPPED_AT_RULES.has(name)) continue;
      collect(block.body, parents, [...wraps, block.prelude.replaceAll(/\s+/g, ' ')], out);
    } else collect(block.body, resolveSelectors(parents, block.prelude), wraps, out);
  }
}

/**
 * Every style rule of `text`: `{selectors, wraps, apply, declarations}`. `selectors` are fully resolved, `wraps` the at-rule preludes
 * (`@media (forced-colors: active)`, `@layer x`) the rule sits in, `apply` the `@apply` utilities and `declarations` the plain properties.
 */
export function cssRules(text) {
  const out = [];
  collect(stripCssComments(text), [], [], out);
  return out;
}

/** The subject compound of a selector: the part after the last combinator, outside brackets and parentheses. */
export function subjectCompound(selector) {
  let depth = 0;
  let cut = 0;
  for (const [index, char] of [...selector].entries()) {
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) cut = index + 1;
  }
  return selector.slice(cut).trim();
}

/** The selector split into the text outside `[...]` and the bodies inside them. */
function bracketParts(selector) {
  const outside = [];
  const bodies = [];
  let open = -1;
  for (const [index, char] of [...selector].entries()) {
    if (char === '[' && open < 0) open = index;
    else if (char === ']' && open >= 0) {
      bodies.push(selector.slice(open + 1, index));
      open = -1;
    } else if (open < 0) outside.push(char);
  }
  return { outside: outside.join(''), bodies };
}

/** The `.class` names a selector mentions, outside attribute brackets. */
export function selectorClasses(selector) {
  return [...bracketParts(selector).outside.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
}

/** The `[data-...]` attribute names a selector mentions. */
export function selectorAttributes(selector) {
  return bracketParts(selector).bodies.map((raw) => {
    const body = raw.trim();
    const equals = body.indexOf('=');
    const name = (equals < 0 ? body : body.slice(0, equals)).replace(/[~|^$*]$/, '').trim();
    const value = equals < 0 ? null : body.slice(equals + 1).trim().replaceAll(/^["']|["']$/g, '');
    return { name, value };
  });
}

const FAMILY_BY_PROPERTY = [
  [/^padding/, 'padding'],
  [/^margin/, 'margin'],
  [/^border-(?:top-|bottom-|start-|end-)*(?:start-|end-)*radius$|^border-radius$/, 'radius'],
  [/^background/, 'background'],
  [/^color$/, 'color'],
  [/^(?:border|outline)/, 'border'],
  [/^box-shadow$/, 'shadow'],
  [/^(?:min-|max-)?(?:block-size|height)$/, 'block-size'],
  [/^(?:min-|max-)?(?:inline-size|width)$/, 'inline-size'],
  [/^(?:font|line-height|letter-spacing|text-transform)/, 'font'],
  [/^(?:row-|column-)?gap$/, 'gap'],
  [/^opacity$/, 'opacity'],
];

/** The paint family a CSS property belongs to (`padding-inline` is `padding`), or the property itself. */
export function propertyFamily(property) {
  const name = String(property).trim().toLowerCase();
  if (name.startsWith('--')) return null;
  return FAMILY_BY_PROPERTY.find(([pattern]) => pattern.test(name))?.[1] ?? name;
}

const TEXT_SIZES = /^(?:xs|sm|base|lg|xl|[2-9]xl|\[.*\])$/;
const TEXT_FLOW = /^(?:left|center|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
const UTILITY_FAMILIES = [
  [/^(?:p|px|py|ps|pe|pt|pb|pl|pr)-/, ['padding']],
  [/^-?(?:m|mx|my|ms|me|mt|mb|ml|mr)-/, ['margin']],
  [/^rounded/, ['radius']],
  [/^bg-/, ['background']],
  [/^(?:min-h|max-h|h)-/, ['block-size']],
  [/^(?:min-w|max-w|w)-/, ['inline-size']],
  [/^size-/, ['block-size', 'inline-size']],
  [/^(?:gap|gap-x|gap-y)-/, ['gap']],
  [/^(?:border|ring|outline)(?:-|$)/, ['border']],
  [/^(?:shadow)(?:-|$)/, ['shadow']],
  [/^(?:font|leading|tracking)-/, ['font']],
  [/^opacity-/, ['opacity']],
];

/** The paint families one `@apply` utility sets (`ps-7` is `padding`, `text-muted` is `color`); an unrecognised utility sets none. */
export function utilityFamilies(utility) {
  const bare = String(utility).replace(/^(?:[^\s:]+:)+/, '').replace(/^!/, '').replace(/!$/, '');
  if (bare.startsWith('text-')) {
    const rest = bare.slice(5);
    if (TEXT_SIZES.test(rest)) return ['font'];
    return TEXT_FLOW.test(rest) ? [] : ['color'];
  }
  return UTILITY_FAMILIES.find(([pattern]) => pattern.test(bare))?.[1] ?? [];
}

/** The paint families a rule sets, from its `@apply` utilities and its declarations. */
export function ruleFamilies(rule) {
  return [...new Set([...rule.apply.flatMap(utilityFamilies), ...rule.declarations.map((entry) => propertyFamily(entry.property)).filter(Boolean)])].sort(byCodeUnit);
}

// Container composition is layout even when the vendor sets a default for it. Keep this separate from
// ruleFamilies: the vendor census records every declaration, while the strict judge measures paint.
const LAYOUT_FAMILIES = new Set([
  'gap', 'inline-size', 'display', 'order',
  'flex', 'flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-wrap',
  'align-content', 'align-items', 'align-self',
  'justify-content', 'justify-items', 'justify-self',
  'place-content', 'place-items', 'place-self',
  'grid', 'grid-template', 'grid-template-areas', 'grid-template-columns', 'grid-template-rows',
  'grid-auto-columns', 'grid-auto-flow', 'grid-auto-rows', 'grid-area',
  'grid-column', 'grid-column-start', 'grid-column-end', 'grid-row', 'grid-row-start', 'grid-row-end',
]);

/** The paint families a strict Grammar may only change through a declared vendor override. */
export function repaintFamilies(rule) {
  return ruleFamilies(rule).filter((family) => !LAYOUT_FAMILIES.has(family));
}
