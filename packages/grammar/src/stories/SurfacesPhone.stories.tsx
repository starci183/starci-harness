import type { Meta, StoryObj } from '@storybook/react-vite';
import { lazy, Suspense } from 'react';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';
import { BellGlyph, noop, placeholderImage, textContrast } from './fixtures.js';

/**
 * FIGURES, ROWS, BANDS AND PAGES (0.48.0). A figure that is a link shows a chevron and a hover fill at rest. On a phone a rows-list row puts its status chips
 * and its commands under the text, always, on the title's edge; its step numeral is regular weight. A list that loads with no row to measure draws placeholder
 * rows in its layout's shape. A Button on an accent or dark band takes `ground` and keeps its contrast. An eager Image paints before hydration and takes
 * `fetchPriority`. A `Page chrome="panes"` accepts a pane grid that arrives as a lazy (client) element.
 */
const meta: Meta = { title: 'Surfaces/Figures, rows, bands and pages (0.48.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const one = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element for ${selector}`);
  return found;
};

/** Three figures, the first two links: their terms end with the chevron of a pressable row, text-sized (1em of the term); the third, not a link, has none. */
export const FigureLinkCue: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720 }}>
      <G.Section
        kind="figures"
        title="Hôm nay"
        items={[
          { id: 'orders', term: 'Đơn mới', value: 12, href: '#orders' },
          { id: 'chats', term: 'Tin chưa đọc', value: 5, href: '#chats' },
          { id: 'rate', term: 'Tỉ lệ chốt', value: '18', unit: '%' },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const pairs = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-description-pair')];
      expect(pairs.map((pair) => pair.querySelector('[data-grammar-figure-cue="true"]') !== null)).toEqual([true, true, false]);
      expect(getComputedStyle(pairs[0] as HTMLElement).cursor).toBe('pointer');
      // The cue is a caret, text-sized: its glyph box is exactly the term's font size (1em of label.group, 12), centred on the term's line.
      const term = one(pairs[0] as HTMLElement, '.starci-core-description-stat-term');
      const fontSize = Number.parseFloat(getComputedStyle(term).fontSize);
      const glyph = one(pairs[0] as HTMLElement, '[data-grammar-figure-cue="true"] svg').getBoundingClientRect();
      expect(glyph.width).toBeCloseTo(fontSize, 1);
      expect(glyph.height).toBeCloseTo(fontSize, 1);
      const words = one(term, ':scope > span:not([data-grammar-figure-cue])').getBoundingClientRect();
      expect(Math.abs((glyph.top + glyph.bottom) / 2 - (words.top + words.bottom) / 2)).toBeLessThanOrEqual(1);
    });
  },
};

const ROWS: ReadonlyArray<G.SectionRow> = [
  { id: 'a', title: 'Gửi báo giá cho Mai Phương', description: 'Hạn hôm nay', leading: { position: 1 }, badges: [{ label: 'Chờ duyệt', tone: 'warning' }], action: { label: 'Duyệt', press: noop } },
  { id: 'b', title: 'Gọi lại Quốc Bảo', description: 'Trễ 1 ngày', leading: { position: 2 }, badges: [{ label: 'Quá hạn', tone: 'danger' }], action: { label: 'Mở cuộc gọi', press: noop }, menu: { label: 'Thêm', entries: [{ id: 'skip', label: 'Bỏ qua', onAction: noop }] } },
  { id: 'c', title: 'Nhắc lịch hẹn', description: 'Thứ Năm 10:00', leading: { position: 3 }, meta: { text: '2 ngày' } },
];

/** Three numbered task rows: at 390 every row's chips and commands stand under its text on the title's edge; the numerals are 400. */
export const ListRowPhoneWrap: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720 }}>
      <G.Section kind="list" title="Việc cần làm" items={ROWS} empty={null} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const rows = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-list-row')];
      expect(rows).toHaveLength(3);
      for (const number of canvasElement.querySelectorAll<HTMLElement>('.starci-core-leading-number')) expect(getComputedStyle(number).fontWeight).toBe('400');
      const narrow = (rows[0]?.closest('.starci-core-section')?.getBoundingClientRect().width ?? 1000) <= 448;
      if (!narrow) return;
      for (const row of rows) {
        const title = one(row, '.starci-core-list-row-name').getBoundingClientRect();
        for (const part of row.querySelectorAll<HTMLElement>(':scope > :is(.starci-core-list-row-trail, .starci-core-list-row-actions)')) {
          const box = part.getBoundingClientRect();
          expect(box.top).toBeGreaterThanOrEqual(title.bottom - 1);
          expect(Math.abs(box.left - title.left)).toBeLessThanOrEqual(1);
        }
      }
    }, { timeout: 4000 });
  },
};

