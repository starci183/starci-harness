import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { FlowGraph, STEP_CARD, StepCard, StepWire, WireLegend, stepCardHeight, type FlowNode, type FlowStatusLabels, type GraphEdge, type StepCardModeLabels, type StepCardRow } from '../core/ext/graph/index.js';
import '../core/ext/graph/styles.css';

/**
 * THE STEP CARD (0.64.2; 0.64.7 the approved canvas: 196 x 96, a kind line over the name, the start node's triggers, row ports on the right edge, the wire).
 * Every card is 196 x 96 with the step's glyph on its kind's tinted tile; the mode badge sits at
 * the bottom-right (auto none, "Hỏi trước" amber, "Studio" purple, "Tự làm" grey). A control step lists its ways out as rows (8px by 12px, a 0.5px seam
 * above each, the first too), each with its tone's dot and its own port on the right edge; during a replay the taken row lights up and the others fade.
 * The border, the run status on it and the handles are the canvas's: each story draws a plain frame and a dot where the canvas's handle goes.
 * Proof is by reading (GRAMMAR-NO-TESTS): each story names what to look at.
 */
const meta: Meta = { title: 'Graph/Step card (0.64.7)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const MODES: StepCardModeLabels = { ask: 'Hỏi trước', studio: 'Studio', manual: 'Tự làm' };

/** A stand-in for the canvas: the card's border and a dot where its handle stands. */
const Frame = ({ rows = 0, children }: { readonly rows?: number; readonly children: ReactNode }) => (
  <div style={{ display: 'flex', boxSizing: 'border-box', inlineSize: STEP_CARD.width, blockSize: stepCardHeight(rows), border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>{children}</div>
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

const WORDS: FlowStatusLabels = { done: 'Xong', running: 'Đang chạy', wait: 'Đang chờ', error: 'Lỗi', skipped: 'Bỏ qua', todo: 'Chưa tới' };

/** Look at: the run graph draws the same step cards (`FlowNode.card`); the run status stays on the card's top edge, the switch's taken row is lit, the others fade. */
export const InFlowGraph: Story = {
  render: () => {
    const nodes: readonly FlowNode[] = [
      { id: 'ask', label: 'Soạn câu trả lời', status: 'done', card: { kind: 'ai', mode: 'studio', modeLabels: MODES } },
      { id: 'kind', label: 'Loại khách', status: 'done', kind: 'switch', card: { kind: 'branch', subtitle: 'Rẽ nhánh · 3 đường', rows: SWITCH.map((row) => ({ ...row, state: row.id === 'late' ? 'taken' : 'dimmed' })) } },
      { id: 'remind', label: 'Nhắc lịch', status: 'running', card: { kind: 'action', mode: 'ask', modeLabels: MODES } },
    ];
    const edges: readonly GraphEdge[] = [{ source: 'ask', target: 'kind' }, { source: 'kind', target: 'remind', variant: 'taken' }];
    return <div style={{ maxInlineSize: 900 }}><FlowGraph label="Lượt chạy" nodes={nodes} edges={edges} statusLabels={WORDS} height="content" /></div>;
  },
};

/** Look at (0.64.7, the approved canvas): every card 196 x 96 with the kind line over the name and one line under the head; the start node the same size, its danger ring and its triggers one per line, whole; the badge in the corner. */
export const CanvasCards: Story = {
  render: () => (
    <Row>
      <Frame>
        <StepCard
          kind="trigger"
          title="Khởi động"
          triggers={[
            { id: 'pick', label: 'Khách chọn giờ cọc' },
            { id: 'paid', label: 'SePay báo tiền về' },
            { id: 'hand', label: 'Chạy tay' },
          ]}
        />
      </Frame>
      <Frame><StepCard kind="ai" kindLabel="AI" title="Soạn QR cọc" subtitle="VietQR · 40% giá · mã lịch" /></Frame>
      <Frame><StepCard kind="action" kindLabel="Hành động" title="Gửi QR" subtitle="Trả lời đúng kênh khách nhắn" mode="ask" modeLabels={MODES} /></Frame>
      <Frame><StepCard kind="wait" kindLabel="Chờ sự kiện" title="Chờ tiền về" subtitle="sepay.payment.paid · tối đa 30 phút" /></Frame>
      <Frame><StepCard kind="ai" kindLabel="AI" title="Cảm ơn khách" subtitle="Tin xác nhận và giờ hẹn" mode="studio" modeLabels={MODES} /></Frame>
      <Frame><StepCard kind="end" kindLabel="Kết thúc" title="Kết thúc: thiếu tiền" subtitle="Chuyển người xử lý" mode="manual" modeLabels={MODES} /></Frame>
    </Row>
  ),
};

/** Look at: a wire is straight between two side midpoints; its start dot hollow with its centre on the source's border, its V open (stroke only) with its point on the target's border; a row's wire takes the row's colour (main green, warning amber, else grey dashes); the legend sits bottom right. */
export const Wires: Story = {
  render: () => (
    <div style={{ position: 'relative', inlineSize: 520, blockSize: 220, border: '1px solid var(--border)', borderRadius: 8 }}>
      <svg width={520} height={220} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect x={20} y={20} width={120} height={60} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <rect x={162} y={20} width={120} height={60} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <StepWire points={[{ x: 140, y: 50 }, { x: 162, y: 50 }]} />
        <rect x={340} y={20} width={120} height={40} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <rect x={340} y={80} width={120} height={40} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <rect x={340} y={140} width={120} height={40} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <StepWire points={[{ x: 282, y: 40 }, { x: 311, y: 40 }, { x: 311, y: 40 }, { x: 340, y: 40 }]} tone="main" />
        <StepWire points={[{ x: 282, y: 60 }, { x: 318, y: 60 }, { x: 318, y: 100 }, { x: 340, y: 100 }]} tone="warning" />
        <StepWire points={[{ x: 282, y: 75 }, { x: 325, y: 75 }, { x: 325, y: 160 }, { x: 340, y: 160 }]} tone="else" />
      </svg>
      <WireLegend label="Màu đường nối" items={[{ tone: 'main', label: 'đủ' }, { tone: 'warning', label: 'thiếu' }, { tone: 'else', label: 'quá hạn' }]} />
    </div>
  ),
};

/** Look at: a step graph (every node a step card) is laid out compact: one main row, every centre on one line, a column every 218px, no words on a wire; a branch's other ways stack above and below. */
export const CanvasGraph: Story = {
  render: () => {
    const nodes: readonly FlowNode[] = [
      { id: 'start', label: 'Khởi động', card: { kind: 'trigger', triggers: [{ id: 'pick', label: 'Khách chọn giờ cọc' }, { id: 'hand', label: 'Chạy tay' }] } },
      { id: 'qr', label: 'Soạn QR cọc', card: { kind: 'ai', kindLabel: 'AI', subtitle: 'VietQR · 40% giá' } },
      { id: 'send', label: 'Gửi QR', card: { kind: 'action', kindLabel: 'Hành động', subtitle: 'Trả lời đúng kênh', mode: 'ask', modeLabels: MODES } },
      { id: 'check', label: 'Đủ tiền?', kind: 'switch', card: { kind: 'branch', subtitle: 'Rẽ nhánh · 3 đường', rows: [{ id: 'ok', label: 'tiền ≥ cọc → đủ', tone: 'main' }, { id: 'low', label: 'tiền < cọc → thiếu', tone: 'warning' }, { id: 'late', label: 'còn lại → quá hạn', tone: 'else' }] }, outputs: [{ id: 'ok', label: 'đủ' }, { id: 'low', label: 'thiếu' }, { id: 'late', label: 'quá hạn' }] },
      { id: 'paid', label: 'Đã cọc', card: { kind: 'action', kindLabel: 'Hành động', subtitle: 'Lịch hẹn chuyển Đã cọc' } },
      { id: 'notify', label: 'Báo nhóm', card: { kind: 'action', kindLabel: 'Hành động', subtitle: 'Nhóm Telegram chủ tiệm' } },
      { id: 'release', label: 'Nhả chỗ', card: { kind: 'action', kindLabel: 'Hành động', subtitle: 'Trả giờ cho khách khác' } },
    ];
    const edges: readonly GraphEdge[] = [
      { source: 'start', target: 'qr' }, { source: 'qr', target: 'send' }, { source: 'send', target: 'check' },
      { source: 'check', target: 'paid', sourcePort: 'ok' }, { source: 'check', target: 'notify', sourcePort: 'low' }, { source: 'check', target: 'release', sourcePort: 'late' },
    ];
    return <div style={{ maxInlineSize: 1328 }}><FlowGraph label="Sơ đồ" layout="layered" nodes={nodes} edges={edges} statusLabels={WORDS} height="content" /></div>;
  },
};
