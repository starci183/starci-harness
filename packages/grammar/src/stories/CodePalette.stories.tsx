import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import * as G from '../common/index.js';
import { Markdown } from '../core/ext/markdown/react/index.js';
import type { CodeToken, MarkdownTree } from '../core/ext/markdown/types.js';
import '../core/ext/markdown/styles.css';

/**
 * THE CODE PALETTE (0.55.1, owner 2026-11-23: "Chốt, làm luôn"). Code has its own colours (`--grammar-code-*`, common/tones-code.css): keyword
 * purple, function blue, string green, number orange, type teal, comment grey italic, on a near-white or graphite ground; never the brand,
 * red only for a diff's removed row. TS, bash and a diff through the markdown ext's Shiki variables, the lesson CodeBlock and inline code,
 * each in the light and the dark theme. The tokens below are what Shiki's css-variables theme gives these lines, written out so the story
 * needs no highlighter.
 */
const meta: Meta = { title: 'Content/Code palette (0.55.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

type Kind = 'keyword' | 'function' | 'string' | 'constant' | 'comment' | 'punctuation' | 'parameter' | 'plain';
type Line = readonly (readonly [string, Kind])[];

const token = ([content, kind]: readonly [string, Kind]): CodeToken =>
  kind === 'plain' ? { content } : kind === 'comment' ? { content, color: 'var(--shiki-token-comment)', fontStyle: 'italic' } : { content, color: `var(--shiki-token-${kind})` };
const tokens = (lines: readonly Line[]): CodeToken[][] => lines.map((line) => line.map(token));
const text = (lines: readonly Line[]): string => lines.map((line) => line.map(([content]) => content).join('')).join('\n');

const TS: readonly Line[] = [
  [['// Read the price through the cache; 30 s is the lesson\'s window.', 'comment']],
  [['export', 'keyword'], [' ', 'plain'], ['const', 'keyword'], [' ', 'plain'], ['getPrice', 'function'], [' = ', 'keyword'], ['async', 'keyword'], [' (', 'punctuation'], ['id', 'parameter'], [': ', 'punctuation'], ['string', 'constant'], [') => {', 'punctuation']],
  [['  ', 'plain'], ['const', 'keyword'], [' cached ', 'plain'], ['=', 'keyword'], [' ', 'plain'], ['await', 'keyword'], [' redis.', 'plain'], ['get', 'function'], ['(', 'punctuation'], ['`price:', 'string'], ['${', 'punctuation'], ['id', 'plain'], ['}', 'punctuation'], ['`', 'string'], [')', 'punctuation']],
  [['  ', 'plain'], ['if', 'keyword'], [' (cached ', 'plain'], ['!==', 'keyword'], [' ', 'plain'], ['null', 'constant'], [') ', 'punctuation'], ['return', 'keyword'], [' ', 'plain'], ['Number', 'function'], ['(cached)', 'punctuation']],
  [['  ', 'plain'], ['await', 'keyword'], [' redis.', 'plain'], ['set', 'function'], ['(', 'punctuation'], ['`price:${id}`', 'string'], [', price, { EX: ', 'plain'], ['30', 'constant'], [' })', 'punctuation']],
  [['}', 'punctuation']],
];

const BASH: readonly Line[] = [
  [['# Run the lesson\'s failing test, then the fix', 'comment']],
  [['npm', 'function'], [' run test -- ', 'plain'], ['--grep', 'constant'], [' ', 'plain'], ['"stale price"', 'string']],
  [['export', 'keyword'], [' REDIS_URL', 'plain'], ['=', 'keyword'], ['"redis://localhost:6379"', 'string']],
  [['git', 'function'], [' switch fix/cache-after-read ', 'plain'], ['&&', 'keyword'], [' ', 'plain'], ['npm', 'function'], [' test', 'plain']],
];

const DIFF: readonly (readonly ['+' | '-' | ' ', Line])[] = [
  [' ', [['  ', 'plain'], ['const', 'keyword'], [' { price } ', 'plain'], ['=', 'keyword'], [' ', 'plain'], ['await', 'keyword'], [' db.products.', 'plain'], ['find', 'function'], ['(id)', 'punctuation']]],
  ['-', [['  ', 'plain'], ['await', 'keyword'], [' ', 'plain'], ['sleep', 'function'], ['(', 'punctuation'], ['600', 'constant'], [')', 'punctuation']]],
  ['-', [['  ', 'plain'], ['await', 'keyword'], [' redis.', 'plain'], ['set', 'function'], ['(key, price)', 'punctuation']]],
  ['+', [['  ', 'plain'], ['await', 'keyword'], [' redis.', 'plain'], ['set', 'function'], ['(key, price, { NX: ', 'punctuation'], ['true', 'constant'], [' })', 'punctuation']]],
  [' ', [['  ', 'plain'], ['return', 'keyword'], [' price', 'plain']]],
];

const TREE: MarkdownTree = {
  version: 1,
  issues: [],
  children: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Inline code such as ' }, { type: 'inlineCode', value: 'redis.set' }, { type: 'text', value: ' sits on the same ground as the blocks.' }] },
    { type: 'code', lang: 'ts', code: text(TS), file: 'src/products.ts', highlight: [3, 4], start: 1, tokens: tokens(TS) },
    { type: 'code', lang: 'bash', code: text(BASH), highlight: [], start: 1, tokens: tokens(BASH) },
    {
      type: 'diff',
      lang: 'ts',
      title: 'The fix',
      code: DIFF.map(([sign, line]) => `${sign}${text([line])}`).join('\n'),
      lines: DIFF.map(([sign, line]) => ({ sign, text: text([line]) })),
      tokens: tokens(DIFF.map(([, line]) => line)),
    },
  ],
};

