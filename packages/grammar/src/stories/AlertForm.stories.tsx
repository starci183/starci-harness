import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * THE ALERT FORM SLOT (0.46.2). An `Alert` that asks the reader to decide holds the fields of the draft in its `form` slot, under the description and above the decision
 * buttons (`action` and `secondaryAction`). An Alert takes no `children`; the slot is the prop.
 */
const meta: Meta = { title: 'Overlays/Alert form slot (0.46.2)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const FIELDS: readonly G.SectionRow[] = [
  { id: 'to', title: 'To', value: 'Thu Trang' },
  { id: 'amount', title: 'Amount', value: '8,640,000 VND' },
  { id: 'valid', title: 'Valid until', value: '12/11/2026' },
];

const boxOf = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

/** The sales assistant asks for approval: the draft's fields stand under the question, then Reject and Approve at the end. */
export const Ask: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <G.Alert
        tone="cautionary"
        title="Send this quote?"
        description="The sales assistant wrote it from the call. It waits for you."
        form={<G.Section kind="list" layout="keyValue" ariaLabel="The quote" items={FIELDS} empty={null} />}
        action={{ label: 'Approve', onAction: noop }}
        secondaryAction={{ label: 'Reject', onAction: noop }}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const ask = boxOf(canvasElement, '.starci-core-alert');
      expect(ask.getAttribute('data-grammar-alert-form')).toBe('true');
      const form = boxOf(ask, '.starci-core-alert-form');
      const description = boxOf(ask, '.starci-core-alert-description').getBoundingClientRect();
      const slot = form.getBoundingClientRect();
      // Below 30rem the actions wrapper dissolves (its buttons take their own rows), so the first button is measured.
      const actions = boxOf(ask, '.starci-core-alert-actions button').getBoundingClientRect();
      // description, then the form, then the actions, each under the one before; the form stays inside the banner.
      expect(slot.top).toBeGreaterThanOrEqual(description.bottom - 1);
      expect(actions.top).toBeGreaterThanOrEqual(slot.bottom - 1);
      expect(slot.bottom).toBeLessThanOrEqual(ask.getBoundingClientRect().bottom);
      expect(form.textContent).toContain('8,640,000 VND');
      // Two decisions, the secondary before the primary.
      const buttons = [...ask.querySelectorAll('.starci-core-alert-actions button')].map((button) => button.textContent);
      expect(buttons).toEqual(['Reject', 'Approve']);
    }, { timeout: 4000 });
  },
};

/** Without a form the actions stay at the end of the row, beside the text. (A view holds one commit, so each anatomy is its own story.) */
export const NoFormKeepsRow: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <G.Alert tone="informative" title="No form: the actions stay at the end of the row" description="The anatomy without the slot." action={{ label: 'Open', onAction: noop }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const plain = boxOf(canvasElement, '.starci-core-alert');
      expect(plain.getAttribute('data-grammar-alert-form')).toBeNull();
      const plainBox = boxOf(plain, '.starci-core-alert-content').getBoundingClientRect();
      const plainActions = boxOf(plain, '.starci-core-alert-actions button').getBoundingClientRect();
      if (window.innerWidth >= 480) expect(plainActions.top).toBeLessThan(plainBox.bottom);
    }, { timeout: 4000 });
  },
};

/** Loading keeps the box: the same anatomy as shimmers, the form as geometry. */
export const LoadingKeepsBox: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <G.Alert tone="cautionary" title="Loading keeps the box" description="Same anatomy as shimmers." isLoading form={<G.Section kind="list" layout="keyValue" ariaLabel="The quote" items={FIELDS} empty={null} />} action={{ label: 'Approve', onAction: noop }} secondaryAction={{ label: 'Reject', onAction: noop }} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(boxOf(canvasElement, '.starci-core-alert').getAttribute('data-loading')).toBe('true');
    }, { timeout: 4000 });
  },
};
