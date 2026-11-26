import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { CodeBlock } from '../common/index.js';
import { FlowGraph, FlowStepDrawer, type FlowLegendItem, type FlowNode, type FlowStatusInput, type FlowStatusLabels, type FlowStepSection, type GraphEdge } from '../core/ext/graph/index.js';
import '../core/ext/graph/styles.css';

/**
 * THE SPINE LAYOUT OF FlowGraph (0.64.0, owner 2026-11-26). The main run (plain and "yes" steps) is one straight column, every node on it centred on one x;
 * side roads stand in columns to the right; a parallel fork splits its branches evenly round it; one layer is one row. Edges attach only at the middles of
 * the sides (in at the top, out at the bottom, a side road out at the right, a loop out and in at the left) with the fewest bends: straight down the
 * column, one bend to a side column, one bend back into the spine, a U on the left for a loop, bars for a fork and a join. Two edges into one node meet
 * at a merge dot above it; three or more drop straight into a merge bar that carries the one arrow. Every edge kind has its own look. A step opens the
 * app's drawer (`onNodeOpen`, `FlowStepDrawer`). Proof is by reading (GRAMMAR-NO-TESTS): each story names what to look at.
 */
const meta: Meta = { title: 'Graph/Flow spine layout (0.64.0)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

const WORDS: FlowStatusLabels = { done: 'Xong', running: 'Đang chạy', wait: 'Đang chờ', error: 'Lỗi', skipped: 'Bỏ qua', todo: 'Chưa chạy' };

const LEGEND: readonly FlowLegendItem[] = [
  { label: 'Bước tiếp', edge: 'ok' },
  { label: 'Có', edge: 'yes' },
  { label: 'Không', edge: 'no' },
  { label: 'Lặp lại', edge: 'loop' },
  { label: 'Hết giờ', edge: 'timeout' },
  { label: 'Bị từ chối', edge: 'refused' },
  { label: 'Vòng lặp', kind: 'loop' },
];

const n = (id: string, label: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, label, kind: 'action', ...extra });
const ask = (id: string, label: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, label, kind: 'condition', shape: 'diamond', outputs: [{ id: 'yes', label: 'Có' }, { id: 'no', label: 'Không' }], ...extra });
const e = (source: string, target: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({ source, target, ...extra });

const Frame = ({ children }: { readonly children: ReactNode }) => <div style={{ maxInlineSize: 1100 }}>{children}</div>;

const Flow = ({ label, nodes, edges }: { readonly label: string; readonly nodes: readonly FlowNode[]; readonly edges: readonly GraphEdge[] }) => (
  <Frame>
    <FlowGraph label={label} nodes={nodes} edges={edges} statusLabels={WORDS} skippedLabel="Bỏ qua" legend={LEGEND} height="content" />
  </Frame>
);

/** A straight spine: five steps, one centre x, every edge straight down (0 bends), bottom-mid to top-mid. */
export const StraightSpine: Story = {
  render: () => (
    <Flow
      label="Xử lý đơn hàng"
      nodes={[
        n('order', 'Nhận đơn', { kind: 'event', status: 'done' }),
        n('check', 'Kiểm tra tồn kho', { status: 'done' }),
        n('pay', 'Thu tiền', { status: 'running' }),
        n('ship', 'Giao hàng'),
        n('done', 'Hoàn tất', { kind: 'end' }),
      ]}
      edges={[e('order', 'check'), e('check', 'pay'), e('pay', 'ship'), e('ship', 'done')]}
    />
  ),
};

/** An if: "Có" runs straight on down the spine in strong green; "Không" leaves the diamond's right vertex, runs across and drops into the right column (1 bend), grey dots. */
export const IfYesNo: Story = {
  render: () => (
    <Flow
      label="Duyệt hạn mức"
      nodes={[
        n('placed', 'Đơn mới', { kind: 'event', status: 'done' }),
        ask('limit', 'Vượt hạn mức?', { status: 'done' }),
        n('approve', 'Quản lý duyệt', { status: 'wait', wait: { kind: 'person', label: 'Chờ duyệt', detail: 'chờ trưởng phòng từ 9:30' } }),
        n('auto', 'Duyệt tự động', { status: 'skipped' }),
        n('ship', 'Giao hàng'),
      ]}
      edges={[e('placed', 'limit'), e('limit', 'approve', { sourcePort: 'yes' }), e('limit', 'auto', { sourcePort: 'no' }), e('approve', 'ship')]}
    />
  ),
};

/**
 * A merge (two edges into one node): the side road drops from its card to the gap above "Ghi sổ" and runs across to a merge dot right above its centre
 * (1 bend); the spine edge runs straight through the dot and carries the one arrow into the top-mid.
 */
export const Merge: Story = {
  render: () => (
    <Flow
      label="Hoàn tiền"
      nodes={[
        n('req', 'Yêu cầu hoàn tiền', { kind: 'event', status: 'done' }),
        ask('small', 'Dưới 500.000đ?', { status: 'done' }),
        n('auto', 'Hoàn ngay', { status: 'done' }),
        n('review', 'Kế toán xem xét', { status: 'skipped' }),
        n('book', 'Ghi sổ', { status: 'running' }),
        n('notify', 'Báo khách', { kind: 'end' }),
      ]}
      edges={[e('req', 'small'), e('small', 'auto', { sourcePort: 'yes' }), e('small', 'review', { sourcePort: 'no' }), e('auto', 'book'), e('review', 'book'), e('book', 'notify')]}
    />
  ),
};

/**
 * A loop: the dashed frame with its title ("Vòng gọi lại · tối đa 3 lượt") holds the steps that repeat; "Không nghe máy" returns from the diamond's left
 * vertex up a lane on the left into "Gọi khách"'s left-mid (a U, 2 bends), dashed accent with the loop mark. "Có" leaves the frame straight down.
 */
export const LoopWithFrame: Story = {
  render: () => (
    <Flow
      label="Gọi lại khách"
      nodes={[
        n('lead', 'Khách để lại số', { kind: 'event', status: 'done' }),
        { id: 'round', label: 'Vòng gọi lại', container: { kind: 'loop', childIds: ['call', 'listen', 'picked'], description: 'tối đa 3 lượt', attempt: 'lượt 2/3' } },
        n('call', 'Gọi khách', { status: 'done' }),
        n('listen', 'Chờ khách bắt máy', { status: 'done' }),
        ask('picked', 'Khách nghe máy?', { status: 'running' }),
        n('book', 'Đặt lịch hẹn'),
      ]}
      edges={[e('lead', 'round'), e('call', 'listen'), e('listen', 'picked'), e('picked', 'book', { sourcePort: 'yes' }), e('picked', 'call', { sourcePort: 'no', kind: 'loop', label: 'Không nghe máy' })]}
    />
  ),
};

/** A wait with a timeout: the answer runs on down the spine; "Hết 24 giờ" leaves the wait's right-mid in round amber dots into the right column (1 bend), then merges back above "Đóng phiếu". */
export const WaitTimeout: Story = {
  render: () => (
    <Flow
      label="Chờ khách xác nhận"
      nodes={[
        n('send', 'Gửi báo giá', { status: 'done' }),
        n('wait', 'Chờ khách trả lời', { kind: 'wait', status: 'wait', wait: { kind: 'time', label: 'Còn 6 giờ', detail: 'hết hạn lúc 18:00' } }),
        n('reply', 'Xử lý trả lời'),
        n('remind', 'Nhắc khách'),
        n('close', 'Đóng phiếu', { kind: 'end' }),
      ]}
      edges={[e('send', 'wait'), e('wait', 'reply'), e('wait', 'remind', { kind: 'timeout', label: 'Hết 24 giờ' }), e('reply', 'close'), e('remind', 'close')]}
    />
  ),
};

/** A 3-branch parallel: a fork bar under "Mở hồ sơ" spreads the branches evenly (lanes -1, 0, 1), each dropping straight from the bar (0 bends); a join bar above "Tổng hợp" carries the one arrow. */
export const ParallelThree: Story = {
  render: () => (
    <Flow
      label="Thẩm định hồ sơ"
      nodes={[
        n('open', 'Mở hồ sơ', { kind: 'event', status: 'done' }),
        n('id', 'Kiểm tra CCCD', { status: 'done' }),
        n('credit', 'Tra cứu tín dụng', { status: 'running' }),
        n('income', 'Xác minh thu nhập', { status: 'done' }),
        n('sum', 'Tổng hợp'),
        n('decide', 'Ra quyết định', { kind: 'end' }),
      ]}
      edges={[e('open', 'id'), e('open', 'credit'), e('open', 'income'), e('id', 'sum'), e('credit', 'sum'), e('income', 'sum'), e('sum', 'decide')]}
    />
  ),
};

/** Fan-in of 2 from two columns: a timeout road and the spine meet at one merge dot above "Ghi nhận"; one arrow enters its top-mid. */
export const FanInTwo: Story = {
  render: () => (
    <Flow
      label="Ghi nhận phản hồi"
      nodes={[
        n('ask', 'Gửi khảo sát', { status: 'done' }),
        n('wait', 'Chờ phản hồi', { kind: 'wait', status: 'done' }),
        n('answer', 'Đọc câu trả lời', { status: 'done' }),
        n('none', 'Đánh dấu không trả lời', { status: 'skipped' }),
        n('log', 'Ghi nhận', { status: 'running' }),
      ]}
      edges={[e('ask', 'wait'), e('wait', 'answer'), e('wait', 'none', { kind: 'timeout', label: 'Hết 3 ngày' }), e('answer', 'log'), e('none', 'log')]}
    />
  ),
};

/** Fan-in of 5: five channels side by side (lanes -2 to 2) each drop straight into one merge bar centred on "Tạo phiếu hỗ trợ" (they stand round it) (0 bends); the bar's neutral arrow enters its top-mid. */
export const FanInFive: Story = {
  render: () => (
    <Flow
      label="Tiếp nhận yêu cầu"
      nodes={[
        n('mail', 'Email', { kind: 'event', status: 'done' }),
        n('chat', 'Chat Zalo', { kind: 'event', status: 'done' }),
        n('form', 'Form trên web', { kind: 'event', status: 'done' }),
        n('call', 'Tổng đài', { kind: 'event', status: 'done' }),
        n('fb', 'Fanpage', { kind: 'event', status: 'done' }),
        n('ticket', 'Tạo phiếu hỗ trợ', { status: 'running' }),
        n('route', 'Chia cho nhân viên'),
      ]}
      edges={[e('mail', 'ticket'), e('chat', 'ticket'), e('form', 'ticket'), e('call', 'ticket'), e('fb', 'ticket'), e('ticket', 'route')]}
    />
  ),
};

/**
 * Fan-in from different columns AND layers: five roads end in "Đóng hồ sơ". Each forward source drops straight down its own column through the gaps
 * into the merge bar above it, keeping its kind's look on its own drop (the spine green, the timeout amber dots, the refusal red dashes); a source
 * whose column is blocked by the spine below steps out of its right-mid to a free column first. The bar and its arrow are neutral.
 */
export const FanInAcrossLayers: Story = {
  render: () => (
    <Flow
      label="Hồ sơ vay"
      nodes={[
        n('start', 'Nhận hồ sơ', { kind: 'event', status: 'done' }),
        ask('papers', 'Đủ giấy tờ?', { status: 'done' }),
        n('missing', 'Báo thiếu giấy tờ', { status: 'skipped' }),
        n('review', 'Thẩm định', { status: 'done' }),
        n('sign', 'Chờ khách ký', { kind: 'wait', status: 'done' }),
        n('expired', 'Hết hạn ký', { status: 'skipped' }),
        n('disburse', 'Giải ngân', { status: 'done' }),
        n('closed', 'Đóng hồ sơ', { kind: 'end', status: 'running' }),
      ]}
      edges={[
        e('start', 'papers'),
        e('papers', 'review', { sourcePort: 'yes' }),
        e('papers', 'missing', { sourcePort: 'no' }),
        e('missing', 'closed'),
        e('review', 'sign'),
        e('review', 'closed', { kind: 'refused', label: 'Không đạt' }),
        e('sign', 'disburse'),
        e('sign', 'expired', { kind: 'timeout', label: 'Quá 7 ngày' }),
        e('expired', 'closed'),
        e('disburse', 'closed', { kind: 'yes', label: 'Đã chuyển tiền' }),
      ]}
    />
  ),
};

/**
 * Mixed fan-in: "Soạn hợp đồng" takes two forward edges (they meet at the merge dot above it) and two loops (they gather in one lane on its left into one
 * stroke into its left-mid; the shorter joins the longer at a dot).
 */
export const FanInMixed: Story = {
  render: () => (
    <Flow
      label="Ký hợp đồng"
      nodes={[
        n('deal', 'Chốt giá', { kind: 'event', status: 'done' }),
        ask('vip', 'Khách VIP?', { status: 'done' }),
        n('fast', 'Mẫu rút gọn', { status: 'done' }),
        n('draft', 'Soạn hợp đồng', { status: 'done' }),
        ask('legal', 'Pháp chế duyệt?', { status: 'done' }),
        ask('client', 'Khách đồng ý?', { status: 'running' }),
        n('signed', 'Ký', { kind: 'end' }),
      ]}
      edges={[
        e('deal', 'vip'),
        e('vip', 'draft', { sourcePort: 'yes' }),
        e('vip', 'fast', { sourcePort: 'no' }),
        e('fast', 'draft'),
        e('draft', 'legal'),
        e('legal', 'client', { sourcePort: 'yes' }),
        e('legal', 'draft', { sourcePort: 'no', kind: 'loop', label: 'Sửa điều khoản' }),
        e('client', 'signed', { sourcePort: 'yes' }),
        e('client', 'draft', { sourcePort: 'no', kind: 'loop', label: 'Khách góp ý' }),
      ]}
    />
  ),
};

const SAMPLE_IN = `{
  "orderId": "DH-20931",
  "amount": 1250000,
  "customer": { "id": "KH-118", "tier": "gold" }
}`;
const SAMPLE_CODE = `export const checkLimit = async (input: Order, state: RunState) => {
  const limit = await limits.of(input.customer.tier)
  state.overLimit = input.amount > limit
  return { overLimit: state.overLimit, limit }
}`;
const SAMPLE_MUTATION = `{
  "overLimit": { "before": null, "after": true }
}`;
const SAMPLE_OUT = `{
  "overLimit": true,
  "limit": 1000000
}`;
const SAMPLE_STATE = `{
  "runId": "run-7f3a",
  "startedAt": "2026-11-26T09:30:12+07:00",
  "overLimit": true,
  "approver": null
}`;

const SECTIONS: readonly FlowStepSection[] = [
  { part: 'in', title: 'Data in', children: <CodeBlock code={SAMPLE_IN} language="json" label="Data in" /> },
  { part: 'code', title: 'Code chạy', children: <CodeBlock code={SAMPLE_CODE} language="ts" path="steps/check-limit.ts" highlightLines={[3]} /> },
  { part: 'mutation', title: 'Mutation: ghi vào state', children: <CodeBlock code={SAMPLE_MUTATION} language="json" label="Mutation" /> },
  { part: 'out', title: 'Data out', children: <CodeBlock code={SAMPLE_OUT} language="json" label="Data out" /> },
  { part: 'state', title: 'State chung của run', caption: 'Mọi bước của lượt chạy cùng đọc và ghi state này.', children: <CodeBlock code={SAMPLE_STATE} language="json" label="State chung" /> },
];

const NODES: readonly FlowNode[] = [
  n('placed', 'Đơn mới', { kind: 'event', status: 'done' }),
  ask('limit', 'Vượt hạn mức?', { status: 'done' }),
  n('approve', 'Quản lý duyệt', { status: 'running' }),
  n('auto', 'Duyệt tự động', { status: 'skipped' }),
];

const StepDrawerDemo = () => {
  const [open, setOpen] = useState<string | null>('limit');
  const node = NODES.find((item) => item.id === open);
  return (
    <Frame>
      <FlowGraph
        label="Duyệt hạn mức"
        nodes={NODES}
        edges={[e('placed', 'limit'), e('limit', 'approve', { sourcePort: 'yes' }), e('limit', 'auto', { sourcePort: 'no' })]}
        statusLabels={WORDS}
        height="content"
        onNodeOpen={setOpen}
      />
      <FlowStepDrawer
        isOpen={node !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(null);
        }}
        title={node?.label ?? ''}
        version="v2.1"
        status={{ state: node?.status ?? 'todo', label: WORDS.done }}
        closeLabel="Đóng"
        sections={node === undefined ? [] : SECTIONS}
      />
    </Frame>
  );
};

