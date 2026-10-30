// The types of runtime/scripts/hfs/project-graph.mjs.
import type { GraphViolation } from "./architecture/surface.mjs"

/** The lint-surface findings of the repository at `repoRoot`, by repository-relative path (built once per process and cached). */
export declare const projectGraph: (input: { readonly repoRoot: string; readonly runtimeRoot: string; readonly injectedTypeScript?: object }) => { readonly byFile: Map<string, GraphViolation[]>; readonly files: number }

/** Forget every cached project graph, so the next run reads the disk again. */
export declare const resetProjectGraphs: () => void
