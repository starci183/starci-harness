import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { MermaidDiagram } from '../core/ext/graph/index.js';
import '../core/ext/graph/styles.css';

/**
 * LESSON DIAGRAMS ON THE GRAPH CANVAS (0.55.1, owner 2026-11-23: "Chốt"). The author writes Mermaid; Mermaid's parser reads it and the graph ext
 * draws it on xyflow: the dot grid, pan and zoom (drag, pinch, the arrow keys, + and -), the zoom, fit and reset buttons, the Grammar's nodes,
 * edges, arrowheads and fonts. A flowchart and a state diagram are laid out by ELK; a sequence row by row; any other kind is Mermaid's own drawing
 * as one node of the same canvas. A step marked danger is the faulty one, success the fix, accent a part the change touches. Each story draws
 * light and dark one under the other.
 */
const meta: Meta = { title: 'Content/Lesson diagrams (0.55.1)', parameters: { layout: 'padded' } };
export default meta;
type Story = StoryObj;

/** Light and dark halves of one diagram, each in its own scoped theme. */
const Both = ({ children }: { readonly children: React.ReactNode }) => (
  <div style={{ display: 'grid', gap: 24, maxInlineSize: 820 }}>
    <div className="light" style={{ background: 'var(--background)', color: 'var(--foreground)', padding: 16 }}>{children}</div>
    <div className="dark" style={{ background: 'var(--background)', color: 'var(--foreground)', padding: 16 }}>{children}</div>
  </div>
);

const ready = async (canvasElement: HTMLElement, count = 2) =>
  waitFor(() => {
    const diagrams = canvasElement.querySelectorAll('[data-component="MermaidDiagram"][data-grammar-mermaid-state="ready"]');
    expect(diagrams).toHaveLength(count);
  }, { timeout: 10000 });

const RACE = `sequenceDiagram
  participant R as Lượt đọc chậm
  participant C as Redis
  participant D as Sổ giá
  participant M as Marketing
  R->>C: Hỏi giá
  C-->>R: Trống
  R->>D: Đọc giá: 249.000đ
  M->>D: Ghi 199.000đ
  M->>C: Xóa giá cũ
  R->>C: Ghi 249.000đ (sau lệnh xóa)
  Note over C,D: Giá cũ sống tới hết TTL 30 giây`;

/** A sequence: headers, dashed lifelines, a reply dashed, the sixth message the faulty step (`messageTones`), a note over two lifelines as a soft pill. */
export const Sequence: Story = {
  render: () => (
    <Both>
      <MermaidDiagram
        source={RACE}
        label="Lượt đọc chậm ghi giá cũ vào Redis sau lệnh xóa"
        height="md"
        messageTones={{ 6: 'danger' }}
        caption="Nhìn bước đỏ: lượt đọc chậm ghi giá cũ vào Redis sau lệnh xóa."
      />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('.starci-graph-diagram-message[data-tone="danger"]').length).toBe(2);
      expect(canvasElement.querySelectorAll('.starci-graph-diagram-participant').length).toBe(8);
      expect(canvasElement.querySelectorAll('.starci-graph-diagram-note').length).toBe(2);
    }, { timeout: 8000 });
    // The text version reads the messages in order.
    const steps = canvasElement.querySelectorAll('[data-grammar-mermaid-text] ol > li');
    expect(steps[0]?.textContent).toContain('Lượt đọc chậm to Redis: Hỏi giá');
  },
};

const BLOCKS = `sequenceDiagram
  autonumber
  actor K as Khách
  participant A as API
  participant Q as Hàng đợi
  K->>A: Đặt đơn
  alt còn hàng
    A->>Q: Đẩy việc giao
    Q-->>A: Đã nhận
  else hết hàng
    A--xK: Báo hết hàng
  end
  loop mỗi 5 giây
    A->>A: Hỏi lại kho
  end
  opt khách huỷ
    K->>A: Huỷ đơn
  end
  Note right of Q: Việc giao chạy nền`;

/** Blocks: alt with its else, a loop round a self-message, opt; numbered messages (`autonumber`), a lost message (`--x`), a note beside a lifeline. */
export const SequenceBlocks: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={BLOCKS} label="Đặt đơn" height="lg" messageTones={{ 4: 'danger', 2: 'success' }} />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-field').length).toBe(6);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-field-section').length).toBe(2);
  },
};

const FIX_LR = `flowchart LR
  A[Đọc sổ giá] --> B{Version mới hơn?}
  B -- có --> C[Ghi vào Redis]
  B -- không --> D[Bỏ bản cũ]
  subgraph L [Lưu trữ]
    C --> E[(Redis)]
    F[(Postgres)]
  end
  A -.-> F
  class B accent
  class C success`;

