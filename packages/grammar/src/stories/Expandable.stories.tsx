import type { Meta, StoryObj } from "@storybook/react-vite"
import * as G from "../common/index.js"

const meta: Meta = { title: "Compositions/Expandable" }
export default meta
type Story = StoryObj

const LONG =
    "Bài đăng giới thiệu combo chăm da mặt tháng 12: liệu trình 6 buổi, tặng một buổi massage cổ vai gáy, áp dụng cho khách đặt lịch trước ngày 15. " +
    "Hình ảnh lấy từ bộ ảnh studio tháng 11, chú thích nhắc chi nhánh Quận 3 và số hotline. Lịch đăng: 19:00 tối thứ Sáu, kèm bình luận ghim với liên kết đặt lịch."

/** `clamp` folds a long text to three lines behind "Xem thêm"; a text that fits draws no toggle. `details` hides a raw error under "Chi tiết kỹ thuật". */
export const Kinds: Story = {
    render: () => (
        <G.Stack gap="section">
            <G.Expandable kind="clamp" content={LONG} expandLabel="Xem thêm" collapseLabel="Thu gọn" />
            <G.Expandable kind="clamp" content="Một dòng ngắn, không cần nút." expandLabel="Xem thêm" collapseLabel="Thu gọn" />
            <G.Expandable kind="details" content={'facebook.post failed: 400 {"error":{"code":190,"message":"Error validating access token"}}'} expandLabel="Chi tiết kỹ thuật" collapseLabel="Ẩn chi tiết kỹ thuật" />
        </G.Stack>
    ),
}

/** The box skeletons: each takes the exact box of what it stands for, the same fill, no border. */
export const SkeletonBoxes: Story = {
    render: () => (
        <G.Stack gap="row">
            <G.Skeleton shape="field" />
            <G.Skeleton shape="field" width="12rem" />
            <G.Cluster gap="inline">
                <G.Skeleton shape="button" size="md" />
                <G.Skeleton shape="button" size="sm" width="4rem" />
                <G.Skeleton shape="switch" kind="compact" />
                <G.Skeleton shape="switch" kind="toggle" />
                <G.Skeleton shape="circle" size="md" />
            </G.Cluster>
            <G.Skeleton shape="box" width="60%" height="0.875rem" radius="md" />
            <G.Skeleton shape="text" lines={2} />
        </G.Stack>
    ),
}
