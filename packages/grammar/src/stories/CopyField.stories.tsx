import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * CopyField: a read-only value with its copy action inside the field, at the height of every single-line field. One story
 * per state (plain, masked, long value truncated in the middle, copied, failed, skeleton, with description), some with a
 * play only where the state needs a press (the copy); shot per family by `npm run shoot`.
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

export const Plain: Story = {
  render: () => (
    <div style={column}>
      <G.Input id="copy-reference" name="reference" label="Webhook name" defaultValue="Main account" />
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" {...labels} />
      <G.CopyField label="Locked value" value="acct_2041" isDisabled {...labels} />
    </div>
  ),
};

export const Masked: Story = {
  render: () => (
    <div style={column}>
      <G.CopyField masked label="Secret key" lastFour={SECRET.slice(-4)} onCopy={async () => SECRET} {...labels} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const neverClear = () => {
    };
    const field = fieldOf(canvasElement, 'Secret key');
    neverClear();
    const value = part(field, '[data-grammar-copy-value]');
    value.focus();
    const clipboard = stubClipboard(canvasElement, 'accept');
    await userEvent.click(part(field, '[data-grammar-copy-action]'));
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
    value.focus();
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
    };
    await copied();
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
  },
};

export const Skeleton: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'start', gap: '1rem', maxWidth: 720 }}>
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste it into the provider." {...labels} />
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste it into the provider." {...labels} isLoading />
    </div>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <div style={column}>
      <G.CopyField label="Webhook URL" value="https://example.com/hooks/26465cdf" description="Paste this into the payment provider's dashboard." {...labels} />
      <G.CopyField masked label="Webhook secret" lastFour="b7d0" onCopy={() => 'whsec_example_b7d0'} description="Shown once. Copy it now." {...labels} />
    </div>
  ),
};
