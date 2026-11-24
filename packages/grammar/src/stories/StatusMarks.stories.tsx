import type { Meta, StoryObj } from '@storybook/react-vite';
import { TablerCalendar, TablerMessages, TablerFileText, TablerMail, TablerSpeakerphone, TablerShoppingBag, TablerSparkles, TablerUserPlus } from '../core/leaf/Icon/tabler.js';
import * as G from '../common/index.js';
import { Matrix, State } from './fixtures.js';

/*
 * THE STATUS-MARK RULE (0.55.0, owner "chốt"). (B) the round 40px tile, (A) the inline status: a bare glyph and its words, no plate.
 * What the tile carries follows the reader's question:
 *   case 1 "how far along is it?" (the steps of ONE thing): the STATUS glyph in the state's tone; the step's name is the subject; time trails.
 *   case 2 "which thing is which?" (DIFFERENT things side by side): the SUBJECT icon on the state's plate; the status trails as (A).
 * Never two large circles side by side: one tile leads, (A) trails.
 */
const meta: Meta = { title: 'Status marks (0.55.0)' };
export default meta;
type Story = StoryObj;

const noop = () => undefined;

const RUN_STEPS: ReadonlyArray<G.TimelineItem> = [
  { id: 'read', title: 'Đọc tin nhắn của khách', status: 'done', timeLabel: '09:12' },
  { id: 'reply', title: 'Soạn câu trả lời', status: 'running', timeLabel: 'đang làm', isCurrent: true },
  { id: 'approve', title: 'Chờ bạn duyệt giá', status: 'waiting', timeLabel: 'từ 09:14', isAttention: true, state: 'cautionary' },
  { id: 'send', title: 'Gửi báo giá qua Zalo', status: 'error', timeLabel: '09:15', description: 'Zalo chưa kết nối lại.' },
  { id: 'note', title: 'Ghi chú vào hồ sơ khách', status: 'skipped', timeLabel: 'bỏ qua' },
  { id: 'follow', title: 'Nhắc lại sau 2 ngày', status: 'notRun' },
];

/** Case 1: a Timeline (a run's step list), a Stepper, a setup checklist and the all-clear, every state. */
export const HowFarAlong: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <State label="Timeline: a run's steps, every state (done, running, waiting, error, skipped, not run)" direction="column">
        <G.Timeline label="Các bước của lượt trả lời" items={RUN_STEPS} />
      </State>
      <State label="Stepper (markers, horizontal): complete, current (the reader's own step: its number), error, paused, upcoming" direction="column">
        <G.Stepper label="Thiết lập cửa hàng" currentStepId="price" steps={[
          { id: 'shop', label: 'Thông tin cửa hàng' },
          { id: 'price', label: 'Bảng giá' },
          { id: 'zalo', label: 'Kết nối Zalo', state: 'error' },
          { id: 'pay', label: 'Thanh toán', state: 'paused' },
          { id: 'go', label: 'Bắt đầu' },
        ]} />
      </State>
      <State label="Stepper (markers, vertical)" direction="column">
        <G.Stepper label="Thiết lập cửa hàng" orientation="vertical" currentStepId="price" steps={[
          { id: 'shop', label: 'Thông tin cửa hàng', description: 'Tên, địa chỉ, giờ mở cửa' },
          { id: 'price', label: 'Bảng giá', description: 'Thêm ít nhất một sản phẩm' },
          { id: 'zalo', label: 'Kết nối Zalo', state: 'error', description: 'Phiên đăng nhập hết hạn' },
          { id: 'go', label: 'Bắt đầu' },
        ]} />
      </State>
      <State label="A setup checklist (EmptyNotice steps): done, current, to do" direction="column">
        <G.EmptyNotice message="Bắt đầu với NIVO" description="Ba bước để trợ lý trả lời khách." steps={[
          { id: 'a', label: 'Kết nối Zalo', isDone: true },
          { id: 'b', label: 'Thêm bảng giá', description: 'Trợ lý dùng giá này để báo khách.' },
          { id: 'c', label: 'Mời nhân viên' },
        ]} actionLabel="Thêm bảng giá" onAction={noop} />
      </State>
      <State label="The all-clear: the one check with no subject of its own" direction="column">
        <G.EmptyNotice isAllClear message="Không có gì cần bạn" description="Mọi tin nhắn đã được trả lời." />
      </State>
    </Matrix>
  ),
};

