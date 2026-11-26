import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { STEP_CARD, StepCard, stepCardHeight, type StepCardModeLabels, type StepCardRow } from '../core/ext/graph/index.js';
import '../core/ext/graph/styles.css';

/**
 * THE STEP CARD (0.64.2, the owner's node design 2026-11-27). Every card is 200 x 96 with the step's glyph on its kind's tinted tile; the mode badge sits at
 * the bottom-right (auto none, "Hỏi trước" amber, "Studio" purple, "Tự làm" grey). A control step lists its ways out as rows (8px by 12px, a 0.5px seam
 * above each, the first too), each with its tone's dot and its own port on the right edge; during a replay the taken row lights up and the others fade.
 * The border, the run status on it and the handles are the canvas's: each story draws a plain frame and a dot where the canvas's handle goes.
 * Proof is by reading (GRAMMAR-NO-TESTS): each story names what to look at.
 */
const meta: Meta = { title: 'Graph/Step card (0.64.2)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const MODES: StepCardModeLabels = { ask: 'Hỏi trước', studio: 'Studio', manual: 'Tự làm' };

/** A stand-in for the canvas: the card's border and a dot where its handle stands. */
const Frame = ({ rows = 0, children }: { readonly rows?: number; readonly children: ReactNode }) => (
  <div style={{ inlineSize: STEP_CARD.width, blockSize: stepCardHeight(rows), border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>{children}</div>
);
const port = () => <span style={{ position: 'absolute', insetBlockStart: '50%', insetInlineEnd: -4, inlineSize: 8, blockSize: 8, borderRadius: 4, background: 'var(--foreground)', transform: 'translateY(-50%)' }} />;
const Row = ({ children }: { readonly children: ReactNode }) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>{children}</div>;

/** Look at: all seven kinds the same size, each glyph on its tint; the badge only on ask, studio and manual. */
export const Kinds: Story = {
  render: () => (
    <Row>
      <Frame><StepCard kind="action" title="Gửi tin xác nhận" subtitle="Zalo OA · khách" /></Frame>
      <Frame><StepCard kind="ai" title="Soạn câu trả lời" subtitle="AI · lead-care" mode="studio" modeLabels={MODES} /></Frame>
      <Frame><StepCard kind="wait" title="Chờ khách chuyển cọc" subtitle="tối đa 24 giờ" /></Frame>
      <Frame><StepCard kind="approval" title="Duyệt hoàn cọc" subtitle="Quản lý" mode="ask" modeLabels={MODES} /></Frame>
      <Frame><StepCard kind="code" title="Tính tiền cọc" subtitle="deposit.ts" /></Frame>
      <Frame><StepCard kind="action" title="Gọi lại cho khách" subtitle="Lễ tân" mode="manual" modeLabels={MODES} /></Frame>
      <Frame><StepCard kind="end" title="Kết thúc: đã cọc" /></Frame>
    </Row>
  ),
};

const IF: readonly StepCardRow[] = [
  { id: 'yes', label: 'đã chuyển cọc → Gửi xác nhận', tone: 'main' },
  { id: 'no', label: 'còn lại → Gửi nhắc', tone: 'else' },
];
const SWITCH: readonly StepCardRow[] = [
  { id: 'vip', label: '= "vip" → Gọi ngay', tone: 'main' },
  { id: 'late', label: '= "trễ hẹn" → Nhắc lịch', tone: 'warning' },
  { id: 'else', label: 'còn lại → Gửi mẫu chung', tone: 'else' },
];
const LOOP: readonly StepCardRow[] = [
  { id: 'body', label: 'mỗi vòng → Tư vấn tiếp', tone: 'back' },
  { id: 'next', label: 'dừng khi: khách chốt lịch', tone: 'stop' },
  { id: 'exhausted', label: 'hết vòng → Báo quản lý', tone: 'else' },
];
const PARALLEL: readonly StepCardRow[] = [
  { id: 'zalo', label: 'Đăng Zalo', tone: 'branch' },
  { id: 'facebook', label: 'Đăng Facebook', tone: 'branch' },
  { id: 'tiktok', label: 'Đăng TikTok', tone: 'branch' },
];

/** Look at: an if has exactly two rows, a switch three, the last row the "else" with a hollow dashed dot; every row has its own port on the right edge. */
export const Branches: Story = {
  render: () => (
    <Row>
      <Frame rows={2}><StepCard kind="branch" title="Đã cọc chưa?" subtitle="Nếu · 2 đường" rows={IF} renderPort={port} /></Frame>
      <Frame rows={3}><StepCard kind="branch" title="Loại khách" subtitle="Rẽ nhánh · 3 đường" rows={SWITCH} renderPort={port} /></Frame>
    </Row>
  ),
};

/** Look at: a loop's three rows (the body red dashed, its stop green, its limit grey) and its round in the subtitle; a parallel's one row per branch. */
export const LoopAndParallel: Story = {
  render: () => (
    <Row>
      <Frame rows={3}><StepCard kind="loop" title="Vòng tư vấn" subtitle="Lặp · tối đa 5 vòng" rows={LOOP} renderPort={port} /></Frame>
      <Frame rows={3}><StepCard kind="parallel" title="Đăng đa kênh" subtitle="Song song · chờ tất cả" rows={PARALLEL} renderPort={port} /></Frame>
      <Frame><StepCard kind="join" title="Gom kết quả" subtitle="chờ tất cả" /></Frame>
    </Row>
  ),
};

/** Look at: a replay. The taken row lights up in its tone, the others fade; the loop says its round; each parallel branch shows its own mark. */
export const Replay: Story = {
  render: () => (
    <Row>
      <Frame rows={3}><StepCard kind="branch" title="Loại khách" subtitle="Rẽ nhánh · 3 đường" rows={SWITCH.map((row) => ({ ...row, state: row.id === 'late' ? 'taken' : 'dimmed' }))} renderPort={port} /></Frame>
      <Frame rows={3}><StepCard kind="loop" title="Vòng tư vấn" subtitle="Lặp · tối đa 5 vòng · vòng 2/5" rows={LOOP.map((row) => ({ ...row, state: row.id === 'body' ? 'taken' : 'dimmed' }))} renderPort={port} /></Frame>
      <Frame rows={3}>
        <StepCard
          kind="parallel"
          title="Đăng đa kênh"
          subtitle="Song song · chờ tất cả"
          rows={[
            { ...PARALLEL[0]!, state: 'done', stateLabel: 'Xong' },
            { ...PARALLEL[1]!, state: 'error', stateLabel: 'Lỗi' },
            { ...PARALLEL[2]!, state: 'running', stateLabel: 'Đang chạy' },
          ]}
          renderPort={port}
        />
      </Frame>
    </Row>
  ),
};
