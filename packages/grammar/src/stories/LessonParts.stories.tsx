import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * LESSON PARTS (0.55.1, owner 2026-11-23). A lesson's diagrams are `Content/Lesson diagrams (0.55.1)` (the graph ext's canvas). A code block names its file, numbers its lines, marks a range and ends with a note. A glossary term
 * carries its one-line definition.
 */
const meta: Meta = { title: 'Content/Lesson parts (0.55.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

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
