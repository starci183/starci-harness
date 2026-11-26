import type { Meta, StoryObj } from '@storybook/react-vite';
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
};

const TALL_TB = `flowchart TB
  G[Cổng thanh toán] --> S[Server Mây Coffee]
  S --> P[(Postgres: đơn + outbox)]
  P e1@--> R[Relay]
  R e2@--> L[Loyalty]
  L e3@--> N[Gửi thông báo cộng điểm]
  class e1,e2,e3 accent`;

/**
 * A tall drawing (Next UI audit round 3, the lesson question at 390px: the last node, "Loyalty", was cut in half by the frame and the controls row stood
 * over it). The canvas grows for it, up to 35rem on a phone, and the first view holds every node above the controls.
 */
export const TallFirstView: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={TALL_TB} label="Đường tiền về và đường cộng điểm" height="sm" caption="Relay đọc outbox rồi mang event sang Loyalty." />
    </Both>
  ),
};

const WIDE_SAGA = `flowchart LR
  C([Lời gọi từ ngoài]) --> O[orders :4001 saga.ts]
  O -.-> OD[(orders)]
  O --> PA[payments :4002]
  O --> ST[stock :4003]
  O --> NO[notify :4004]
  PA -.-> PD[(payments)]
  PA -.-> RD([redis])
  ST -.-> SD[(stock)]
  NO -.-> ND[(notify)]
  class O accent`;

/**
 * A wide drawing (Next UI audit round 3, the Essentials v2 lesson at 390px: laid out top-down it was still wider than the frame, "stock :4003" clipped
 * and "notify :4004" with its database outside). The first view is the whole drawing, contain-fitted; the reader zooms in for the words.
 */
export const WideFirstView: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={WIDE_SAGA} label="Các dịch vụ của saga đặt hàng" height="md" caption="orders điều phối; mỗi dịch vụ giữ database của nó." />
    </Both>
  ),
};

const PATHS_LR = `flowchart LR
  K[Khách xem trang] --> A[3 máy chủ web]
  A r1@--> R[(Redis: hỏi giá trước)]
  A r2@--> P[(Postgres: giá gốc)]
  M[Marketing đổi giá] w1@--> P
  M w2@--> R
  R@{ icon: "cache" }
  P@{ icon: "database" }
  class r1,r2 info
  class w1,w2 accent`;

/** A small glyph standing in for the logo an app passes: a database drum, in the current colour. */
const Glyph = ({ rings }: { readonly rings: number }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
    <ellipse cx={8} cy={3.5} rx={5.5} ry={2} />
    {Array.from({ length: rings }, (_, index) => <path key={index} d={`M2.5 ${String(3.5 + (index + 1) * 4)}c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2`} />)}
    <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
  </svg>
);

/**
 * Two flows through the same stores (owner 2026-11-24): the read path in `info`, the write path in `accent`, by Mermaid's own edge ids and `class`; a
 * legend says which is which; the stores carry the app's icons (`R@{ icon: … }`, drawn from `icons`). Every edge is its own line: two edges never leave or
 * enter a node at one point, so no junction dot is drawn and each edge keeps its arrowhead.
 */
export const TonedPaths: Story = {
  render: () => (
    <Both>
      <MermaidDiagram
        source={PATHS_LR}
        label="Đường đọc và đường ghi giá"
        height="md"
        icons={{ cache: <Glyph rings={1} />, database: <Glyph rings={2} /> }}
        legend={[{ tone: 'info', label: 'Đường đọc' }, { tone: 'accent', label: 'Đường ghi' }]}
        caption="Đường ghi đổi cả Postgres và Redis."
      />
    </Both>
  ),
};

// The shop-giay architecture of the lesson: four Express services behind the customer, each with its own Postgres, payments with a Redis too. A call
// between services is a plain link (solid, accent); a service reading or writing its store is a dotted link (`-.->`, dashed, neutral). The port of a
// service is the end of its label; `class P edit` marks the service the learner edits; `click X call note() "…"` gives a step its description line.
const SHOP_GIAY = `flowchart LR
  K[Khách] --> O[orders :4001]
  subgraph D["Docker trên máy bạn"]
    O --> P[payments :4002]
    O --> S[stock :4003]
    O --> N[notify :4004]
    O -.-> OD[(orders db)]
    P -.-> PD[(payments db)]
    S -.-> SD[(stock db)]
    N -.-> ND[(notify db)]
    P -.-> R[(redis)]
  end
  D@{ icon: "docker" }
  O@{ icon: "express" }
  P@{ icon: "express" }
  S@{ icon: "express" }
  N@{ icon: "express" }
  OD@{ icon: "postgresql" }
  PD@{ icon: "postgresql" }
  SD@{ icon: "postgresql" }
  ND@{ icon: "postgresql" }
  R@{ icon: "redis" }
  class P edit
  click O call note() "Nhận đơn của khách rồi gọi payments, stock và notify"
  click P call note() "Thu tiền; giữ phiên thanh toán trong Redis"`;