/** Case 2: different things side by side, the subject icon on the state's plate, the status trailing as (A). */
export const WhichIsWhich: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <State label="A run list: the workflow's icon on the state's plate, the status trails as glyph + words + time" direction="column">
        <G.Section kind="list" title="Việc trợ lý làm hôm nay" empty={null} items={[
          { id: 'r1', title: 'Trả lời khách hỏi giá', description: 'Chị Lan · Zalo', leading: { icon: TablerMessages, state: 'done' }, value: <G.InlineStatus state="done" label="Đã xong" meta="09:12" /> },
          { id: 'r2', title: 'Tạo đơn hàng', description: 'Anh Minh · Facebook', leading: { icon: TablerShoppingBag, state: 'running' }, value: <G.InlineStatus state="running" label="Đang chạy" meta="1 phút" /> },
          { id: 'r3', title: 'Gửi báo giá', description: 'Chị Hoa · Zalo', leading: { icon: TablerFileText, state: 'waiting' }, value: <G.InlineStatus state="waiting" label="Chờ bạn duyệt" meta="5 phút" /> },
          { id: 'r4', title: 'Gửi email cảm ơn', description: 'Khách mới', leading: { icon: TablerMail, state: 'error' }, value: <G.InlineStatus state="error" label="Lỗi" meta="09:20" /> },
          { id: 'r5', title: 'Đăng bài khuyến mãi', description: 'TikTok', leading: { icon: TablerSpeakerphone, state: 'skipped' }, value: <G.InlineStatus state="skipped" label="Bỏ qua" /> },
          { id: 'r6', title: 'Chào khách mới', description: 'Lúc 18:00', leading: { icon: TablerUserPlus, state: 'notRun' }, value: <G.InlineStatus state="notRun" label="Chưa chạy" /> },
        ]} />
      </State>
      <State label="A chat run card (MessageCard): the workflow's icon on its state's plate, the status as (A) in the chip slot">
        <G.MessageCard avatar={<G.IconTile source={TablerFileText} state="waiting" />} title="Báo giá cho chị Hoa" chip={<G.InlineStatus state="waiting" label="Chờ bạn duyệt" />} body="3 sản phẩm, tổng 1.250.000đ." actions={[{ id: 'ok', label: 'Duyệt và gửi', kind: 'primary', onPress: noop }, { id: 'open', label: 'Xem chi tiết', kind: 'open', onPress: noop }]} meta="09:14" />
      </State>
      <State label="IconTile: one round 40px plate; identity tiles in their tone, then every status, then a subject on every state">
        <G.IconTile source={TablerMessages} />
        <G.IconTile source={TablerMessages} tone="accent" />
        {G.MARK_STATES.map((state) => <G.IconTile key={state} state={state} />)}
        {G.MARK_STATES.map((state) => <G.IconTile key={`s-${state}`} source={TablerShoppingBag} state={state} />)}
      </State>
      <State label="InlineStatus (A): every state">
        {G.MARK_STATES.map((state) => <G.InlineStatus key={state} state={state} label={{ done: 'Đã xong', running: 'Đang chạy', waiting: 'Chờ duyệt', error: 'Lỗi', skipped: 'Bỏ qua', notRun: 'Chưa chạy' }[state]} />)}
      </State>
    </Matrix>
  ),
};

/**
 * The Alert (owner: "alert nói rõ là icon 24 soft-foreground trên nền soft thôi mà? và button phải là màu tương ứng, ko phải border"): the bare 24px
 * Heroicon in the soft foreground on the soft box, no tile; its action Button SOLID in the banner's tone. Every tone, each with an action.
 */
export const AlertMarks: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      {(['informative', 'accent', 'affirmative', 'cautionary', 'negative', 'pending', 'neutral', 'unavailable'] as const).map((tone) => (
        <G.Alert
          key={tone}
          tone={tone}
          title={{ informative: 'Có bản cập nhật mới', accent: 'Chào mừng bạn đến với NIVO', affirmative: 'Đã kết nối Zalo', cautionary: 'Sắp hết lượt tin nhắn', negative: 'Không gửi được tin nhắn', pending: 'Đang đồng bộ đơn hàng', neutral: 'Chưa có dữ liệu tuần này', unavailable: 'Tính năng chưa mở' }[tone]}
          description="Câu mô tả ngắn, 14/20 ở 400."
          action={{ label: { informative: 'Cập nhật', accent: 'Bắt đầu', affirmative: 'Xem kênh', cautionary: 'Mua thêm', negative: 'Thử lại', pending: 'Xem', neutral: 'Thêm dữ liệu', unavailable: 'Tìm hiểu' }[tone], onAction: noop }}
        />
      ))}
    </Matrix>
  ),
};

