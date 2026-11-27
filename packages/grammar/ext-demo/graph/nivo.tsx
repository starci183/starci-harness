import { useEffect, type ReactElement } from "react"
import { FlowGraph, findOverlaps, layoutLayered, resolveFlow, type FlowNode, type GraphEdge } from "../../src/core/ext/graph/index.ts"
import { WORDS } from "./stories.tsx"

/**
 * Two real NIVO workflows (Hiền Mai Spa, read from the dev workspace 2026-11-27), drawn as NIVO's run overlay draws them: the layered layout left to right,
 * every outcome its own edge with NIVO's Vietnamese words (a refusal carries its whole reason). The proof of the layered layout: `window.graphOverlaps` is
 * `findOverlaps` of the same model and layout, and the page's own check reads the drawn edges and pills against the drawn cards.
 */
interface RawGraph {
    readonly start: string
    readonly nodes: readonly (readonly [string, string, string | null, boolean])[]
    readonly edges: readonly (readonly [string, string, string])[]
}
const RAW: { readonly deposit: RawGraph; readonly multiPost: RawGraph } = {"deposit":{"start":"open","nodes":[["open","wait",null,true],["plan","node","Soạn thông tin chuyển khoản cọc",false],["can-send","if",null,false],["send-qr","node","Gửi trả lời tin nhắn",false],["tell-asked","node","Báo nhóm về tiền cọc",false],["paid-check","if",null,false],["await-paid","wait",null,false],["is-enough","if",null,false],["mark-paid","node","Ghi lịch hẹn đã cọc",false],["has-lead","if",null,false],["win","node","Chốt lead",false],["can-thank","if",null,false],["thank","node","Gửi trả lời tin nhắn",false],["tell-paid","node","Báo nhóm về tiền cọc",false],["deposited","end",null,false],["tell-short","node","Báo nhóm về tiền cọc",false],["short","end",null,false],["tell-expired","node","Báo nhóm về tiền cọc",false],["expired","end",null,false]],"edges":[["open","plan","event"],["plan","can-send","ok"],["can-send","send-qr","yes"],["can-send","tell-asked","no"],["send-qr","tell-asked","ok"],["send-qr","tell-asked","declined"],["send-qr","tell-asked","refused:contact_erased"],["send-qr","tell-asked","refused:route_held"],["tell-asked","paid-check","ok"],["paid-check","is-enough","yes"],["paid-check","await-paid","no"],["await-paid","is-enough","event"],["await-paid","tell-expired","timeout"],["is-enough","mark-paid","yes"],["is-enough","tell-short","no"],["mark-paid","has-lead","ok"],["has-lead","win","yes"],["has-lead","can-thank","no"],["win","can-thank","ok"],["can-thank","thank","yes"],["can-thank","tell-paid","no"],["thank","tell-paid","ok"],["thank","tell-paid","declined"],["thank","tell-paid","refused:contact_erased"],["thank","tell-paid","refused:route_held"],["tell-paid","deposited","ok"],["tell-short","short","ok"],["tell-expired","expired","ok"]]},"multiPost":{"start":"open","nodes":[["open","wait",null,true],["plan","node","Chọn kênh sẽ đăng",false],["prepare","node","Chuẩn bị ý bài cho Studio",false],["draft","node","Viết bài cùng AI",false],["post-all","node","Đăng cùng lúc lên các kênh",false],["settle","node","Gom kết quả từng kênh",false],["revise","wait",null,false],["tell","node","Báo kết quả từng kênh",false],["finished","end",null,false],["declined","end",null,false]],"edges":[["open","plan","event"],["plan","prepare","ok"],["prepare","draft","ok"],["draft","post-all","ok"],["draft","declined","declined"],["post-all","settle","ok"],["post-all","revise","declined"],["settle","tell","ok"],["revise","prepare","event"],["revise","prepare","timeout"],["tell","finished","ok"]]}}

const EDGE_WORDS: Readonly<Record<string, string>> = { ok: "xong", yes: "có", no: "không", event: "có sự kiện", timeout: "quá hạn", declined: "không duyệt" }
const edgeWord = (key: string): string => (key.startsWith("refused:") ? "Bị từ chối: một điều kiện chưa đạt nên bước không chạy" : (EDGE_WORDS[key] ?? key))
const KIND_WORDS: Readonly<Record<string, string>> = { if: "Rẽ nhánh", wait: "Chờ sự kiện", end: "Kết thúc" }