const Themed = ({ theme, children }: { readonly theme: 'light' | 'dark'; readonly children: ReactNode }) => (
  <div className={theme} data-theme={theme} style={{ background: 'var(--background)', color: 'var(--foreground)', padding: 16, maxInlineSize: 792 }}>{children}</div>
);

/** The markdown ext: TS with two marked lines, bash and a diff; inline code above them. Light, then dark. */
export const MarkdownLightAndDark: Story = {
  render: () => (
    <G.Stack gap="section">
      <Themed theme="light"><Markdown tree={TREE} /></Themed>
      <Themed theme="dark"><Markdown tree={TREE} /></Themed>
    </G.Stack>
  ),
};

const EXCERPT = text(TS);

/** The lesson CodeBlock: the page's theme, then `scheme="dark"` on a light page and `scheme="light"` inside a dark one. */
export const CodeBlockSchemes: Story = {
  render: () => (
    <G.Stack gap="section">
      <Themed theme="light"><G.CodeBlock code={EXCERPT} language="ts" path="src/products.ts" highlightLines={[[3, 4]]} note="The page's theme (light)." /></Themed>
      <Themed theme="light"><G.CodeBlock code={EXCERPT} language="ts" path="src/products.ts" highlightLines={[[3, 4]]} scheme="dark" note='scheme="dark" on a light page.' /></Themed>
      <Themed theme="dark"><G.CodeBlock code={EXCERPT} language="ts" path="src/products.ts" highlightLines={[[3, 4]]} scheme="light" note='scheme="light" inside a dark page.' /></Themed>
    </G.Stack>
  ),
};

/** The lesson CodeBlock with Shiki's tokens (`tokens`) and `maxLines={4}`: the code scrolls inside the block, the header and note stay. Light, then dark. */
export const CodeBlockHighlighted: Story = {
  render: () => (
    <G.Stack gap="section">
      <Themed theme="light"><G.CodeBlock code={EXCERPT} language="ts" path="src/products.ts" tokens={tokens(TS)} maxLines={4} note="tokens + maxLines (light)." /></Themed>
      <Themed theme="dark"><G.CodeBlock code={EXCERPT} language="ts" path="src/products.ts" tokens={tokens(TS)} maxLines={4} highlightLines={[[3, 4]]} note="tokens + maxLines (dark)." /></Themed>
    </G.Stack>
  ),
};