/**
 * A step opens the drawer: pressing a node fires `onNodeOpen(id)` and the app opens `FlowStepDrawer`, the wide right-side Drawer, with the step's name,
 * its version badge ("v2.1") and state, then its parts in the fixed order: Data in, Code chạy, Mutation: ghi vào state, Data out, State chung của run.
 * The app fills every part; the Grammar lays them out. Opens on "Vượt hạn mức?".
 */
export const StepDrawer: Story = {
  parameters: { grammar: { minHeight: '44rem' } },
  render: () => <StepDrawerDemo />,
};

/**
 * A switch (a flat hexagon with its count badge, "4 ngả"): one exit at its bottom-mid into a thin hollow split bar, each case dropping straight down its own
 * column with its words on its drop, the default ("khác") rightmost in grey dots; the case the run took is bold, its words after a check.
 */
export const Switch: Story = {
  render: () => (
    <Flow
      label="Phân loại yêu cầu"
      nodes={[
        n('in', 'Yêu cầu mới', { kind: 'event', status: 'done' }),
        {
          id: 'kind',
          label: 'Loại yêu cầu',
          kind: 'switch',
          count: '4 ngả',
          status: 'done',
          outputs: [{ id: 'refund', label: 'Hoàn tiền' }, { id: 'swap', label: 'Đổi hàng' }, { id: 'warranty', label: 'Bảo hành' }, { id: 'other', label: 'khác', isDefault: true }],
        },
        n('refund', 'Hoàn tiền', { status: 'skipped' }),
        n('swap', 'Đổi hàng', { status: 'running' }),
        n('warranty', 'Bảo hành', { status: 'skipped' }),
        n('other', 'Chuyển nhân viên', { status: 'skipped' }),
      ]}
      edges={[
        e('in', 'kind'),
        e('kind', 'refund', { sourcePort: 'refund' }),
        e('kind', 'swap', { sourcePort: 'swap', variant: 'taken' }),
        e('kind', 'warranty', { sourcePort: 'warranty' }),
        e('kind', 'other', { sourcePort: 'other' }),
      ]}
    />
  ),
};

