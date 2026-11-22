import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, BookGlyph, HomeGlyph } from './fixtures.js';

/**
 * OVERLAYS ON A PHONE (0.48.0). A `Popover` has a 1px border and a soft shadow; at 480px and narrower it is a sheet on the bottom edge, the full width, over a
 * scrim. The `CommandPalette` at 390 takes the full width at the top and stays as tall as its results (it no longer fills the screen), draws no keys footer on a
 * touch screen, and the row the arrows are on wears the selected fill, never a heavy focus ring.
 */
const meta: Meta = { title: 'Overlays/Popover sheet and the palette on a phone (0.48.0)', parameters: { grammar: { minHeight: '40rem' } } };
export default meta;
type Story = StoryObj;

const panel = (root: Document): HTMLElement => {
  const found = root.querySelector<HTMLElement>('.starci-core-popover');
  if (found === null) throw new Error('The popover must be open');
  return found;
};

/** Open on a wide screen: a 1px border and a soft shadow around the panel. At 480px and below: a full-width sheet on the bottom edge over a scrim. */
export const PopoverEdgeAndSheet: Story = {
  render: () => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem' }}>
      <G.Popover defaultOpen title="Thông báo" trigger={<G.IconButton label="Thông báo" source={BellGlyph} variant="border" />} showArrow>
        <G.Text role="body">Ba cuộc trò chuyện đang chờ bạn.</G.Text>
      </G.Popover>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    await waitFor(() => {
      const box = panel(doc);
      const style = getComputedStyle(box);
      const viewport = doc.documentElement.clientWidth;
      if (viewport <= 480) {
        const rect = box.getBoundingClientRect();
        expect(style.position).toBe('fixed');
        expect(Math.round(rect.width)).toBe(viewport);
        expect(Math.abs(rect.bottom - (doc.defaultView?.innerHeight ?? 0))).toBeLessThanOrEqual(1);
        // The scrim: a spread shadow that covers the page around the sheet.
        expect(style.boxShadow).toContain('0px 0px 0px');
        expect(box.querySelector('.starci-core-popover-arrow')?.getBoundingClientRect().width ?? 0).toBe(0);
      } else {
        expect(style.borderTopWidth).toBe('1px');
        expect(style.boxShadow).not.toBe('none');
      }
    }, { timeout: 4000 });
  },
};

const GROUPS: ReadonlyArray<G.CommandPaletteGroup> = [
  { id: 'pages', label: 'Trang', items: [{ id: 'home', label: 'Tổng quan', source: HomeGlyph }, { id: 'docs', label: 'Tài liệu', hint: 'Cập nhật 02/11', source: BookGlyph }] },
];

const Palette = () => {
  const [query, setQuery] = useState('');
  const [isOpen, setOpen] = useState(true);
  return (
    <G.CommandPalette
      label="Tìm kiếm"
      closeLabel="Đóng"
      isOpen={isOpen}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      groups={GROUPS}
      onAction={() => undefined}
      empty={<G.EmptyNotice mark="none" message="Không có kết quả." />}
      footer={<G.Text role="body" tone="muted">Lên xuống để chọn, Enter để mở</G.Text>}
    />
  );
};

/** Two results at 390: the palette is as tall as its results, not the screen; the keys footer is gone on a coarse pointer; the arrowed row is the selected fill. */
export const PaletteShortList: Story = {
  render: () => <Palette />,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const page = within(doc.body);
    const dialog = await page.findByRole('dialog', { name: 'Tìm kiếm' });
    await waitFor(() => expect(within(dialog).getAllByRole('option')).toHaveLength(2));
    const height = doc.defaultView?.innerHeight ?? 0;
    if ((doc.defaultView?.innerWidth ?? 0) <= 640) expect(dialog.getBoundingClientRect().height).toBeLessThan(height * 0.7);
    const footer = dialog.closest('.starci-core-dialog-container')?.querySelector<HTMLElement>('.starci-core-overlay-footer');
    const coarse = doc.defaultView?.matchMedia('(pointer: coarse)').matches === true;
    expect(footer === null || footer === undefined ? 'none' : getComputedStyle(footer).display === 'none' ? 'none' : 'shown').toBe(coarse ? 'none' : 'shown');
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => {
      const active = doc.querySelector<HTMLElement>('.starci-core-command-palette .starci-core-list-box-item[data-focused="true"]');
      expect(active).not.toBeNull();
      const style = getComputedStyle(active as HTMLElement);
      expect(style.outlineStyle === 'none' || style.outlineWidth === '0px').toBe(true);
      expect(style.boxShadow).toBe('none');
      expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    });
  },
};
