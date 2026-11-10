import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * Markdown: a markdown string drawn as course content. The text is parsed to a syntax tree and mapped to the grammar's own parts
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

A paragraph with **strong**, *emphasis*, ~~strikethrough~~, \`inline code\`, a [site link](/courses/http) and an [outside link](https://developer.mozilla.org/en-US/docs/Web/HTTP). A bare https://example.com autolink.
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
      <G.Markdown source={'Read [the lesson](/courses/http/1) then [MDN](https://developer.mozilla.org) or [mail us](mailto:hi@example.com). An [empty target]() stays text.'} labels={{ externalHint: '(opens in a new tab)' }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('a')).toHaveLength(3));
    const links = Array.from(canvasElement.querySelectorAll('a'));
    const internal = links.find((a) => a.getAttribute('href') === '/courses/http/1')!;
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

export const VietnameseLesson: Story = {
  render: () => (
    <div style={frame}>
      <G.Markdown
        labels={{ copy: 'Sao chép', copied: 'Đã sao chép', copyError: 'Không sao chép được. Hãy chọn đoạn mã và sao chép tay.', diagram: 'Sơ đồ', diagramError: 'Không vẽ được sơ đồ này.', table: 'Bảng', taskDone: 'Đã xong', taskOpen: 'Chưa xong', externalHint: '(mở trong tab mới)' }}
        source={`# Bài 3: Mã trạng thái HTTP

Máy chủ luôn trả lời một yêu cầu bằng một **mã trạng thái**. Đọc mã đầu tiên là biết kết quả thuộc nhóm nào. Xem thêm ở [MDN](https://developer.mozilla.org/vi/docs/Web/HTTP/Status) hoặc [bài 2](/khoa-hoc/http/bai-2).

## Các mã hay gặp

| Mã  | Tên                   | Khi nào                          |
| --- | --------------------- | -------------------------------- |
| 200 | OK                    | Yêu cầu thành công               |
| 201 | Created               | Đã tạo tài nguyên mới            |
| 301 | Moved Permanently     | Địa chỉ đã chuyển vĩnh viễn      |
| 404 | Not Found             | Không có tài nguyên ở địa chỉ này |
| 500 | Internal Server Error | Máy chủ gặp lỗi của chính nó     |

## Việc cần làm

- Mở tab Network của trình duyệt
  - Tải lại trang
  - Chọn một yêu cầu và đọc cột **Status**
- Thử gọi một địa chỉ không tồn tại
- [x] Đọc bảng mã
- [ ] Làm bài tập 3

## Trả lời đúng mã

\`\`\`ts
export const handler = (request: Request): Response => {
  if (request.url.endsWith("/missing")) {
    return new Response("Không tìm thấy", { status: 404 })
  }
  return new Response("OK", { status: 200 })
}
\`\`\`

## Luồng một yêu cầu

\`\`\`mermaid
sequenceDiagram
  Trình duyệt->>Máy chủ: GET /trang
  Máy chủ-->>Trình duyệt: 200 OK
\`\`\`

> Nhớ: bắt đầu bằng 2 là thành công, 4 là lỗi của người gọi, 5 là lỗi của máy chủ.
`}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('tbody tr')).toHaveLength(5);
      expect(within(canvasElement).getByRole('button', { name: 'Sao chép' })).toBeTruthy();
      expect(within(canvasElement).getByRole('region', { name: 'Bảng' })).toBeTruthy();
      expect(canvasElement.querySelector('[data-component="MermaidDiagram"]')?.getAttribute('aria-label')).toBe('Sơ đồ');
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
