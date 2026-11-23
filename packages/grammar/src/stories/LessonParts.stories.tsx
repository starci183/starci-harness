import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * LESSON PARTS (0.55.1, owner 2026-11-23). A diagram marks its faulty step, its fix and the parts a change touches in the Grammar's tones and
 * says what to look at in one caption line; a press opens it full screen to pan and zoom; on a phone a sequence becomes a numbered list and a
 * flowchart drawn across is drawn down. A code block names its file, numbers its lines, marks a range and ends with a note. A glossary term
 * carries its one-line definition.
 */
const meta: Meta = { title: 'Content/Lesson parts (0.55.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const FLOW = `flowchart LR
  A[Order paid] --> B[Refund twice]
  B --> C[Idempotency key]
  C --> D[One refund]
  class B danger
  class C accent`;

/** The faulty step danger (by `class B danger` in the source), the fix success (by `tones`), a touched part accent; a caption under it. */
export const DiagramTones: Story = {
  render: () => (
    <div style={{ maxInlineSize: 780 }}>
      <G.MermaidDiagram source={FLOW} label="Refund flow" tones={{ D: 'success' }} caption="The second refund is the bug; the key makes it one." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-grammar-mermaid-tone="danger"]')).not.toBeNull();
      expect(canvasElement.querySelector('[data-grammar-mermaid-tone="success"]')).not.toBeNull();
      expect(canvasElement.querySelector('[data-grammar-mermaid-tone="accent"]')).not.toBeNull();
      expect(canvasElement.querySelector('figcaption.starci-core-mermaid-diagram-caption')?.textContent).toContain('second refund');
    }, { timeout: 8000 });
  },
};

const SEQUENCE = `sequenceDiagram
  participant C as Customer
  participant S as Shop
  C->>S: Pays the order
  S-->>C: Sends the receipt
  C->>S: Asks for a refund`;

/** A sequence diagram in a phone-wide frame: a numbered list of its messages, who to whom, then what. */
export const SequenceOnPhone: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <G.MermaidDiagram source={SEQUENCE} label="Refund conversation" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const steps = canvasElement.querySelectorAll('[data-grammar-mermaid-steps="true"] > li');
      expect(steps).toHaveLength(3);
      expect(steps[0]?.textContent).toContain('Customer');
      expect(steps[0]?.textContent).toContain('Pays the order');
    }, { timeout: 8000 });
  },
};

/** A flowchart drawn across, in a phone-wide frame: drawn down. */
export const FlowOnPhone: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <G.MermaidDiagram source={FLOW} label="Refund flow" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[data-grammar-mermaid-fallback="stacked"]')).not.toBeNull(), { timeout: 8000 });
  },
};

const CODE = `export const refund = async (order: Order) => {
  const key = order.id
  if (await refunds.has(key)) return
  await payments.refund(order, { idempotencyKey: key })
}`;

/** A code block with its file path, numbered lines, lines 2 to 3 marked and a note under it. */
export const CodeLines: Story = {
  render: () => (
    <div style={{ maxInlineSize: 780 }}>
      <G.FencedCodeBlock language="ts" path="src/orders/refund.ts" code={CODE} lineNumbers highlightLines={[[2, 3]]} note="The key makes a second refund a no-op." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const lines = canvasElement.querySelectorAll('.starci-core-code-line');
      expect(lines).toHaveLength(5);
      expect([...lines].map((line) => line.getAttribute('data-grammar-line-highlighted'))).toEqual([null, 'true', 'true', null, null]);
      expect(canvasElement.querySelector('[data-grammar-code-path="true"]')?.textContent).toBe('src/orders/refund.ts');
      expect(canvasElement.querySelector('[data-grammar-code-note="true"]')).not.toBeNull();
    });
  },
};

/** A glossary term in a sentence: dotted, its definition its description, shown on hover, focus or a tap. */
export const Glossary: Story = {
  render: () => (
    <G.Text>
      Send every refund with an <G.GlossaryTerm definition="A key the payment provider uses to run one request only once.">idempotency key</G.GlossaryTerm> so a retry pays nothing twice.
    </G.Text>
  ),
  play: async ({ canvasElement }) => {
    const word = canvasElement.querySelector<HTMLButtonElement>('.starci-core-glossary-term-word');
    if (word === null) throw new Error('the term renders');
    const definition = document.getElementById(word.getAttribute('aria-describedby') ?? '');
    expect(definition?.textContent).toContain('only once');
    word.click();
    await waitFor(() => expect(getComputedStyle(definition as HTMLElement).visibility).toBe('visible'));
  },
};
