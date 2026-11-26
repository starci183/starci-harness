import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import * as G from '../common/index.js';
import { MermaidDiagram } from '../core/ext/graph/index.js';
import '../core/ext/graph/styles.css';

/** A `mermaid` fence drawn by the graph ext's MermaidDiagram: the core never imports the ext, so the app hands it to `renderDiagram`. */
const renderDiagram = (diagram: G.MarkdownDiagram) => <MermaidDiagram {...diagram} height="md" />;

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
};

export const Links: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown source={'Read [the guide](/docs/http/1) then [MDN](https://developer.mozilla.org) or [mail us](mailto:hi@example.com). An [empty target]() stays text.'} labels={{ externalHint: '(opens in a new tab)' }} />
    </div>
  ),
};

export const CodeWithCopy: Story = {
  render: () => <div style={frame}><G.Markdown source={'```ts\nexport const handler = async (request: Request) => {\n  return new Response("ok", { status: 200 })\n}\n```\n\n```bash\nnpm install\n```'} /></div>,
  play: async ({ canvasElement }) => {
    const view = canvasElement.ownerDocument.defaultView!;
    const written: string[] = [];
    Object.defineProperty(view.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    const buttons = await within(canvasElement).findAllByRole('button', { name: 'Copy' });
    await userEvent.click(buttons[0]!);
  },
};

export const NonLatinScript: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown
        renderDiagram={renderDiagram}
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
};

export const MermaidFence: Story = {
  render: () => <div style={frame}><G.Markdown renderDiagram={renderDiagram} source={'```mermaid\nflowchart LR\n  A[Request] --> B[Server] --> C[Response]\n```\n\n```mermaid\nnot a diagram at all\n```'} labels={{ diagramError: 'Could not draw this diagram.' }} /></div>,
};

export const NoRawHtml: Story = {
  render: () => <div style={frame}><G.Markdown source={'Text <script>window.__pwned = true</script> and <img src=x onerror="window.__pwned = true"> end.\n\n<!-- a comment is dropped -->\n\n<iframe src="https://example.com"></iframe>'} /></div>,
};

export const Compact: Story = {
  render: () => <div style={{ inlineSize: 320 }}><G.Markdown measure="compact" source={'A short note in a narrow pane with `code` and a [link](/x).\n\n| A | B |\n|---|---|\n| a very long cell that scrolls inside its frame | b |'} /></div>,
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
      <G.Markdown renderCode={fakeHighlight} renderDiagram={renderDiagram} source={'```ts\n' + LONG_LINE + '\n```\n\n```bash\nnpm install\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```'} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = canvasElement.ownerDocument.defaultView!;
    const written: string[] = [];
    Object.defineProperty(view.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    const buttons = await within(canvasElement).findAllByRole('button', { name: 'Copy' });
    // Copy writes the original value, not the token markup.
    await userEvent.click(buttons[0]!);
  },
};

/** Without `renderDiagram` a `mermaid` fence is its source, a code block: the core draws no diagram. */
export const MermaidFenceWithoutSlot: Story = {
  render: () => <div style={frame}><G.Markdown source={'```mermaid\nflowchart LR\n  A --> B\n```'} /></div>,
};

export const CodeSlotFallback: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown renderCode={() => null} source={'```ts\nconst a = 1\nconst b = 2\n```'} />
    </div>
  ),
};