/**
 * Every shape the spine layout reads from a step's kind, in one flow: an action a rounded card, an if a diamond, a switch a flat hexagon with its count
 * badge and a hollow split bar, a wait a pill with a clock, a parallel step a square-cornered rectangle with solid fork and join bars, a step that runs
 * another workflow a hexagon with a dashed outline, an end a stadium, a loop a dashed frame ("↻ … tối đa N lượt"). Ports stay at the middles of each box's sides.
 */
export const ShapesLegend: Story = {
  render: () => (
    <Frame>
      <FlowGraph
        label="Mọi hình của bước"
        statusLabels={WORDS}
        height="content"
        legend={[
          { label: 'Hành động', kind: 'action' },
          { label: 'If', kind: 'condition', shape: 'diamond' },
          { label: 'Switch', kind: 'switch' },
          { label: 'Chờ', kind: 'wait' },
          { label: 'Song song', kind: 'parallel' },
          { label: 'Gọi workflow', kind: 'call' },
          { label: 'Kết thúc', kind: 'end' },
          { label: 'Vòng lặp', kind: 'loop' },
          ...LEGEND.filter((item) => item.edge !== undefined),
        ]}
        nodes={[
          n('act', 'Hành động (thẻ bo góc)', { kind: 'action' }),
          ask('if', 'If (hình thoi)'),
          { id: 'sw', label: 'Switch (lục giác dẹt)', kind: 'switch', count: '3 ngả', outputs: [{ id: 'a', label: 'Ngả A' }, { id: 'b', label: 'Ngả B' }, { id: 'else', label: 'khác', isDefault: true }] },
          n('wait', 'Chờ (viên thuốc)', { kind: 'wait' }),
          n('par', 'Song song (chữ nhật)', { kind: 'parallel' }),
          n('p1', 'Nhánh 1'),
          n('p2', 'Nhánh 2'),
          { id: 'retry', label: 'Gọi lại', container: { kind: 'loop', childIds: ['call', 'ok'], description: 'tối đa 3 lượt' } },
          n('call', 'Gọi workflow khác (lục giác nét đứt)', { kind: 'call' }),
          ask('ok', 'Thành công?'),
          n('end', 'Kết thúc (sân vận động)', { kind: 'end' }),
        ]}
        edges={[
          e('act', 'if'),
          e('if', 'sw', { sourcePort: 'yes' }),
          e('if', 'retry', { sourcePort: 'no' }),
          e('sw', 'wait', { sourcePort: 'a' }),
          e('sw', 'par', { sourcePort: 'b' }),
          e('sw', 'end', { sourcePort: 'else' }),
          e('par', 'p1'),
          e('par', 'p2'),
          e('call', 'ok'),
          e('ok', 'call', { sourcePort: 'no', kind: 'loop', label: 'Thử lại' }),
          e('ok', 'end', { sourcePort: 'yes' }),
          e('wait', 'end', { kind: 'timeout', label: 'Hết giờ' }),
          e('p1', 'end'),
          e('p2', 'end'),
        ]}
      />
    </Frame>
  ),
};

