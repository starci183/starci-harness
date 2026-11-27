/** What one row of a diff is: added on the new side, deleted from the old side, or the same on both. */
export type CodeDiffKind = "add" | "del" | "same"

/** One row of a diff: its kind and its text, without the `+`, `-` or space a unified diff puts before it. */
export type CodeDiffLine = { readonly kind: CodeDiffKind; readonly text: string }

/** A diff as `CodeBlock` takes it: its rows, or a unified diff (`git diff` output, or just its `+`/`-`/space lines) the block parses. */
export type CodeDiff = string | readonly CodeDiffLine[]

/** The header lines of a unified diff that are not rows of code: the file names, the hunk heads, git's own lines. */
const HEADER = /^(?:diff --git |index |--- |\+\+\+ |@@ |\\ No newline|new file mode |deleted file mode |similarity index |rename (?:from|to) )/

/**
 * The rows of a unified diff, in order. A line opening with `+` is added, with `-` deleted, with a space (or nothing: an editor may strip
 * the space of an empty unchanged line) the same; the file and hunk headers are skipped. A trailing newline adds no row.
 */
export const parseUnifiedDiff = (text: string): CodeDiffLine[] =>
    text
        .replace(/\r\n?/g, "\n")
        .replace(/\n$/, "")
        .split("\n")
        .filter((line) => !HEADER.test(line))
        .map((line): CodeDiffLine => {
            const sign = line.charAt(0)
            if (sign === "+") return { kind: "add", text: line.slice(1) }
            if (sign === "-") return { kind: "del", text: line.slice(1) }
            return { kind: "same", text: sign === " " ? line.slice(1) : line }
        })

/** The rows of a diff, parsing it when it is a unified diff string. */
export const diffRows = (diff: CodeDiff): readonly CodeDiffLine[] => (typeof diff === "string" ? parseUnifiedDiff(diff) : diff)

/**
 * The text of every row of a diff, one per line, in order: what to highlight so the tokens line up with the rows
 * (`highlightCode(diffCode(diff), lang)` on the server, `useCodeTokens(diffCode(diff), lang)` on the client).
 */
export const diffCode = (diff: CodeDiff): string => diffRows(diff).map((row) => row.text).join("\n")

/** The code after the change (the added and the unchanged rows): what Copy copies from a diff. */
export const diffAfter = (diff: CodeDiff): string => diffRows(diff).filter((row) => row.kind !== "del").map((row) => row.text).join("\n")