/** A flowchart drawn across: a decision touched by the change (accent), the fix (success), labelled edges, a subgraph container with two cylinders. */
export const FlowchartAcross: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={FIX_LR} label="Ghi cache theo version" height="md" caption="Cache từ chối bản cũ hơn bản đang giữ." />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-node[data-tone="accent"]').length).toBe(2);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-node[data-tone="success"]').length).toBe(2);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-node[data-shape="cylinder"]').length).toBe(4);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-group').length).toBe(2);
    // The routing law: a read-only graph shows no handle dots, and the first view holds the whole drawing.
    for (const dot of canvasElement.querySelectorAll('.starci-graph-edge-dot')) expect(getComputedStyle(dot).display).toBe('none');
    await waitFor(() => {
      for (const canvas of canvasElement.querySelectorAll<HTMLElement>('[data-grammar-mermaid-canvas]')) {
        const frame = canvas.getBoundingClientRect();
        for (const node of canvas.querySelectorAll('.react-flow__node')) {
          const box = node.getBoundingClientRect();
          expect(box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1).toBe(true);
        }
      }
    }, { timeout: 8000 });
  },
};

const ASIDE_TB = `flowchart TB
  U[Khách mở trang] --> G[GET giá trong Redis]
  G -->|trượt| S[SELECT từ Postgres]
  S --> W[SET với TTL 30 giây]
  G -->|trúng| R([Trả giá])
  W --> R`;

/** A flowchart drawn down, the faulty step by the `tones` map (its node id). */
export const FlowchartDown: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={ASIDE_TB} label="Cache-aside" height="lg" tones={{ W: 'danger' }} caption="Bước SET có thể đến sau lệnh xóa." />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-node[data-tone="danger"]').length).toBe(2);
  },
};

const STATES = `stateDiagram-v2
  [*] --> Trong
  Trong --> Co: SET
  Co --> Trong: DEL
  Co --> Cu: ghi đè muộn
  Cu --> Trong: hết TTL
  state Co {
    [*] --> Moi
    Moi --> Nong: đọc nhiều
  }
  Cu --> [*]
  class Cu danger
  class Moi success`;

/** A state diagram: rounded states, start and end marks, a composite state as a container, the stale state danger by `class Cu danger`. */
export const StateDiagram: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={STATES} label="Vòng đời của key giá" height="md" caption="Trạng thái đỏ là giá cũ đã đè lên giá mới." />
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-node[data-tone="danger"]').length).toBe(2);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-group').length).toBe(2);
  },
};

const PIE = `pie title Lượt đọc trong một phút
  "Trúng cache" : 82
  "Trượt cache" : 15
  "Giá cũ" : 3`;

const GANTT = `gantt
  title Sửa lỗi giá cũ
  dateFormat YYYY-MM-DD
  section Tìm lỗi
    Đọc log           :a1, 2026-11-20, 1d
    Dựng lại          :a2, after a1, 1d
  section Sửa
    Ghi theo version  :b1, after a2, 2d`;

/** Any other kind (here a pie and a gantt): Mermaid's own drawing in the Grammar's diagram theme, as one node on the same canvas. */
export const OtherKinds: Story = {
  render: () => (
    <Both>
      <div style={{ display: 'grid', gap: 16 }}>
        <MermaidDiagram source={PIE} label="Lượt đọc trong một phút" height="md" />
        <MermaidDiagram source={GANTT} label="Sửa lỗi giá cũ" height="sm" />
      </div>
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await ready(canvasElement, 4);
    expect(canvasElement.querySelectorAll('.starci-graph-diagram-svg svg').length).toBe(4);
  },
};

/** Loading keeps the reserved box with a skeleton; a source Mermaid refuses is the error title and the source as code, in the same box. */
export const LoadingAndError: Story = {
  render: () => (
    <Both>
      <div style={{ display: 'grid', gap: 16 }}>
        <MermaidDiagram source={FIX_LR} label="Ghi cache theo version" isLoading />
        <MermaidDiagram source={'flowchart LR\n  A --> {'} label="Sơ đồ hỏng" errorTitle="Không vẽ được sơ đồ này." />
      </div>
    </Both>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('[data-grammar-mermaid-state="error"]').length).toBe(2), { timeout: 10000 });
    const boxes = [...canvasElement.querySelectorAll<HTMLElement>('[data-component="MermaidDiagram"] > :first-child')].map((box) => box.getBoundingClientRect().height);
    for (const height of boxes) expect(height).toBeGreaterThanOrEqual(256);
  },
};