/** A 35-step run (25 on the spine, 5 ifs, a 2-step side road off each that meets the spine again), the run on its 16th step. */
const longRun = (): { readonly nodes: FlowNode[]; readonly edges: GraphEdge[] } => {
  const nodes: FlowNode[] = [];
  const edges: GraphEdge[] = [];
  const status = (index: number): FlowStatusInput => (index < 15 ? 'done' : index === 15 ? 'running' : 'todo');
  let previous: string | undefined;
  for (let index = 0; index < 25; index += 1) {
    const id = `s${String(index)}`;
    const isIf = index % 5 === 2;
    nodes.push(isIf ? ask(id, `Kiểm tra ${String(index + 1)}?`, { status: status(index) }) : n(id, `Bước ${String(index + 1)}`, { status: status(index), ...(index === 0 ? { kind: 'event' as const } : {}) }));
    if (previous !== undefined) edges.push(e(previous, id, previous.startsWith('s') && nodes.find((node) => node.id === previous)?.shape === 'diamond' ? { sourcePort: 'yes' } : {}));
    if (isIf) {
      nodes.push(n(`${id}a`, `Xử lý ngoại lệ ${String(index + 1)}`, { status: 'skipped' }), n(`${id}b`, `Ghi chú ${String(index + 1)}`, { status: 'skipped' }));
      edges.push(e(id, `${id}a`, { sourcePort: 'no' }), e(`${id}a`, `${id}b`), e(`${id}b`, `s${String(index + 2)}`));
    }
    previous = id;
  }
  return { nodes, edges };
};