/** A key-value list and a rows list, loading with no row yet: the placeholder rows have the height of the real rows of the same layout. */
export const SectionSkeletonShape: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))' }}>
      <G.Section kind="list" title="Đang tải" isLoading items={[]} empty={null} />
      <G.Section kind="list" title="Đã tải" items={[{ id: 'a', title: 'Mai Phương', description: 'Khách quay lại' }, { id: 'b', title: 'Quốc Bảo', description: 'Khách mới' }, { id: 'c', title: 'Thu Trang', description: 'Khách VIP' }]} empty={null} />
      <G.Section kind="list" layout="keyValue" title="Đang tải" isLoading items={[]} empty={null} />
      <G.Section kind="list" layout="keyValue" title="Đã tải" items={[{ id: 'a', title: 'Gói', value: 'Pro' }, { id: 'b', title: 'Hạn', value: '12/2026' }, { id: 'c', title: 'Chỗ', value: '5' }]} empty={null} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const lists = [...canvasElement.querySelectorAll<HTMLElement>('.starci-core-section-list')];
      expect(lists).toHaveLength(4);
      const heights = lists.map((list) => [...list.querySelectorAll<HTMLElement>(':scope > .starci-core-list-row')].map((row) => Math.round(row.getBoundingClientRect().height)));
      // Loading rows and loaded rows of one layout are one box, within 2px.
      for (const [loading, loaded] of [[heights[0], heights[1]], [heights[2], heights[3]]] as const) {
        expect(loading?.length).toBe(3);
        loading?.forEach((height, index) => expect(Math.abs(height - (loaded?.[index] ?? 0))).toBeLessThanOrEqual(2));
      }
    }, { timeout: 4000 });
  },
};

const Band = ({ tone, children }: { readonly tone: 'accent' | 'inverse'; readonly children: React.ReactNode }) => (
  <div data-story-band={tone} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 24, borderRadius: 16, background: tone === 'accent' ? 'var(--accent)' : 'var(--foreground)', color: tone === 'accent' ? 'var(--accent-foreground)' : 'var(--background)' }}>{children}</div>
);

/** A call-to-action band in the brand colour and a dark band: the primary is filled with the band's foreground, the secondary is an outline of it; every label keeps its contrast. */
export const ButtonOnBands: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxInlineSize: 640 }}>
      <Band tone="accent">
        <G.Button ground="accent" variant="primary" onPress={noop}>Dùng thử miễn phí</G.Button>
        <G.Button ground="accent" variant="border" href="#contact">Liên hệ tư vấn</G.Button>
      </Band>
      <Band tone="inverse">
        <G.Button ground="inverse" variant="primary" onPress={noop}>Bắt đầu</G.Button>
        <G.Button ground="inverse" variant="border" onPress={noop}>Xem bảng giá</G.Button>
      </Band>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const buttons = [...canvasElement.querySelectorAll<HTMLElement>('[data-grammar-button-ground]')];
      expect(buttons).toHaveLength(4);
      for (const button of buttons) {
        const band = getComputedStyle(button.closest('[data-story-band]') as HTMLElement).backgroundColor;
        const style = getComputedStyle(button);
        // The label keeps the band's own pair contrast (4.5:1 where the theme's pair reaches it) against what it is drawn on: the fill, or the band
        // through a transparent outline button. The theme owns the pair; the button only never loses contrast against it.
        const pair = textContrast(button.closest('[data-story-band]') as HTMLElement);
        expect(textContrast(button)).toBeGreaterThanOrEqual(Math.min(4.5, pair) - 0.05);
        // The primary is filled with the band's foreground; the others are an outline, transparent inside.
        if (button.getAttribute('data-grammar-variant') === 'primary') expect(style.backgroundColor).not.toBe(band);
        else expect([style.backgroundColor, style.borderTopWidth]).toEqual(['rgba(0, 0, 0, 0)', '1px']);
      }
    });
  },
};

/** An eager hero image with a high fetch priority: it is never held at opacity 0 and no shimmer covers it while it loads. */
export const ImageEagerPaint: Story = {
  render: () => (
    <div style={{ maxInlineSize: 480 }}>
      <G.Image src={placeholderImage('Hero')} alt="Ảnh bìa" ratio="16:9" loading="eager" fetchPriority="high" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const image = one(canvasElement, 'img.starci-core-image-element');
      expect(image.getAttribute('fetchpriority')).toBe('high');
      expect(image.getAttribute('loading')).toBe('eager');
      expect(getComputedStyle(image).opacity).toBe('1');
      expect(canvasElement.querySelector('.starci-core-image-skeleton')).toBeNull();
    });
  },
};

const LazyGrid = lazy(async () => ({ default: G.PaneGrid }));

/** A workspace page whose pane grid arrives as a lazy element (as a server component's client reference does): Page accepts it and renders the grid. */
export const PagePaneGridMarker: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <Suspense fallback={null}>
      <G.Page chrome="panes" header={{ title: 'Hộp thư' }}>
        <LazyGrid label="Hộp thư" areas={['list main']} columns={['standard', 'fill']}>
          <G.Pane area="list" surface label="Cuộc trò chuyện"><G.PaneSection><G.Text>Mai Phương</G.Text></G.PaneSection></G.Pane>
          <G.Pane area="main" label="Nội dung"><G.PaneSection><G.EmptyNotice message="Chọn một cuộc trò chuyện" media={{ icon: BellGlyph }} /></G.PaneSection></G.Pane>
        </LazyGrid>
      </G.Page>
    </Suspense>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-component="PaneGrid"]')).not.toBeNull();
      expect(G.PaneGrid.displayName).toBe('PaneGrid');
    }, { timeout: 4000 });
  },
};