/** The "AI" Chip after an agent's name is small (caption 12/16, on the name's baseline): in a ListRow title and in a card head. */
export const AgentNameSmallChip: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <State label="ListRow titles" direction="column">
        <G.Section kind="list" title="Trợ lý" empty={null} items={[
          { id: 'sales', title: 'Sales', isAgent: true, description: 'Trả lời khách hỏi giá', value: <G.InlineStatus state="running" label="Đang làm việc" /> },
          { id: 'care', title: 'Chăm sóc khách', isAgent: true, description: 'Nhắc lịch hẹn' },
          { id: 'lan', title: 'Nguyễn Thị Lan', description: 'Quản lý cửa hàng' },
        ]} />
      </State>
      <State label="A card head" direction="column">
        <G.SurfaceCard label="Sales" isAgent><G.Text>Tuần này: 42 đơn chốt.</G.Text></G.SurfaceCard>
      </State>
    </Matrix>
  ),
};

/** RadioGroup appearance="rows": the chosen row is quiet (the dot says which; the edge at most --accent-border, never dark or thicker). */
export const RadioRowsChosen: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <State label="the chosen row" direction="column">
        <G.RadioGroup label="Gói dịch vụ" appearance="rows" defaultValue="team" options={[
          { value: 'solo', label: 'Cá nhân', description: '1 trợ lý, 1 kênh' },
          { value: 'team', label: 'Nhóm', description: '5 trợ lý, mọi kênh' },
          { value: 'shop', label: 'Cửa hàng', description: 'Không giới hạn' },
        ]} />
      </State>
    </Matrix>
  ),
};

const people: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'lan', name: 'Nguyễn Thị Lan', seed: 'm-lan' },
  { id: 'minh', name: 'Trần Văn Minh', seed: 'm-minh' },
  { id: 'hoa', name: 'Đỗ Thị Hoa', seed: 'm-hoa' },
  { id: 'an', name: 'Lê Văn An', seed: 'm-an' },
  { id: 'binh', name: 'Phạm Bình', seed: 'm-binh' },
];
const channels: ReadonlyArray<G.AvatarGroupItem> = [
  { id: 'zalo', name: 'Zalo', mark: { logo: <TablerMessages /> } },
  { id: 'fb', name: 'Facebook', mark: { logo: <TablerSpeakerphone />, tone: 'strong' } },
  { id: 'mail', name: 'Email', mark: { logo: <TablerMail /> } },
  { id: 'shop', name: 'Shopee', mark: { logo: <TablerShoppingBag />, tone: 'strong' } },
  { id: 'tt', name: 'TikTok', mark: { logo: <TablerUserPlus /> } },
];
const more = (count: number) => `${count} nữa`;