/**
 * The shop-giay architecture with the built-in tech logos (owner 2026-11-26, graph v2): the source names its logos only by `R@{ icon: "name" }` and passes
 * no `icons`. Each logo stands in its own chip, filled with the brand's colour where it keeps 3:1 on the chip and with the node's ink where it does not
 * (Express black on the dark chip). A service shows its port as a muted pill; payments carries the "learner edits here" pencil; the stores are tinted
 * cylinders; calls are solid accent lines and data dashed neutral ones, with the legend chip in the corner because both are there.
 */
export const TechLogos: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={SHOP_GIAY} label="Kiến trúc shop giày" height="md" labels={{ calls: 'Gọi', data: 'Dữ liệu', edit: 'bạn sửa ở đây' }} caption="Mỗi dịch vụ Express giữ database Postgres của nó; payments có thêm Redis." />
    </Both>
  ),
};

// The lesson's system as Essentials draws it (owner 2026-11-26, the canvas): the customer from outside, orders the learner edits, its three calls numbered in
// order, every service over its own store, all in the Docker frame. Built the way the app builds it from the lab record (`-.-` a service's own database).
const SAGA_ROWS = `flowchart LR
  K(["Khách"])
  subgraph D["Docker trên máy bạn"]
    O["orders :4001"]
    OD[("orders")]
    O -.- OD
    P["payments :4002"]
    PD[("payments")]
    P -.- PD
    P -.-> R(["redis"])
    S["stock :4003"]
    SD[("stock")]
    S -.- SD
    N["notify :4004"]
    ND[("notify")]
    N -.- ND
    O -->|"1 trừ tiền"| P
    O -->|"2 giữ hàng"| S
    O -->|"3 gửi email"| N
  end
  K --> O
  D@{ icon: "docker" }
  O@{ icon: "express" }
  P@{ icon: "express" }
  S@{ icon: "express" }
  N@{ icon: "express" }
  OD@{ icon: "postgresql" }
  PD@{ icon: "postgresql" }
  SD@{ icon: "postgresql" }
  ND@{ icon: "postgresql" }
  R@{ icon: "redis" }
  class O edit`;

/**
 * The architecture rows (owner 2026-11-26, the Essentials canvas): a hub calling services, each over its own stores, is drawn by rows instead of ELK. The
 * customer on top; orders centred, wider, in the accent frame of the node the learner edits, its own database beside it; ONE trunk from orders down to a
 * bar and a drop into each service with the call's number on it (the merge-bar rule); each service over its stores. The legend chip names the third
 * mark. Under 0.8 zoom in its frame (a phone) the same source falls back to ELK.
 */
export const ArchitectureRows: Story = {
  render: () => (
    <Both>
      <MermaidDiagram
        source={SAGA_ROWS}
        label="Hệ thống trên máy bạn"
        height="md"
        labels={{ calls: 'Lời gọi giữa dịch vụ, đánh số theo thứ tự', data: 'Dữ liệu riêng của dịch vụ', edit: 'Nơi có file bạn sửa' }}
        caption="Khách gọi orders; orders gọi lần lượt payments, stock và notify."
      />
    </Both>
  ),
};

/**
 * Hover focus (owner 2026-11-26): pointing at a step lights it, its neighbours and their edges, and dims the rest; Tab focus does the same, and Enter
 * opens the step's description line (its Mermaid tooltip), Escape closes it. Point at payments, or Tab to orders and press Enter, to see it.
 */
export const HoverFocus: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={SHOP_GIAY} label="Kiến trúc shop giày" height="md" />
    </Both>
  ),
};

// The lesson's cache-aside read (owner 2026-11-23: "if else mới rẽ nhánh và arrow nối nhau"): the condition is a decision, each answer its own edge, and
// both branches rejoin before "Trả giá".
const ASIDE_TB = `flowchart TB
  U[Khách mở trang] --> G[GET giá trong Redis]
  G --> D{Có giá trong Redis?}
  D -->|Không| S[SELECT từ Postgres]
  S --> W[SET với TTL 30 giây]
  D -->|Có| R([Trả giá])
  W --> R`;

