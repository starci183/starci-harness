import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import * as G from '../common/index.js';

/**
 * 0.37.21: three narrow-width fixes. A card or section label that carries a count chip or fact keeps its text at 390 (the row stays a row, the label
 * truncates); a Progress used as a list row's control has an intrinsic width; stacked panes sit one after another with no blank band under the aside.
 */
const meta: Meta = { title: 'Narrow fixes (0.37.21)', parameters: { grammar: { bleed: false } } };
export default meta;
type Story = StoryObj;

const ROWS = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, title: `Nền tảng ${i + 1}`, description: '0/3 concept đã chứng minh', href: `#r${i}` }));

export const LabelWithCountAt390: Story = {
  name: 'Label with count or fact at 390',
  render: () => (
    <div data-host style={{ inlineSize: 390, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <G.SurfaceCard kind="list" label="Milestone" count={11} items={ROWS} empty={<G.EmptyNotice message="Trống" />} />
      <G.SurfaceCard kind="list" label="Dự án của bạn" fact="2 đang chạy" items={ROWS} empty={<G.EmptyNotice message="Trống" />} />
      <G.SurfaceCard kind="list" label="Một tên nhóm rất dài để thử cắt bớt chữ ở chiều rộng hẹp" count={3} items={ROWS} empty={<G.EmptyNotice message="Trống" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const labels = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-grammar-surface-label="true"]'));
      expect(labels.length).toBe(3);
      for (const row of labels) {
        const text = row.firstElementChild as HTMLElement;
        expect(text.getBoundingClientRect().height).toBeGreaterThan(8);
        expect(text.getBoundingClientRect().width).toBeGreaterThan(20);
        const chip = row.querySelector<HTMLElement>('[data-grammar-section-count], [data-grammar-surface-fact]') ?? (row.children[1] as HTMLElement);
        // The chip or fact stands after the label on the same line.
        expect(chip.getBoundingClientRect().left).toBeGreaterThanOrEqual(text.getBoundingClientRect().right - 1);
      }
    });
  },
};

export const ProgressAsRowControl: Story = {
  name: 'Progress as a row control',
  render: () => (
    <div data-host style={{ inlineSize: 390 }}>
      <G.SurfaceCard
        kind="list"
        label="Milestone"
        items={ROWS.map((row, i) => ({ ...row, control: <G.Progress label={`Tiến độ ${row.title}`} value={(i + 1) * 30} /> }))}
        empty={<G.EmptyNotice message="Trống" />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const bars = Array.from(canvasElement.querySelectorAll<HTMLElement>('.starci-core-list-row-control [data-component="Progress"]'));
      expect(bars.length).toBe(3);
      for (const bar of bars) expect(bar.getBoundingClientRect().width).toBeGreaterThanOrEqual(48);
    });
  },
};

const MANY = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, title: `Milestone ${i + 1}`, description: '0/3 concept đã chứng minh', href: `#m${i}` }));
const ASIDE_ROWS = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, title: `Mục ${i + 1}`, description: 'Mô tả của mục nằm ở dòng thứ hai' }));
const StackedPage = () => (
  <G.Page chrome="panes" layout="workspace" header={{ title: 'Shop bán sách' }}>
    <G.PaneGrid label="Chi tiết" areas={{ base: ['aside', 'main'], wide: ['main aside'] }} columns={{ base: ['fill'], wide: ['fill', 'standard'] }}>
      <G.Pane area="aside" surface label="Thông tin">
        <G.PaneSection><G.Section kind="list" title="Kho mã" items={ASIDE_ROWS} empty={<G.EmptyNotice message="Trống" />} /></G.PaneSection>
      </G.Pane>
      <G.Pane area="main" scroll label="Nội dung">
        <G.PaneSection gap="section"><G.SurfaceCard kind="list" label="Milestone" count={11} items={MANY} empty={<G.EmptyNotice message="Trống" />} /></G.PaneSection>
      </G.Pane>
    </G.PaneGrid>
  </G.Page>
);

export const StackedPanesNoGap: Story = {
  name: 'Stacked panes, no blank band (390)',
  parameters: { layout: 'fullscreen' },
  render: () => <StackedPage />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const aside = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="aside"]');
      const well = canvasElement.querySelector<HTMLElement>('[data-grammar-pane-area="main"]');
      if (aside === null || well === null) throw new Error('both panes render');
      const gap = well.getBoundingClientRect().top - aside.getBoundingClientRect().bottom;
      expect(gap).toBeLessThanOrEqual(40);
    });
  },
};
