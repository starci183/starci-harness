import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
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

/** Open on a wide screen: a 1px border and a soft shadow around the panel. At 480px and below: a full-width sheet on the bottom edge over a scrim. */
export const PopoverEdgeAndSheet: Story = {
  render: () => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem' }}>
      <G.Popover defaultOpen title="Thông báo" trigger={<G.IconButton label="Thông báo" source={BellGlyph} variant="border" />} showArrow>
        <G.Text role="body">Ba cuộc trò chuyện đang chờ bạn.</G.Text>
      </G.Popover>
    </div>
  ),
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
  play: async () => {
    await userEvent.keyboard('{ArrowDown}');
  },
};
