import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';

/**
 * ROW PADDING AND THE LABEL / VALUE TIERS (0.48.0, owner 2026-11-19).
 * A list row is a band with its own padding, px-4 (16 inline), p-4 where it touches the list's edge (the first row's top, the last row's bottom) and p-3 (12) where it touches a divider, in a list that stands on the section title's column with no border: the text is indented 16 under the title, the hairline and the
 * hover fill (the secondary surface, unchanged) run from the title's edge to the list's end. Hover and press never transform a row. A label (a row title, a key, a settings title) is 16 / 400 in the primary colour; the content under it (a description, a value, a hint) is 14 in the secondary colour; a section title is 16 / 500 and the page title 18 / 500. An empty list is an icon, a 16 title and a 12 hint.
 */
const meta: Meta = { title: 'Surfaces/Row padding and label tiers' };
export default meta;
type Story = StoryObj;

const ROWS = [
  { id: 'a', title: 'Luồng 1', description: 'Khi có tin Zalo mới', onPress: () => undefined },
  { id: 'b', title: 'Luồng 2', description: 'Mỗi sáng 8:00', href: '#flow-2' },
];

const Rows = () => (
  <div style={{ width: 460 }}>
    <G.Section kind="list" title="Luồng" count={2} items={ROWS} empty={<G.EmptyNotice message="Empty" />} />
  </div>
);

/** The row is a padded band: 12 block, 16 inline; the list stands on the title's column, so the text is indented under the title while the divider and the hover fill run from the title's edge to the list's end. No border around the list. */
export const PaddedDividedRows: Story = {
  render: () => <Rows />,
};

export const EmptyList: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section kind="list" title="Các lượt chạy" items={[]} empty={<G.EmptyNotice message="Chưa có lượt chạy nào" description="Lượt chạy mới sẽ hiện ở đây." />} />
    </div>
  ),
};

export const FactsGrid: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <G.Section title="Thông tin">
        <G.DescriptionList
          layout="grid"
          items={[
            { id: 'a', term: 'Người được giao', description: 'Tất cả · 1 người' },
            { id: 'b', term: 'Kết nối đã gắn', description: 'Zalo OA · 1 tài khoản' },
            { id: 'c', term: 'Nguồn', description: 'nivo-web.webdesk · v7' },
            { id: 'd', term: 'Lượt chạy hôm nay', description: '12' },
          ]}
        />
      </G.Section>
    </div>
  ),
};

export const LabelOverValue: Story = {
  render: () => (
    <div style={{ width: 460, display: 'grid', gap: 24 }}>
      <G.Section title="Người được giao">
        <G.DescriptionList
          layout="stacked"
          items={[
            { id: 'a', term: 'Được giao cho', description: 'Tất cả · 1 người' },
            { id: 'b', term: 'Kích hoạt', description: 'Khi có tin Zalo mới' },
            { id: 'c', term: 'Nguồn', description: 'nivo-web.webdesk · v7' },
          ]}
        />
      </G.Section>
      <G.Section kind="list" layout="keyValue" title="Chi tiết" items={[{ id: 'k', title: 'Khách hàng', value: 'Maria Garcia' }]} empty={<G.EmptyNotice message="Empty" />} />
    </div>
  ),
};

/** A settings list: rows flush with the section title (no indent), a 16 title, its 14 hint and a control at the end. */
export const SettingsRows: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <G.Section
        kind="list"
        layout="settings"
        title="Cài đặt"
        items={[{ id: 's', title: 'Hiện lượt chạy thử', description: 'Gồm cả các lượt chạy do bạn bấm thử.', control: <G.Switch label="Hiện lượt chạy thử" isLabelHidden /> }]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
};

/**
 * The right edges line up: a command button, a chevron and a settings control all end at the same inset from the list's end (0.48.0). On a phone (a list of 28rem or
 * less) the command stands under the text instead (batch 174), so the edges are compared on a wider list only.
 */
export const TrailingEdges: Story = {
  render: () => (
    <div style={{ maxWidth: 640, display: 'grid', gap: 32 }}>
      <G.Section
        kind="list"
        title="Luồng"
        items={[
          { id: 'a', title: 'Luồng 1', description: 'Khi có tin Zalo mới', meta: { text: '3 lượt chạy xong' }, action: { label: 'Mở quy trình', variant: 'border', href: '#a' }, onPress: () => undefined },
          { id: 'b', title: 'Luồng 2', description: 'Mỗi sáng 8:00', href: '#b' },
        ]}
        empty={<G.EmptyNotice message="Empty" />}
      />
      <G.Section
        kind="list"
        layout="settings"
        title="Cài đặt"
        items={[{ id: 's', title: 'Hiện lượt chạy thử', description: 'Gồm cả các lượt chạy do bạn bấm thử.', control: <G.Switch kind="compact" label="Hiện lượt chạy thử" isLabelHidden /> }]}
        empty={<G.EmptyNotice message="Empty" />}
      />
    </div>
  ),
};

/** Body copy longer than two lines is clamped, with a "Xem thêm" command that opens it and a "Thu gọn" that closes it. */
export const ClampedBody: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <G.ExpandableText
        moreLabel="Xem thêm"
        lessLabel="Thu gọn"
        text="Lượt chạy thử mặc định bị ẩn khỏi danh sách và số đếm. Bật công tắc này để đưa chúng vào, kể cả các lượt chạy do bạn bấm thử trong lúc cấu hình luồng, để bạn kiểm tra từng bước trước khi chạy thật cho khách."
      />
    </div>
  ),
};