/**
 * A flowchart drawn down, the faulty step by the `tones` map (its node id). A branch is an if/else: the decision is entered at its top vertex, "Không" goes
 * straight on out of the bottom vertex and "Có" out of the side vertex, each word at its own vertex; the two branches rejoin at one junction above "Trả giá",
 * which one arrowhead enters.
 */
export const FlowchartDown: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={ASIDE_TB} label="Cache-aside" height="lg" tones={{ W: 'danger' }} caption="Bước SET có thể đến sau lệnh xóa." />
    </Both>
  ),
};

// The four shapes of a flow that is more than one if/else (owner 2026-11-23: "Chốt"): a switch, a parallel, a loop and a foreach. Each is plain Mermaid.
const SWITCH_TB = `flowchart TB
  A[Nhận thanh toán] --> S{Loại?}
  S -->|Thẻ| T[Cổng thẻ]
  S -->|Ví| V[Ví điện tử]
  S -->|Khác| K[Báo lỗi]
  T --> Z([Xác nhận])
  V --> Z
  K --> Z`;

const SWITCH_MANY_TB = `flowchart TB
  A[Nhận thanh toán] --> S{Loại thanh toán?}
  S -->|Thẻ| T[Cổng thẻ]
  S -->|Ví| V[Ví điện tử]
  S -->|Ngân hàng| C[Đối soát]
  S -->|Trả sau| P[Hợp đồng]
  S -->|Khác| K[Báo lỗi]
  T --> Z([Xác nhận])
  V --> Z
  C --> Z
  P --> Z
  K --> Z`;

/**
 * A switch: one decision with an exit for each case, left to right in the order written (the first out of the side vertex, the last out of the other,
 * the ones between along the slanted sides), each case's words on its own edge at its port; the default ("Khác") is the one written last. The branches
 * rejoin at one junction above "Xác nhận".
 */
export const Switch: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={SWITCH_TB} label="Chọn cổng theo loại thanh toán" height="lg" caption="Mỗi loại thanh toán một lối ra; lối cuối là Khác." />
    </Both>
  ),
};

/** A switch of five cases: the exits between the side vertices leave the slanted sides, each with its words clear of the side; the drawing is wider than a phone, so there it opens whole under the readable zoom and the reader zooms in. */
export const SwitchMany: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={SWITCH_MANY_TB} label="Chọn cổng theo loại thanh toán (năm loại)" height="lg" caption="Năm lối ra: hai ở đỉnh bên, ba dọc cạnh xiên và đáy." />
    </Both>
  ),
};

const PARALLEL_TB = `flowchart TB
  A[Đơn được duyệt] --> F@{ shape: fork, label: "Song song" }
  F --> B[Gửi email]
  F --> C[Trừ kho]
  F --> D[Giao hàng]
  B --> J@{ shape: join }
  C --> J
  D --> J
  J --> Z([Hoàn tất đơn])`;

/** A parallel: a fork bar (a thin solid bar, "Song song" above its left end) splits the flow into branches side by side and a join bar merges them before the flow goes on. */
export const Parallel: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={PARALLEL_TB} label="Xử lý đơn song song" height="lg" caption="Ba việc chạy cùng lúc; chỉ khi cả ba xong đơn mới hoàn tất." />
    </Both>
  ),
};

const LOOP_TB = `flowchart TB
  A[Lấy danh sách đơn] --> L{Còn nữa?}
  L -->|Có| B[Xử lý đơn kế tiếp]
  B --> C[Ghi kết quả]
  C --> L
  L -->|Không| Z([Xong])`;

/** A loop: the end of the body returns to the decision ("Còn nữa?", Có into the body, Không out), by a dashed back edge on the outside with one bend. */
export const Loop: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={LOOP_TB} label="Xử lý từng đơn trong danh sách" height="lg" caption="Nét đứt là đường quay lại: hết đơn thì ra." />
    </Both>
  ),
};

const FOREACH_TB = `flowchart TB
  A[Lấy danh sách đơn] --> E
  subgraph E["Với mỗi đơn ×3"]
    B[Kiểm tra tồn kho] --> C[Đóng gói]
  end
  class E foreach
  E --> Z([Gửi báo cáo])`;

/** A foreach: a dashed frame ("repeats") titled "Với mỗi đơn ×3" round the body steps, entered at its top and left at its bottom. */
export const Foreach: Story = {
  render: () => (
    <Both>
      <MermaidDiagram source={FOREACH_TB} label="Xử lý từng đơn" height="lg" caption="Khung nét đứt lặp lại cho từng đơn." />
    </Both>
  ),
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
};
