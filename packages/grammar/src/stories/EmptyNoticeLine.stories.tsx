import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * EMPTY STATES BY SCOPE (0.48.0, the illustration rule). A picture is only for an empty main region, onboarding or a page error. A no-match, a panel, a palette
 * with no result and an empty sub-section are the PLAIN LINE (`mark="none"`): one muted 14 line at the region's start edge, no tile, no picture, no card. A
 * page-level state is titled at the page-title tier, 18 / 26 / 500. A failed page offers its way back ("Về danh sách") beside the retry, and "Thử lại" has one
 * look everywhere a read failed: the outlined `alternative` button, in an `ErrorView` and in a negative `Alert` alike.
 */
const meta: Meta = { title: 'Media/Empty notice line, page title and the retry (0.48.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

/** A filter left nothing: the list's empty slot is the plain line, a muted 14 line on the start edge, with no icon tile and no card. */
export const PlainLineNoMatch: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <G.Section
        kind="list"
        title="Khách hàng"
        filter={<G.SearchField label="Tìm khách hàng" defaultValue="zzz" />}
        items={[]}
        empty={<G.EmptyNotice mark="none" message="Không có khách hàng nào khớp với “zzz”." actionLabel="Xoá bộ lọc" onAction={noop} actionVariant="border" />}
      />
    </div>
  ),
};

/** A page-level state (a first visit): the title is 18 / 26 / 500, one step above a region's 16. */
export const PageTitle18: Story = {
  render: () => <G.EmptyNotice scope="page" message="Chưa có luồng nào" description="Tạo luồng đầu tiên để NIVO làm thay bạn." actionLabel="Tạo luồng" onAction={noop} />,
};

/** A page whose record could not load: the retry, then the way back to the list, both at the md step. */
export const PageErrorBack: Story = {
  render: () => <G.EmptyNotice scope="page" isError message="Không tải được khách hàng" description="Kiểm tra kết nối rồi thử lại." actionLabel="Thử lại" onAction={noop} secondary={{ label: 'Về danh sách', href: '#customers' }} />,
};

/** "Thử lại" in a failed region and in a negative banner: one look (the outlined border), never the red fill. */
export const RetryOneLook: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxInlineSize: 560 }}>
      <G.Alert tone="negative" title="Không tải được đơn hàng" action={{ label: 'Thử lại', onAction: noop }} />
      <G.Section kind="list" title="Đơn hàng" items={[]} empty={null} error={{ message: 'Không tải được đơn hàng', actionLabel: 'Thử lại', onAction: noop }} />
    </div>
  ),
};
