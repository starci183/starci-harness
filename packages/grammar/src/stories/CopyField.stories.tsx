import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * CopyField: a read-only value with its copy action inside the field, at the height of every single-line field. One story
 * per state (plain, masked, long value truncated in the middle, copied, failed, skeleton, with description), each with a
 * play that measures the state; run per family by `scripts/run-plays.mjs`.
 */
const meta: Meta = {
  title: 'Forms/Copy field',
};
export default meta;

type Story = StoryObj;

const labels = { copyLabel: 'Copy', copiedLabel: 'Copied', copyErrorLabel: 'Could not copy. Select the value and copy it by hand.' } as const;
const column = { display: 'grid', gap: '1.5rem', maxWidth: 420 } as const;
const SECRET = 'demo-reveal-9f3a7c21e8b04d6fa2c5e1b7d0c94387';
const LONG_URL = 'https://hooks.example.com/api/v2/workspaces/6f1c2d3e/integrations/payments/webhooks/26465cdf9a0b';

/** Replaces the page's clipboard for one play; returns what was written and a restore. */
const stubClipboard = (canvasElement: HTMLElement, outcome: 'accept' | 'refuse') => {
  const view = canvasElement.ownerDocument.defaultView;
  if (view === null) throw new Error('the story has no window');
  const written: string[] = [];
  const refuse = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
  const clipboard = {
    writeText: async (text: string) => {
      if (outcome === 'refuse') return refuse();
      written.push(text);
    },
    write: async (items: ReadonlyArray<ClipboardItem>) => {
      if (outcome === 'refuse') return refuse();
      for (const item of items) written.push(await (await item.getType('text/plain')).text());
    },
  };
  Object.defineProperty(view.navigator, 'clipboard', { configurable: true, value: clipboard });
  return { written };
};

const fieldOf = (canvasElement: HTMLElement, label: string) => {
  const field = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="CopyField"]')]
    .find((node) => node.querySelector('[data-grammar-field-label]')?.textContent === label);
  if (field === undefined) throw new Error(`no CopyField labelled ${label}`);
  return field;
};

const part = (field: HTMLElement, selector: string) => {
  const node = field.querySelector<HTMLElement>(selector);
  if (node === null) throw new Error(`the field has no ${selector}`);
  return node;
};

const box = (node: Element) => node.getBoundingClientRect();

/** The control box sits under the label and the description under the control (HeroUI's field order). */
const assertAnatomyOrder = (field: HTMLElement) => {
  const label = box(part(field, '[data-grammar-field-label]'));
  const control = box(part(field, '[data-grammar-field-control="true"]'));
  if (control.top < label.bottom - 0.5) throw new Error('the control must sit under the label');
  const description = field.querySelector('[data-grammar-field-description]');
  if (description !== null && box(description).top < control.bottom - 0.5) throw new Error('the description must sit under the control');
};

export const Plain: Story = {
  render: () => (
    <div style={column}>
      <G.Input id="copy-reference" name="reference" label="Webhook name" defaultValue="Main account" />
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" {...labels} />
      <G.CopyField label="Locked value" value="acct_2041" isDisabled {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const input = canvasElement.querySelector<HTMLElement>('.starci-core-input-field');
      if (input === null) throw new Error('the reference Input is missing');
      const field = fieldOf(canvasElement, 'Webhook URL');
      const group = part(field, '[data-grammar-field-control="true"]');
      if (Math.abs(box(group).height - box(input).height) > 0.5) throw new Error(`CopyField ${box(group).height}px must equal the Input ${box(input).height}px`);
      if (Math.abs(box(group).height - 40) > 0.5) throw new Error('a single-line field is 40px tall');
      const value = part(field, '[data-grammar-copy-value]');
      if (value.getAttribute('role') !== 'textbox' || value.getAttribute('aria-readonly') !== 'true') throw new Error('the value is a read-only textbox');
      if (value.textContent !== 'https://example.com/hooks/26465cdf') throw new Error('the value text is the whole value');
      if (part(field, '[data-grammar-copy-action]').getAttribute('aria-label') !== labels.copyLabel) throw new Error('the action is named by copyLabel');
      assertAnatomyOrder(field);
    });
  },
};