/**
 * A long run (35 steps): the cards keep their readable size (`FLOW_READABLE_ZOOM`, at least 210px wide), the first view fits the frame's width and starts at
 * the running step, and the rest is panned; the canvas never shrinks the flow to fit its height.
 */
export const LongRun35: Story = {
  render: () => {
    const { nodes, edges } = longRun();
    return (
      <Frame>
        <div style={{ blockSize: '40rem' }}>
          <FlowGraph label="Chăm sóc lead" nodes={nodes} edges={edges} statusLabels={WORDS} skippedLabel="Bỏ qua" />
        </div>
      </Frame>
    );
  },
};

/** A 57-edge flow: a switch of four kinds of comment, eight steps for each, ifs, loops, timeouts and refusals into one hand-off, all meeting at one end. */
const replies = (): { readonly nodes: FlowNode[]; readonly edges: GraphEdge[] } => {
  const cases = [
    { id: 'price', label: 'Hỏi giá' },
    { id: 'praise', label: 'Khen' },
    { id: 'complain', label: 'Chê' },
    { id: 'spam', label: 'khác', isDefault: true },
  ];
  const nodes: FlowNode[] = [
    n('in', 'Bình luận mới', { kind: 'event', status: 'done' }),
    { id: 'kind', label: 'Loại bình luận', kind: 'switch', count: '4 ngả', status: 'done', outputs: cases },
    n('handoff', 'Chuyển nhân viên', { kind: 'ask' }),
    n('close', 'Đóng bình luận', { kind: 'end' }),
  ];
  const edges: GraphEdge[] = [e('in', 'kind'), e('handoff', 'close')];
  cases.forEach((item, at) => {
    const taken = at === 0;
    const id = (step: number): string => `${item.id}${String(step)}`;
    const state = (step: number): FlowStatusInput => (taken ? (step < 5 ? 'done' : step === 5 ? 'running' : 'todo') : 'skipped');
    for (let step = 1; step <= 8; step += 1) {
      const label = `${item.label}: bước ${String(step)}`;
      nodes.push(step === 3 ? ask(id(step), `${item.label}: tự trả lời được?`, { status: state(step) }) : step === 6 ? ask(id(step), `${item.label}: khách trả lời?`, { status: state(step) }) : n(id(step), label, { status: state(step) }));
    }
    edges.push(e('kind', id(1), { sourcePort: item.id, ...(taken ? { variant: 'taken' as const } : {}) }));
    edges.push(e(id(1), id(2)), e(id(2), id(3)), e(id(3), id(4), { sourcePort: 'yes' }), e(id(4), id(5)), e(id(5), id(6)), e(id(6), id(7), { sourcePort: 'yes' }), e(id(7), id(8)));
    edges.push(e(id(3), 'handoff', { sourcePort: 'no', label: 'Cần người' }));
    edges.push(e(id(6), id(5), { sourcePort: 'no', kind: 'loop', label: 'Hỏi lại' }));
    edges.push(e(id(8), 'close'));
    edges.push(e(id(2), id(8), { kind: 'timeout', label: 'Quá 1 giờ' }));
    edges.push(e(id(5), 'handoff', { kind: 'refused', label: 'Khách gắt' }));
    if (at < 3) edges.push(e(id(7), 'close', { kind: 'declined', label: 'Khách thôi' }));
  });
  return { nodes, edges };
};

/**
 * A 57-edge flow stays readable: past 20 steps every road the run did not take folds behind one "+N bước" pill on the edge into it (`collapse`), the spine
 * and the steps the run reached stay drawn, and pressing a pill unfolds its road.
 */
export const Replies57: Story = {
  render: () => {
    const { nodes, edges } = replies();
    return (
      <Frame>
        <div style={{ blockSize: '44rem' }}>
          <FlowGraph label="Trả lời bình luận" nodes={nodes} edges={edges} statusLabels={WORDS} skippedLabel="Bỏ qua" legend={LEGEND} collapse={{ label: (count) => `+${String(count)} bước` }} />
        </div>
      </Frame>
    );
  },
};
