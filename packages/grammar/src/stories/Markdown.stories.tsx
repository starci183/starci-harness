import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * Markdown: a markdown string drawn as document content. The text is parsed to a syntax tree and mapped to the grammar's own parts
 * inside the reading frame (MarkdownArticle); nothing is injected as HTML. One story per concern, each with a play.
 */
const meta: Meta = { title: 'Surfaces/Markdown' };
export default meta;
type Story = StoryObj;

const frame = { inlineSize: 560, maxInlineSize: '100%' } as const;

const EVERY_NODE = `# Title one (demoted to h2)

## Second level

### Third level

#### Fourth level

##### Fifth level (kept at h4)

A paragraph with **strong**, *emphasis*, ~~strikethrough~~, \`inline code\`, a [site link](/docs/http) and an [outside link](https://developer.mozilla.org/en-US/docs/Web/HTTP). A bare https://example.com autolink.
A hard break follows
on the next line.

- one
- two
  - nested a
  - nested b
- three

1. first
2. second
   1. inner one
   2. inner two

- [x] done task
- [ ] open task

> A quote that says one thing
> over two lines.

---

| Method | Meaning |
| :----- | ------: |
| GET    | read    |
| POST   | create  |

\`\`\`ts
const answer: number = 42
\`\`\`

![A server answering a request](https://example.com/server.png)

<div onclick="alert(1)">raw html is text</div>

[bad link](javascript:alert(1))
`;

export const EveryNode: Story = {
  render: () => <div style={frame}><G.Markdown source={EVERY_NODE} /></div>,
  play: async ({ canvasElement }) => {
    const q = (selector: string) => Array.from(canvasElement.querySelectorAll(selector));
    await waitFor(() => {
      expect(q('h1')).toHaveLength(0);
      expect(q('h2').map((h) => h.textContent)).toEqual(['Title one (demoted to h2)', 'Second level']);
      expect(q('h3')).toHaveLength(1);
      expect(q('h4')).toHaveLength(2);
      expect(q('strong, [data-strong="true"]').length).toBeGreaterThan(0);
      expect(q('em')).toHaveLength(1);
      expect(q('del')).toHaveLength(1);
      expect(q('code[data-component="Code"]')).toHaveLength(1);
      expect(q('ul ul')).toHaveLength(1);
      expect(q('ol ol')).toHaveLength(1);
      expect(q('input[type="checkbox"]').map((c) => (c as HTMLInputElement).checked)).toEqual([true, false]);
      expect(q('input[type="checkbox"]').every((c) => (c as HTMLInputElement).disabled)).toBe(true);
      expect(q('blockquote')).toHaveLength(1);
      expect(q('hr')).toHaveLength(1);
      expect(q('[data-component="MarkdownTableFrame"] table')).toHaveLength(1);
      expect(q('[data-component="FencedCodeBlock"]')).toHaveLength(1);
      expect(q('figure[data-component="MediaFrame"] img[alt="A server answering a request"]')).toHaveLength(1);
    });
    // Raw HTML and a script URL are never elements.
    expect(q('div[onclick]')).toHaveLength(0);
    expect(canvasElement.textContent).toContain('<div onclick="alert(1)">raw html is text</div>');
    expect(q('a').some((a) => (a.getAttribute('href') ?? '').startsWith('javascript:'))).toBe(false);
  },
};

export const Links: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown source={'Read [the guide](/docs/http/1) then [MDN](https://developer.mozilla.org) or [mail us](mailto:hi@example.com). An [empty target]() stays text.'} labels={{ externalHint: '(opens in a new tab)' }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('a')).toHaveLength(3));
    const links = Array.from(canvasElement.querySelectorAll('a'));
    const internal = links.find((a) => a.getAttribute('href') === '/docs/http/1')!;
    const external = links.find((a) => a.getAttribute('href') === 'https://developer.mozilla.org')!;
    expect(internal.querySelector('[data-grammar-link-icon]')).toBeNull();
    expect(internal.getAttribute('target')).toBeNull();
    expect(external.querySelector('[data-grammar-link-icon]')).not.toBeNull();
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toContain('noopener');
  },
};

