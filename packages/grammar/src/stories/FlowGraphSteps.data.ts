import { BanknotesIcon, DocumentTextIcon, MagnifyingGlassIcon, MegaphoneIcon, PencilSquareIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import type * as G from '../common/index.js';

/**
 * The accounting flow "Đối soát tiền về" (money in, matched to an order) drawn as a `steps` graph: an event starts it, two conditions
 * fork it through named ports, a wait and an ask need the owner, and two dashed back edges return to "Ghi nhận đã trả".
 */
export const reconcileNodes: ReadonlyArray<G.FlowGraphNode> = [
  { id: 'money-in', kind: 'event', label: 'Tiền về', description: 'Giao dịch ngân hàng mới', tag: 'Kích hoạt', icon: BanknotesIcon },
  { id: 'find-order', kind: 'action', label: 'Tìm mã đơn', description: 'Đọc nội dung chuyển khoản', icon: MagnifyingGlassIcon },
  { id: 'has-order', kind: 'condition', label: 'Có mã đơn?', description: 'Mã đơn trong nội dung', outputs: [{ id: 'yes', label: 'Có' }, { id: 'no', label: 'Không' }] },
  { id: 'amount-ok', kind: 'condition', label: 'Đủ số tiền?', description: 'So với giá trị đơn', outputs: [{ id: 'match', label: 'Khớp' }, { id: 'off', label: 'Lệch' }] },
  { id: 'note-unmatched', kind: 'action', label: 'Ghi chú chưa khớp', description: 'Lưu vào sổ đối soát', icon: PencilSquareIcon },
  { id: 'wait-owner', kind: 'wait', label: 'Chờ chủ khớp tay', description: 'Chủ chọn đơn khớp', tag: 'Chờ' },
  { id: 'ask-owner', kind: 'ask', label: 'Hỏi chủ', description: 'Báo số tiền lệch', tag: 'Cần chủ', icon: UserCircleIcon },
  { id: 'mark-paid', kind: 'action', label: 'Ghi nhận đã trả', description: 'Đánh dấu đơn đã thanh toán', icon: DocumentTextIcon },
  { id: 'tell-sales', kind: 'event', label: 'Báo Sales', description: 'Gửi thông báo cho nhóm', icon: MegaphoneIcon },
  { id: 'done', kind: 'end', label: 'Xong' },
];

export const reconcileEdges: ReadonlyArray<G.FlowGraphEdge> = [
  { id: 'e-in-find', source: 'money-in', target: 'find-order' },
  { id: 'e-find-has', source: 'find-order', target: 'has-order' },
  { id: 'e-has-yes', source: 'has-order', target: 'amount-ok', sourcePort: 'yes' },
  { id: 'e-has-no', source: 'has-order', target: 'note-unmatched', sourcePort: 'no' },
  { id: 'e-note-wait', source: 'note-unmatched', target: 'wait-owner' },
  { id: 'e-amount-match', source: 'amount-ok', target: 'mark-paid', sourcePort: 'match' },
  { id: 'e-amount-off', source: 'amount-ok', target: 'ask-owner', sourcePort: 'off' },
  { id: 'e-paid-sales', source: 'mark-paid', target: 'tell-sales' },
  { id: 'e-sales-done', source: 'tell-sales', target: 'done' },
  { id: 'b-ask-paid', source: 'ask-owner', target: 'mark-paid', variant: 'back', label: 'chủ duyệt' },
  { id: 'b-wait-paid', source: 'wait-owner', target: 'mark-paid', variant: 'back', label: 'chủ khớp' },
];

export const reconcileLegend: ReadonlyArray<G.FlowGraphLegendItem> = [
  { kind: 'event', label: 'Sự kiện' },
  { kind: 'action', label: 'Việc làm' },
  { kind: 'condition', label: 'Điều kiện' },
  { kind: 'ask', label: 'Cần chủ' },
  { kind: 'wait', label: 'Chờ' },
];

export const reconcileStatusLabels: Partial<Record<G.FlowGraphRunStatus, string>> = {
  done: 'Xong',
  running: 'Đang chạy',
  failed: 'Lỗi',
  waiting: 'Đang chờ',
  skipped: 'Bỏ qua',
};

/** A run of the flow: the money matched an order of the right amount; the run is at "Báo Sales". */
const matchedStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = {
  'money-in': 'done',
  'find-order': 'done',
  'has-order': 'done',
  'amount-ok': 'done',
  'mark-paid': 'done',
  'tell-sales': 'running',
  'note-unmatched': 'skipped',
  'wait-owner': 'skipped',
  'ask-owner': 'skipped',
  done: 'skipped',
};
const matchedTaken = new Set(['e-in-find', 'e-find-has', 'e-has-yes', 'e-amount-match', 'e-paid-sales']);

/** A second run: the amount was off, the owner was asked and has not answered. */
const offStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = {
  'money-in': 'done',
  'find-order': 'done',
  'has-order': 'done',
  'amount-ok': 'done',
  'ask-owner': 'waiting',
  'note-unmatched': 'skipped',
  'wait-owner': 'skipped',
};
const offTaken = new Set(['e-in-find', 'e-find-has', 'e-has-yes', 'e-amount-off']);

/** A third run: reading the transfer failed. */
const failedStatus: Readonly<Record<string, G.FlowGraphRunStatus>> = { 'money-in': 'done', 'find-order': 'failed' };
const failedTaken = new Set(['e-in-find']);

const runOf = (status: Readonly<Record<string, G.FlowGraphRunStatus>>, taken: ReadonlySet<string>) => ({
  nodes: reconcileNodes.map((node): G.FlowGraphNode => {
    const at = status[node.id];
    return at === undefined ? node : { ...node, status: at };
  }),
  edges: reconcileEdges.map((edge) => ({ ...edge, isTaken: taken.has(edge.id) })),
});

export const reconcileRunMatched = runOf(matchedStatus, matchedTaken);
export const reconcileRunOff = runOf(offStatus, offTaken);
export const reconcileRunFailed = runOf(failedStatus, failedTaken);
