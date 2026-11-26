import type { Meta, StoryObj } from '@storybook/react-vite';
import { lazy, Suspense } from 'react';
import * as G from '../common/index.js';
import { BellGlyph, noop, placeholderImage } from './fixtures.js';

/**
 * FIGURES, ROWS, BANDS AND PAGES (0.48.0). A figure that is a link shows a chevron and a hover fill at rest. On a phone a rows-list row puts its status chips
 * and its commands under the text, always, on the title's edge; its step numeral is regular weight. A list that loads with no row to measure draws placeholder
 * rows in its layout's shape. A Button on an accent or dark band takes `ground` and keeps its contrast. An eager Image paints before hydration and takes
 * `fetchPriority`. A `Page chrome="panes"` accepts a pane grid that arrives as a lazy (client) element.
 */
const meta: Meta = { title: 'Surfaces/Figures, rows, bands and pages (0.48.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

/** Three figures, the first two links: a linked figure draws no chevron or arrow, the whole cell is the target (pointer cursor, hover surface); the third is not a link. */
export const FigureLinkCue: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720 }}>
      <G.Section
        kind="figures"
        title="Hôm nay"
        items={[
          { id: "orders", term: "Đơn mới", value: 12, href: "#orders" },
          { id: "chats", term: "Tin chưa đọc", value: 5, href: "#chats" },
          { id: "rate", term: "Tỉ lệ chốt", value: "18", unit: "%" },
        ]}
      />
    </div>
  ),
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
};

/** An eager hero image with a high fetch priority: it is never held at opacity 0 and no shimmer covers it while it loads. */
export const ImageEagerPaint: Story = {
  render: () => (
    <div style={{ maxInlineSize: 480 }}>
      <G.Image src={placeholderImage('Hero')} alt="Ảnh bìa" ratio="16:9" loading="eager" fetchPriority="high" />
    </div>
  ),
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
};