/** EntitySummaryCard: the owner's summary of one agent: name, AI Chip, status; role; "Tuần này" with three figures; one "needs you" line; channels and people. */
export const EntitySummary: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <G.Grid kind="cards">
        <G.EntitySummaryCard
          name="Sales AI" isAgent role="Trả lời khách hỏi giá và chốt đơn trên Zalo, Facebook."
          status={{ state: 'running', label: 'Đang làm việc' }} periodLabel="Tuần này"
          figures={[
            { label: 'Đơn chốt', value: '42', delta: { text: '+12% so với tuần trước', direction: 'up', goodWhen: 'up' } },
            { label: 'Doanh thu', value: '18,4tr', delta: { text: '+3,1tr', direction: 'up', goodWhen: 'up' } },
            { label: 'Khách phàn nàn', value: '3', delta: { text: '+2', direction: 'up', goodWhen: 'down' } },
          ]}
          needsYou={{ label: '3 báo giá chờ bạn duyệt' }}
          channels={{ label: 'Kênh', items: channels, overflowLabel: more, max: 4 }}
          people={{ label: 'Người phụ trách', items: people, overflowLabel: more, max: 4 }}
          href="#sales" linkLabel="Mở Sales AI"
        />
        <G.EntitySummaryCard
          name="Chăm sóc khách" isAgent role="Nhắc lịch hẹn và hỏi thăm khách sau khi mua."
          status={{ state: 'waiting', label: 'Tạm dừng' }} periodLabel="Tuần này"
          figures={[
            { label: 'Lịch hẹn giữ được', value: '27' },
            { label: 'Khách quay lại', value: '9', delta: { text: 'như tuần trước', direction: 'flat', goodWhen: 'up' } },
            { label: 'Đánh giá 5 sao', value: '14' },
          ]}
          channels={{ label: 'Kênh', items: channels.slice(0, 2), overflowLabel: more }}
          href="#care" linkLabel="Mở Chăm sóc khách"
        />
        <G.EntitySummaryCard
          name="Sales AI" isAgent role=" " status={{ state: 'done', label: ' ' }} periodLabel=" "
          figures={[{ label: ' ', value: ' ' }, { label: ' ', value: ' ' }, { label: ' ', value: ' ' }]}
          channels={{ label: 'Kênh', items: channels, overflowLabel: more }}
          href="#loading" linkLabel="Mở" isLoading
        />
      </G.Grid>
    </Matrix>
  ),
};

/*
 * THE THREE STATUS GLYPHS (owner 2026-11-22, overview-v2): circle-check done, circle-x error, the plain circle waiting, skipped and not run (the
 * colour tells them apart), spinning while running. The round 40px tile (B) carries their bare equivalents (no circle in a circle).
 */
export const TileGlyphVariants: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <State label="The 40px tile: the bare three (check, x, the small ring; the ring spins while running)">
        {G.MARK_STATES.map((state) => <G.IconTile key={state} state={state} />)}
      </State>
      <State label="The inline status: circle-check, circle-x, the plain circle (spinning while running)">
        {G.MARK_STATES.map((state) => <G.InlineStatus key={state} state={state} label={{ done: 'Đã xong', running: 'Đang chạy', waiting: 'Chờ duyệt', error: 'Lỗi', skipped: 'Bỏ qua', notRun: 'Chưa chạy' }[state]} />)}
      </State>
      <State label="A card that waits on the reader: tone=warning draws the edge in --warning-border; a tile names an agent with isAgent">
        <G.SurfaceCard label="Báo giá chờ duyệt" tone="warning"><G.InlineStatus state="waiting" label="Chờ bạn duyệt" meta="5 phút" /></G.SurfaceCard>
        <G.SurfaceCard kind="tile" name="Sales AI" isAgent byline="Trả lời khách hỏi giá" />
        <G.Progress label="Đang đồng bộ đơn hàng" value={40} tone="success" />
      </State>
    </Matrix>
  ),
};

/*
 * THE ICON SIZE TABLE (owner 2026-11-23, ramps.css): an inline status mark is text-sized, 1em of the words it sits beside: 14 by its own 14px
 * words, 12 inside a caption line; never a per-call size. An icon beside text, in a chip or a badge is 20.
 */
export const IconSizes: Story = {
  render: () => (
    <Matrix maxWidth={880}>
      <State label="InlineStatus beside 14px text: a 14px glyph">
        {G.MARK_STATES.map((state) => <G.InlineStatus key={state} state={state} label={{ done: 'Đã xong', running: 'Đang chạy', waiting: 'Chờ duyệt', error: 'Lỗi', skipped: 'Bỏ qua', notRun: 'Chưa chạy' }[state]} meta="09:12" />)}
      </State>
      <State label="InlineStatus in a 12px caption line: a 12px glyph">
        <G.Text role="caption">Cập nhật lúc 09:12 · <G.InlineStatus state="done" label="Đã xong" /></G.Text>
        <G.Text role="caption">Đồng bộ · <G.InlineStatus state="running" label="Đang chạy" /></G.Text>
        <G.Text role="caption">Zalo · <G.InlineStatus state="error" label="Lỗi" /></G.Text>
      </State>
      <State label="A Badge with an icon: the 20px chip icon">
        <G.Badge tone="accent" startContent={<G.Icon source={TablerSparkles} usage="control" />}>Mới</G.Badge>
        <G.Badge tone="info" startContent={<G.Icon source={TablerCalendar} usage="control" />}>Hôm nay</G.Badge>
      </State>
    </Matrix>
  ),
};
