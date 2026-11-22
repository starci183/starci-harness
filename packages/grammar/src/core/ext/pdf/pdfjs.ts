/**
 * The one door to `pdfjs-dist` (an OPTIONAL peer of the Grammar): loaded lazily on the first viewer that opens a document, in the browser
 * only, so neither the core entry nor a server render ever reaches it. The worker is the app's `workerSrc` when it passes one; otherwise
 * pdfjs's own worker file beside the library (`pdfjs-dist/build/pdf.worker.min.mjs`, resolved by the app's bundler from `import.meta.url`).
 */
type PdfjsModule = typeof import("pdfjs-dist")

let pending: Promise<PdfjsModule> | undefined

/** The worker pdfjs ships, as the app's bundler resolves it (webpack, Turbopack and Rspack resolve a package path in `new URL`). */
export const defaultWorkerSrc = (): string => new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href

/** pdfjs, loaded once, with its worker set: the app's `workerSrc` wins; else the one already set; else pdfjs's own file. */
export const loadPdfjs = async (workerSrc: string | undefined): Promise<PdfjsModule> => {
    pending ??= import("pdfjs-dist")
    const pdfjs = await pending
    if (workerSrc !== undefined && workerSrc !== "") pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
    else if (pdfjs.GlobalWorkerOptions.workerSrc === "") pdfjs.GlobalWorkerOptions.workerSrc = defaultWorkerSrc()
    return pdfjs
}