export const CodeWithCopy: Story = {
  render: () => <div style={frame}><G.Markdown source={'```ts\nexport const handler = async (request: Request) => {\n  return new Response("ok", { status: 200 })\n}\n```\n\n```bash\nnpm install\n```'} /></div>,
  play: async ({ canvasElement }) => {
    const view = canvasElement.ownerDocument.defaultView!;
    const written: string[] = [];
    Object.defineProperty(view.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    const buttons = await within(canvasElement).findAllByRole('button', { name: 'Copy' });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(within(canvasElement).getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(written[0]).toContain('new Response("ok"');
    expect(canvasElement.querySelector('pre')?.getAttribute('tabindex')).toBe('0');
  },
};

export const NonLatinScript: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown
        labels={{ copy: 'Copy snippet', copied: 'Snippet copied', copyError: 'Could not copy. Select the code and copy it by hand.', diagram: 'Diagram', diagramError: 'Could not draw this diagram.', table: 'Table', taskDone: 'Done', taskOpen: 'Not done', externalHint: '(opens in a new tab)' }}
        source={`# Part 3: HTTP status codes, a naïve résumé

The server always answers a request with a **status code**. Reading the first digit tells you the group of the result. See more at [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status) or [part 2](/docs/http/part-2).

## Codes you meet often

| Code | Name                  | When                                  |
| ---- | --------------------- | ------------------------------------- |
| 200  | OK                    | The request succeeded                 |
| 201  | Created               | A new resource was created            |
| 301  | Moved Permanently     | The address moved for good            |
| 404  | Not Found             | No resource lives at this address     |
| 500  | Internal Server Error | The server hit a fault of its own     |

## Things to do

- Open the Network tab of the browser
  - Reload the page
  - Pick a request and read the **Status** column
- Call an address that does not exist
- [x] Read the code table
- [ ] Do exercise 3

## Answer with the right code

\`\`\`ts
export const handler = (request: Request): Response => {
  if (request.url.endsWith("/missing")) {
    return new Response("Crème brûlée, façade, Ångström, Zoë: not found", { status: 404 })
  }
  return new Response("OK", { status: 200 })
}
\`\`\`

## Flow of one request

\`\`\`mermaid
sequenceDiagram
  Naïve client->>Crème server: GET /page
  Crème server-->>Naïve client: 200 OK
\`\`\`

> Remember: starting with 2 is success, 4 is the caller's fault, 5 is the server's fault.
`}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('tbody tr')).toHaveLength(5);
      expect(within(canvasElement).getByRole('button', { name: 'Copy snippet' })).toBeTruthy();
      expect(within(canvasElement).getByRole('region', { name: 'Table' })).toBeTruthy();
      expect(canvasElement.querySelector('[data-component="MermaidDiagram"]')?.getAttribute('aria-label')).toBe('Diagram');
    });
    // Type scale law: body 14, no 13 or 16.
    const sizes = new Set(Array.from(canvasElement.querySelectorAll('h2, h3, p, li, td, th')).map((node) => getComputedStyle(node).fontSize));
    expect(Array.from(sizes).every((size) => size === '14px' || size === '12px')).toBe(true);
  },
};

export const MermaidFence: Story = {
  render: () => <div style={frame}><G.Markdown source={'```mermaid\nflowchart LR\n  A[Request] --> B[Server] --> C[Response]\n```\n\n```mermaid\nnot a diagram at all\n```'} labels={{ diagramError: 'Could not draw this diagram.' }} /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const diagrams = Array.from(canvasElement.querySelectorAll('[data-component="MermaidDiagram"]'));
      expect(diagrams.map((d) => d.getAttribute('aria-label'))).toEqual(['Diagram 1', 'Diagram 2']);
      expect(diagrams.map((d) => d.getAttribute('data-grammar-mermaid-state'))).toEqual(['ready', 'error']);
    }, { timeout: 15000 });
  },
};

