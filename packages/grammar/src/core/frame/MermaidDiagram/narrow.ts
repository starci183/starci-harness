/**
 * The phone fallback of a Mermaid diagram (owner 2026-11-23). Below `NARROW_WIDTH` a drawing is too small to read, so the frame
 * changes what it draws: a `sequenceDiagram` becomes a numbered list of its messages (who, to whom, what), and a flowchart drawn
 * across (`LR`, `RL`) is drawn down (`TD`) so its steps stack vertically. Every other diagram is drawn as it is.
 */

/** The width of the frame (px) below which the phone fallback applies: the Grammar's 30rem phone step. */
export const NARROW_WIDTH = 480

/** One message of a sequence diagram, in the order written. */
export type SequenceStep = { readonly from: string; readonly to: string; readonly text: string; readonly isReply: boolean }

const firstLine = (source: string): string => source.split("\n").map((line) => line.trim()).find((line) => line !== "" && !line.startsWith("%%")) ?? ""

/** Whether the source is a sequence diagram. */
export const isSequence = (source: string): boolean => /^sequenceDiagram\b/.test(firstLine(source))

const ARROW = /^(.+?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)(.+?)\s*:\s*(.*)$/

/** The messages of a sequence diagram, a participant's alias (`participant A as Alice`) resolved to its name; notes and blocks are skipped. */
export const sequenceSteps = (source: string): readonly SequenceStep[] => {
    const names = new Map<string, string>()
    const steps: SequenceStep[] = []
    for (const raw of source.split("\n").slice(1)) {
        const line = raw.trim()
        const alias = /^(?:participant|actor)\s+(\S+)\s+as\s+(.+)$/.exec(line)
        if (alias !== null) {
            names.set(alias[1] ?? "", (alias[2] ?? "").trim())
            continue
        }
        const message = ARROW.exec(line)
        if (message === null) continue
        const who = (id: string) => names.get(id.trim().replace(/^[+-]/, "")) ?? id.trim().replace(/^[+-]/, "")
        steps.push({ from: who(message[1] ?? ""), to: who(message[4] ?? ""), text: (message[5] ?? "").trim(), isReply: (message[2] ?? "").startsWith("--") })
    }
    return steps
}

/** A flowchart drawn across, redrawn down: `flowchart LR` / `graph RL` become `TD`; any other source is returned as it is. */
export const stackedFlowchart = (source: string): string =>
    source.replace(/^(\s*(?:%%[^\n]*\n\s*)*)(flowchart|graph)\s+(LR|RL)\b/, (_all, lead: string, kind: string) => `${lead}${kind} TD`)
