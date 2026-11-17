import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, BookGlyph, GroupGlyph, HomeGlyph, PlusGlyph, SettingsGlyph, UserGlyph } from './fixtures.js';

/**
 * THE COMMAND PALETTE (0.46.0). The one search of the whole app: a dialog with a field and grouped results, opened by a press or Ctrl K (Command K on a Mac) through
 * `useCommandPaletteShortcut`. The caret stays in the field and the arrows, Home and End move through the results, Enter chooses and Escape closes. The palette never filters:
 * the app searches and passes `groups`, `isLoading`, `error` and what an empty search shows. At 390 it fills the screen. Evidence: NIVO console shell canvas (`01-shell-app.html`,
 * the search of the top bar and its grouped results), `GRAMMAR-GAPS.md` G1.
 */
const meta: Meta = { title: 'Overlays/Command palette (0.46.0)', parameters: { layout: 'padded', grammar: { minHeight: '40rem' } } };
export default meta;
type Story = StoryObj;

const GROUPS: ReadonlyArray<G.CommandPaletteGroup> = [
  {
    id: 'work',
    label: 'Work',
    items: [
      { id: 'quote', label: 'Discount for the spring package', hint: 'Waiting for you, Sales assistant', source: BellGlyph },
      { id: 'refund', label: 'Refund a deposit to Quoc Bao', hint: 'Decision, 12/11', source: BellGlyph },
    ],
  },
  { id: 'customers', label: 'Customers', items: [{ id: 'thu-trang', label: 'Thu Trang', hint: 'Customer, last seen 02/11', source: GroupGlyph }] },
  { id: 'knowledge', label: 'Second brain', items: [{ id: 'price-list', label: 'Price list and discounts', hint: 'Document, updated 02/11', source: BookGlyph }] },
  {
    id: 'commands',
    label: 'Commands',
    items: [
      { id: 'go-home', label: 'Go to overview', source: HomeGlyph, shortcut: ['G', 'H'] },
      { id: 'new-job', label: 'New job', source: PlusGlyph, shortcut: ['ctrl', 'N'] },
      { id: 'settings', label: 'Open settings', source: SettingsGlyph, shortcut: ['ctrl', ','] },
      { id: 'invite', label: 'Invite a teammate', source: UserGlyph, isDisabled: true },
    ],
  },
];

const search = (query: string): ReadonlyArray<G.CommandPaletteGroup> => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return GROUPS;
  return GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(needle)) })).filter((group) => group.items.length > 0);
};

const FOOTER = <G.Text size="sm" tone="muted">Up and down choose, Enter opens, Escape closes</G.Text>;

type DemoProps = {
  readonly defaultOpen?: boolean;
  readonly initialQuery?: string;
  readonly isLoading?: boolean;
  readonly error?: G.ErrorData;
};

const Demo = ({ defaultOpen = false, initialQuery = '', isLoading = false, error }: DemoProps) => {
  const [isOpen, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState(initialQuery);
  const [chosen, setChosen] = useState('none');
  G.useCommandPaletteShortcut(() => setOpen((open) => !open));
  return (
    <>
      <G.Button endContent={<G.Kbd keys={['ctrl', 'K']} />} intent="dismiss" onPress={() => setOpen(true)}>Search</G.Button>
      <p role="status" data-story-chosen={chosen}>Chosen: {chosen}</p>
      <G.CommandPalette
        label="Search"
        closeLabel="Close search"
        placeholder="Search work, customers, agents"
        clearLabel="Clear search"
        isOpen={isOpen}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        groups={isLoading || error !== undefined ? [] : search(query)}
        onAction={setChosen}
        empty={<G.EmptyNotice message="No result for this search." />}
        isLoading={isLoading}
        {...(error === undefined ? {} : { error })}
        footer={FOOTER}
      />
    </>
  );
};

/** Open with the four groups: an icon, a label and a hint on each result, the chords of the commands at the end of their rows. */
export const Results: Story = {
  render: () => <Demo defaultOpen />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    const list = within(dialog).getByRole('listbox', { name: 'Search' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(8));
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Work', 'Customers', 'Second brain', 'Commands']);
    expect(dialog.querySelectorAll('kbd').length).toBe(3);
    await expect(within(dialog).getByRole('searchbox', { name: 'Search' })).toHaveFocus();
  },
};

/** The whole keyboard path: Ctrl K opens, typing narrows the results, the arrows move the active result while the caret stays in the field, Enter chooses and closes. */
export const Keyboard: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    expect(page.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    const field = within(dialog).getByRole('searchbox', { name: 'Search' });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.keyboard('dis');
    await waitFor(() => expect(within(dialog).getAllByRole('option')).toHaveLength(2));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await expect(field).toHaveFocus();
    await waitFor(() => expect(canvasElement.ownerDocument.getElementById(field.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('Price list'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvasElement.ownerDocument.querySelector('[data-story-chosen]')?.getAttribute('data-story-chosen')).toBe('price-list'));
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
  },
};

/** Escape closes and the press that opened it gets focus back. */
export const EscapeCloses: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.keyboard('{Control>}k{/Control}');
    await page.findByRole('dialog', { name: 'Search' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument());
  },
};

/** A search with no match: the app's empty notice stands where the results would, inside the same list. */
export const NoMatch: Story = {
  render: () => <Demo defaultOpen initialQuery="zzzz" />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    await waitFor(() => expect(within(dialog).getByText('No result for this search.')).toBeVisible());
    expect(within(dialog).queryAllByRole('option').filter((option) => option.getAttribute('aria-label') !== null)).toHaveLength(0);
  },
};

/** The results are coming: skeleton rows in the list's shape, the list busy and inert, the field still editable. */
export const Loading: Story = {
  render: () => <Demo defaultOpen isLoading />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    await waitFor(() => expect(dialog.querySelector('[data-grammar-list-skeleton]')).not.toBeNull());
    expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect(within(dialog).getByRole('searchbox', { name: 'Search' })).not.toBeDisabled();
  },
};

/** The search failed: the error takes the place of the results, with its retry. */
export const Failed: Story = {
  render: () => <Demo defaultOpen error={{ message: 'The search failed.', description: 'Check the connection and try again.', actionLabel: 'Try again', onAction: () => undefined }} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    await waitFor(() => expect(within(dialog).getByText('The search failed.')).toBeVisible());
    await expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

/** At 390 the palette fills the screen (inside the page inset) and the results scroll inside it. */
export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <Demo defaultOpen />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    await waitFor(() => {
      const box = dialog.getBoundingClientRect();
      if (window.innerWidth <= 640) {
        expect(box.width).toBeGreaterThanOrEqual(window.innerWidth - 40);
        expect(box.height).toBeGreaterThanOrEqual(window.innerHeight - 40);
      } else {
        expect(box.width).toBeLessThanOrEqual(48 * 16 + 1);
      }
    });
  },
};

/** At 1440 the palette stands at the top of the page, 48rem wide at most, so the field never moves while the results change. */
export const Wide: Story = {
  render: () => <Demo defaultOpen />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole('dialog', { name: 'Search' });
    const field = within(dialog).getByRole('searchbox', { name: 'Search' });
    await waitFor(() => expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(48 * 16 + 1));
    const before = field.getBoundingClientRect().top;
    await userEvent.keyboard('thu');
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBe(1));
    expect(Math.abs(field.getBoundingClientRect().top - before)).toBeLessThanOrEqual(1);
  },
};

/** A press on a control of the bar opens it too. */
export const OpenedByAControl: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Search/ }));
    await page.findByRole('dialog', { name: 'Search' });
  },
};