/** The edges that return to a step already on the walk from the start, as NIVO finds them (`backEdgeIndexes`). */
const backOf = (graph: RawGraph): ReadonlySet<number> => {
    const out = new Map<string, number[]>()
    graph.edges.forEach(([from], index) => out.set(from, [...(out.get(from) ?? []), index]))
    const back = new Set<number>()
    const done = new Set<string>()
    const onWalk = new Set<string>()
    const walk = (key: string): void => {
        onWalk.add(key)
        for (const index of out.get(key) ?? []) {
            const target = graph.edges[index]?.[1] ?? ""
            if (onWalk.has(target)) back.add(index)
            else if (!done.has(target)) walk(target)
        }
        onWalk.delete(key)
        done.add(key)
    }
    walk(graph.start)
    return back
}

/** A NIVO graph as FlowGraph nodes and edges; `run` marks the steps a run went through and the edges it took (by index). */
const flowOf = (graph: RawGraph, run?: { readonly done: readonly string[]; readonly taken: readonly number[] }): { readonly nodes: FlowNode[]; readonly edges: GraphEdge[] } => {
    const back = backOf(graph)
    const nodes = graph.nodes.map(([key, kind, title, isStart]): FlowNode => ({
        id: key,
        label: isStart ? "Khởi động" : (title ?? KIND_WORDS[kind] ?? key),
        kind: isStart ? "event" : kind === "if" ? "condition" : kind === "wait" ? "wait" : kind === "end" ? "end" : "action",
        ...(run === undefined ? {} : { status: run.done.includes(key) ? "done" : "todo" }),
    }))
    const edges = graph.edges.map(([from, to, label], index): GraphEdge => ({
        id: `${from}>${to}:${String(index)}`,
        source: from,
        target: to,
        label: edgeWord(label),
        ...(back.has(index) ? { variant: "back" as const } : run?.taken.includes(index) === true ? { variant: "taken" as const } : {}),
    }))
    return { nodes, edges }
}

/** The layout's own check, on window for the screenshot script. */
const Proof = ({ nodes, edges }: { readonly nodes: readonly FlowNode[]; readonly edges: readonly GraphEdge[] }): null => {
    useEffect(() => {
        const model = resolveFlow(nodes, edges, "LR", "Bỏ qua", "layered")
        void layoutLayered(model.sizes, model.links, { direction: "LR" }).then((layout) => {
            Object.assign(window, { graphOverlaps: findOverlaps(model.sizes, model.links, layout) })
        })
    }, [nodes, edges])
    return null
}

const Graph = ({ label, flow }: { readonly label: string; readonly flow: { readonly nodes: FlowNode[]; readonly edges: GraphEdge[] } }): ReactElement => (
    <>
        <Proof nodes={flow.nodes} edges={flow.edges} />
        <FlowGraph label={label} nodes={flow.nodes} edges={flow.edges} layout="layered" direction="LR" statusLabels={WORDS} skippedLabel="Bỏ qua" />
    </>
)

const depositRun = flowOf(RAW.deposit, {
    // The run went in by the order event, wrote the transfer details, could send, and the reply was refused: it went on to tell the team.
    done: ["open", "plan", "can-send", "send-qr", "tell-asked"],
    taken: [0, 1, 2, 6],
})

export const NIVO_STORIES: readonly { readonly id: string; readonly title: string; readonly note: string; readonly render: () => ReactElement }[] = [
    { id: "nivo-deposit", title: "NIVO: Thu tiền cọc SePay", note: "hienmaispa.deposit, bố cục layered: cổng theo dòng, cạnh vuông góc, nhãn có chỗ riêng, cạnh quay lại đi vòng ngoài.", render: () => <Graph label="Thu tiền cọc SePay" flow={flowOf(RAW.deposit)} /> },
    { id: "nivo-deposit-run", title: "NIVO: Thu tiền cọc SePay, một lượt bị từ chối", note: "Lượt chạy đi qua nhánh bị từ chối: lý do không nằm trên đường nối.", render: () => <Graph label="Thu tiền cọc SePay" flow={depositRun} /> },
    { id: "nivo-multi-post", title: "NIVO: Đăng đa kênh theo giờ", note: "hienmaispa.multi-post: chờ duyệt quay lại bước chuẩn bị (có sự kiện, quá hạn) vòng ngoài, nét đứt.", render: () => <Graph label="Đăng đa kênh theo giờ" flow={flowOf(RAW.multiPost)} /> },
]