export const NoRawHtml: Story = {
  render: () => <div style={frame}><G.Markdown source={'Text <script>window.__pwned = true</script> and <img src=x onerror="window.__pwned = true"> end.\n\n<!-- a comment is dropped -->\n\n<iframe src="https://example.com"></iframe>'} /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('<script>'));
    expect(canvasElement.querySelector('script, iframe, img[onerror]')).toBeNull();
    expect(canvasElement.textContent).not.toContain('a comment is dropped');
    expect((canvasElement.ownerDocument.defaultView as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  },
};

export const Compact: Story = {
  render: () => <div style={{ inlineSize: 320 }}><G.Markdown measure="compact" source={'A short note in a narrow pane with `code` and a [link](/x).\n\n| A | B |\n|---|---|\n| a very long cell that scrolls inside its frame | b |'} /></div>,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const article = canvasElement.querySelector('[data-component="MarkdownArticle"]')!;
      expect(article.getAttribute('data-grammar-markdown-measure')).toBe('compact');
      expect(article.scrollWidth).toBeLessThanOrEqual(article.clientWidth + 1);
    });
  },
};

/** A fake highlighter: wraps every word in a token span inside the wrapper Grammar styles. */
const fakeHighlight = ({ language, value }: { readonly language: string | null; readonly value: string }) => (
  <div data-grammar-fenced-code-highlight="true" data-fake-lang={language ?? ''}>
    <pre><code>{value.split(/(\s+)/).map((part, index) => (/^\s*$/.test(part) ? part : <span key={index} data-token="word">{part}</span>))}</code></pre>
  </div>
);

const LONG_LINE = 'export const handler = async (request: Request) => { return new Response("a very long line that must scroll inside the frame and never wrap", { status: 200 }) }';

export const HighlightedCodeSlot: Story = {
  render: () => (
    <div style={{ inlineSize: 360, maxInlineSize: '100%' }}>
      <G.Markdown renderCode={fakeHighlight} source={'```ts\n' + LONG_LINE + '\n```\n\n```bash\nnpm install\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```'} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = canvasElement.ownerDocument.defaultView!;
    const written: string[] = [];
    Object.defineProperty(view.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    const buttons = await within(canvasElement).findAllByRole('button', { name: 'Copy' });
    expect(buttons).toHaveLength(2);
    const blocks = Array.from(canvasElement.querySelectorAll('[data-component="FencedCodeBlock"]'));
    expect(blocks).toHaveLength(2);
    // The slot's node is the body; the frame and its language label stay Grammar's.
    expect(blocks[0]!.querySelectorAll('[data-grammar-fenced-code-highlight="true"] [data-token="word"]').length).toBeGreaterThan(5);
    expect(blocks[0]!.querySelector('[data-fake-lang="ts"]')).not.toBeNull();
    expect(blocks[0]!.firstElementChild!.textContent).toContain('ts');
    // A one-line command keeps no language label.
    expect(blocks[1]!.querySelector('[data-fake-lang="bash"]')).not.toBeNull();
    expect(blocks[1]!.firstElementChild!.textContent).not.toContain('bash');
    // Highlighted content scrolls inline instead of wrapping.
    const wrapper = blocks[0]!.querySelector<HTMLElement>('[data-grammar-fenced-code-highlight="true"]')!;
    expect(view.getComputedStyle(wrapper).overflowX).toBe('auto');
    expect(wrapper.scrollWidth).toBeGreaterThan(wrapper.clientWidth);
    // Copy writes the original value, not the token markup.
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(written).toEqual([LONG_LINE]));
    // Mermaid never goes through the slot.
    await waitFor(() => expect(canvasElement.querySelector('[data-component="MermaidDiagram"]')).not.toBeNull());
    expect(canvasElement.querySelectorAll('[data-fake-lang="mermaid"]')).toHaveLength(0);
  },
};

export const CodeSlotFallback: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown renderCode={() => null} source={'```ts\nconst a = 1\nconst b = 2\n```'} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-component="FencedCodeBlock"] pre code')?.textContent).toBe('const a = 1\nconst b = 2'));
    expect(canvasElement.querySelector('[data-grammar-fenced-code-highlight]')).toBeNull();
    expect(canvasElement.querySelector('pre')?.getAttribute('tabindex')).toBe('0');
  },
};
