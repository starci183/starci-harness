import type { Meta, StoryObj } from '@storybook/react-vite';
import * as G from '../common/index.js';
import { noop } from './fixtures.js';

/**
 * THE CHAT FRAME CARD (0.60.0, owner 2026-11-26, NIVO feedback 3, 4). A structured message frame (a new lead, a contact that is overdue, a booking made, a job
 * cancelled, a system message) is ONE compact card: the title, a status dot only for a real state, the field and value rows, up to three actions (the first is the
 * card's primary), a muted meta line. A kind the app does not know is its text line, which reads safe Markdown; a text bubble reads Markdown as well. An empty thread
 * stands in the middle of the message area.
 */
const meta: Meta = { title: 'Navigation & Data/Chat frame cards', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

const cards: ReadonlyArray<{ readonly kind: string; readonly card: G.MessageFrameCard; readonly text: string }> = [
  {
    kind: 'lead.new',
    text: 'Khách mới: Mai Phương, từ Zalo',
    card: {
      title: 'Khách mới: Mai Phương',
      fields: [{ label: 'Kênh', value: 'Zalo' }, { label: 'Dịch vụ', value: 'Gội đầu dưỡng sinh' }, { label: 'Hẹn', value: 'Thứ Bảy, 10:00' }],
      actions: [{ id: 'open', label: 'Mở hồ sơ', onPress: noop }, { id: 'reply', label: 'Trả lời', onPress: noop }],
      meta: '14:16',
    },
  },
  {
    kind: 'lead.overdue',
    text: 'Quá hạn liên hệ: Quốc Bảo',
    card: {
      title: 'Quá hạn liên hệ: Quốc Bảo',
      status: { tone: 'danger', label: 'Quá hạn' },
      fields: [{ label: 'Trễ', value: '2 ngày' }, { label: 'Phụ trách', value: 'Hiền Mai' }],
      actions: [{ id: 'call', label: 'Gọi lại', onPress: noop }, { id: 'snooze', label: 'Hoãn 1 ngày', onPress: noop }, { id: 'drop', label: 'Bỏ qua', onPress: noop }],
      meta: '09:02',
    },
  },
  {
    kind: 'booking.created',
    text: 'Đã ghi lịch: Mai Phương, thứ Bảy 10:00',
    card: { title: 'Đã ghi lịch', fields: [{ label: 'Khách', value: 'Mai Phương' }, { label: 'Giờ', value: 'Thứ Bảy, 10:00' }], actions: [{ id: 'open', label: 'Xem lịch', href: '#calendar' }], meta: '14:18' },
  },
  {
    kind: 'job.cancelled',
    text: 'Việc đã huỷ: nhắc lịch hẹn',
    card: { title: 'Việc đã huỷ', status: { tone: 'neutral', label: 'Đã huỷ' }, fields: [{ label: 'Việc', value: 'Nhắc lịch hẹn' }, { label: 'Lúc', value: '14:16' }], actions: [{ id: 'view', label: 'Xem việc', href: '#job' }] },
  },
  {
    kind: 'system.job_paused',
    text: 'Việc tạm dừng: không chuyển được lượt chạy',
    card: { title: 'Việc tạm dừng', status: { tone: 'warning', label: 'Tạm dừng' }, fields: [{ label: 'Lý do', value: 'Không chuyển được 1 trong 1 lượt chạy' }], actions: [{ id: 'retry', label: 'Chạy lại', onPress: noop }, { id: 'open', label: 'Mở việc', href: '#job' }] },
  },
];

/** Every kind through the one card; the dot only on the states (overdue, cancelled, paused); at most three actions, the first primary. */
export const FrameCards: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxInlineSize: 720 }}>
      {cards.map((frame) => <G.MessageFrame key={frame.kind} kind={frame.kind} card={frame.card} text={frame.text} author="NIVO" avatar={<G.Avatar name="NIVO" size="md" />} />)}
    </div>
  ),
};

/** A kind the app does not know (and a card with no title) is its text line, read as safe Markdown: bold, italic, a list, inline code, a link; no raw HTML. */
export const UnknownKindAndMarkdown: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxInlineSize: 720 }}>
      <G.MessageFrame kind="thing.never.seen" text={'Có **một việc mới** cần xem. Mở [bảng việc](https://example.com/jobs) hoặc chạy `lead.sync`.'} author="NIVO" avatar={<G.Avatar name="NIVO" size="md" />} />
      <G.MessageFrame kind="lead.new" card={{ title: ' ' }} text="Khách mới vào từ Zalo" author="NIVO" avatar={<G.Avatar name="NIVO" size="md" />} />
      <G.MessageBubble
        author="Chăm sóc khách"
        isAgent
        avatar={<G.Avatar name="Chăm sóc khách" kind="agent" size="md" />}
        format="markdown"
        body={'Đã xử lý **3 khách** hôm nay:\n\n- *Mai Phương* đã đặt lịch\n- Quốc Bảo chờ báo giá\n- Lan Anh <script>alert(1)</script> chưa trả lời\n\n1. Gọi lại Quốc Bảo\n2. Nhắc Lan Anh'}
      />
      <G.MessageBubble side="outgoing" avatar={<G.Avatar name="Hiền Mai" size="md" />} format="markdown" body="Ok, **gửi báo giá** cho Quốc Bảo, rồi xem [lịch](https://example.com/cal)." />
    </div>
  ),
};

/** An empty thread: the notice stands in the middle of the message area on both axes, not at the foot with the messages. */
export const EmptyThreadCentred: Story = {
  render: () => (
    <div style={{ height: 520 }}>
      <G.ChatFrame
        label="Phòng Chung"
        header={<G.PaneHeader title="Chung" mark={<G.AvatarGroup label="Chung" layout="grid" items={[{ id: 'a', name: 'Lan Nguyễn' }, { id: 'b', name: 'Mai Trần' }]} overflowLabel={(count) => `${count} người khác`} />} description="2 thành viên" />}
        empty={<G.EmptyNotice message="Phòng này chưa có tin nhắn" description="Nhắn một câu để bắt đầu." />}
        footer={<G.Textarea label="Tin nhắn" isLabelHidden placeholder="Nhắn cho cả phòng" onSubmitShortcut={noop} send={{ label: 'Gửi', onPress: noop }} />}
      />
    </div>
  ),
};