export const Masked: Story = {
  render: () => (
    <div style={column}>
      <G.CopyField masked label="Secret key" lastFour={SECRET.slice(-4)} onCopy={async () => SECRET} {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.closest('[data-grammar-family]') ?? canvasElement.ownerDocument.body;
    const neverClear = () => {
      if ((root.textContent ?? '').includes(SECRET) || canvasElement.ownerDocument.body.innerHTML.includes(SECRET)) throw new Error('a masked field never renders the clear value');
    };
    const field = fieldOf(canvasElement, 'Secret key');
    neverClear();
    const value = part(field, '[data-grammar-copy-value]');
    if (!/^•{8}4387$/.test(value.textContent ?? '')) throw new Error(`a masked value is bullets and the last four, got ${value.textContent ?? ''}`);
    value.focus();
    if (canvasElement.ownerDocument.querySelector('[data-grammar-copy-full-value]') !== null) throw new Error('a masked value has no full-value tooltip');
    const clipboard = stubClipboard(canvasElement, 'accept');
    await userEvent.click(part(field, '[data-grammar-copy-action]'));
    await waitFor(() => {
      if (field.getAttribute('data-grammar-copy-state') !== 'copied') throw new Error('not copied yet');
    });
    if (clipboard.written.at(-1) !== SECRET) throw new Error('the copy writes what onCopy resolved');
    neverClear();
  },
};

export const LongValueMiddleTruncation: Story = {
  name: 'Long value (truncated in the middle)',
  parameters: { grammar: { minHeight: '16rem' } },
  render: () => (
    <div style={{ ...column, maxWidth: 300, paddingTop: '4rem' }}>
      <G.CopyField label="Webhook URL" value={LONG_URL} {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const field = fieldOf(canvasElement, 'Webhook URL');
    const value = part(field, '[data-grammar-copy-value]');
    await waitFor(() => {
      if (value.getAttribute('data-grammar-truncated') !== 'true') throw new Error('a value wider than its box is truncated');
    });
    const head = part(field, '[data-grammar-copy-head]');
    const tail = part(field, '[data-grammar-copy-tail]');
    if (getComputedStyle(head).textOverflow !== 'ellipsis') throw new Error('the head gives way under an ellipsis');
    if (tail.textContent !== LONG_URL.slice(-8) || tail.scrollWidth > tail.clientWidth + 0.5) throw new Error('the tail stays whole');
    if (box(tail).right > box(part(field, '[data-grammar-copy-action]')).left + 0.5) throw new Error('the tail ends before the action');
    if (value.textContent !== LONG_URL) throw new Error('a screen reader reads the whole value');
    value.focus();
    await waitFor(() => {
      const tip = canvasElement.ownerDocument.querySelector('[data-grammar-copy-full-value]');
      if (tip?.textContent !== LONG_URL) throw new Error('focus shows the whole value in a tooltip');
    });
  },
};

export const Copied: Story = {
  render: () => (
    <div style={column}>
      <G.CopyField label="Account number" value="0123456789" {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const field = fieldOf(canvasElement, 'Account number');
    const action = part(field, '[data-grammar-copy-action]');
    const clipboard = stubClipboard(canvasElement, 'accept');
    const copied = async () => {
      await userEvent.click(action);
      await waitFor(() => {
        if (field.getAttribute('data-grammar-copy-state') !== 'copied') throw new Error('not copied yet');
      });
      if (action.getAttribute('aria-label') !== labels.copiedLabel) throw new Error('the action reads copiedLabel while copied');
      const live = part(field, '[aria-live="polite"]');
      if (live.textContent !== labels.copiedLabel) throw new Error('the copy is announced politely');
    };
    await copied();
    if (clipboard.written.at(-1) !== '0123456789') throw new Error('a plain copy writes the value');
    await waitFor(() => {
      if (field.getAttribute('data-grammar-copy-state') !== 'idle') throw new Error('the confirmation lasts about two seconds');
    }, { timeout: 3500 });
    if (action.getAttribute('aria-label') !== labels.copyLabel) throw new Error('the action returns to copyLabel');
    await copied();
  },
};

export const CopyFailed: Story = {
  name: 'Copy failed (error)',
  render: () => (
    <div style={column}>
      <G.CopyField label="Account number" value="0123456789" description="Your bank shows this on transfers." {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const field = fieldOf(canvasElement, 'Account number');
    const action = part(field, '[data-grammar-copy-action]');
    stubClipboard(canvasElement, 'refuse');
    await userEvent.click(action);
    await waitFor(() => {
      if (field.getAttribute('data-grammar-copy-state') !== 'failed') throw new Error('a refused copy is the error state');
    });
    const error = part(field, '[data-grammar-field-error]');
    if (error.textContent !== labels.copyErrorLabel) throw new Error('the error shows in the field error slot');
    if (!(action.getAttribute('aria-describedby') ?? '').includes(error.id)) throw new Error('the error describes the action');
    if (part(field, '[aria-live="polite"]').textContent !== labels.copyErrorLabel) throw new Error('the failure is announced');
    if (field.getAttribute('data-grammar-invalid') !== 'true') throw new Error('a failed copy marks the field invalid');
    assertAnatomyOrder(field);
    if (box(error).top < box(part(field, '[data-grammar-field-description]')).bottom - 0.5) throw new Error('the error is the last row');
  },
};

export const Skeleton: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'start', gap: '1rem', maxWidth: 720 }}>
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste it into the provider." {...labels} />
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste it into the provider." {...labels} isSkeleton />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const [ready, loading] = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="CopyField"]')];
      if (ready === undefined || loading === undefined) throw new Error('both phases render');
      const scope = loading.closest('[data-grammar-field-skeleton]');
      if (scope === null || scope.getAttribute('aria-busy') !== 'true') throw new Error('the loading field is busy and inert');
      const a = box(part(ready, '[data-grammar-field-control="true"]'));
      const b = box(part(loading, '[data-grammar-field-control="true"]'));
      if (Math.abs(a.height - b.height) > 1 || Math.abs(a.width - b.width) > 1 || Math.abs(a.top - b.top) > 1) throw new Error('the skeleton keeps the field box');
      if (Math.abs(box(ready).height - box(loading).height) > 1) throw new Error('the skeleton keeps the field height');
    });
  },
};

export const WithDescription: Story = {
  render: () => (
    <div style={column}>
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste this into the payment provider's dashboard." {...labels} />
      <G.CopyField masked label="Webhook secret" lastFour="b7d0" onCopy={() => 'whsec_example_b7d0'} description="Shown once. Copy it now." {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const label of ['Webhook URL', 'Webhook secret']) {
      const field = fieldOf(canvasElement, label);
      const description = part(field, '[data-grammar-field-description]');
      const value = part(field, '[data-grammar-copy-value]');
      if (!(value.getAttribute('aria-describedby') ?? '').includes(description.id)) throw new Error('the description describes the value');
      assertAnatomyOrder(field);
    }
  },
};
