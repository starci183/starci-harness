# PDF: PdfViewer (`@starci/grammar/core/ext/pdf`)

Contract: [PDF](../../grammars/contract.md#pdf). Vendor: [small members](../../vendor/heroui.md#small-members) (Skeleton, Alert). Library: pdfjs-dist, an
optional peer of the Grammar at an exact version.

## Job
Show a PDF document (a contract, an invoice, a scanned form, a report the app stores), a page at a time. Use it ONLY for showing PDF
documents: it is not a general file preview, an image viewer, an editor or a way to draw anything else. An app never imports `pdfjs-dist`
(`DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`, lint `starci-grammar/no-graph-or-animation-library`).

## Where it lives
An ext of the core grammar: `import { PdfViewer } from "@starci/grammar/core/ext/pdf"`. It imports core's components and tokens; core
never imports it. `pdfjs-dist` is an OPTIONAL peer dependency of `@starci/grammar` (`peerDependenciesMeta.optional`), loaded lazily in
the browser the first time a viewer opens a file: an app that shows PDF documents installs it at the pinned version.

## API
- `source`: the file's URL (same origin or CORS-allowed) or its bytes (`ArrayBuffer`, `Uint8Array`). `ariaLabel` (required) names the document.
- `labels`: every word, with English defaults: `previousPage`, `nextPage`, `zoomIn`, `zoomOut`, `fitWidth` (e.g. "Vừa khung"), `download`,
  `pageOf(page, total)`, `errorTitle`, `retry`. `fileName` is the download's name; `onDownload` replaces the built-in download.
- `highlights` (the shape of Markdown's): `{ id, page, tone?, note? }` with either `rect` (PDF points from the page's top-left corner) or
  `start` / `end` (offsets into the page's text as `pageTextOf` joins pdfjs's text runs). Each draws as a tone-soft overlay (default
  `warning`); `onHighlightPress` makes them buttons named by `note`.
- `initialPage`, `onPageChange`, `height` (the page area in px, default 640), `isLoading` (follows a loading region).
- `workerSrc`: where pdfjs's worker is served. Default pdfjs's own `pdfjs-dist/build/pdf.worker.min.mjs`, resolved by the bundler from
  `import.meta.url` (webpack, Next.js Turbopack, Rspack); a bundler that does not resolve it (Vite) passes
  `import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"`: a `?url` import is the worker file as a bundler asset, the one reference to pdfjs-dist an app may write
  (the ext rule reads a `?url` import as an asset, never as the library's code).

## Look
A Grammar surface with a 1px separator border and no shadow; a toolbar of `IconButton`s (previous, next, zoom out, zoom in, download, each
40) and a neutral `Button` for fit to width, the page counter in the `body` role; the page drawn to a `<canvas>` (never an iframe) on the
secondary surface. One finger pans, two fingers pinch to zoom; the commands keep their desktop size on a phone. Loading is all Skeleton
(each command's box, the counter's line, the page box at A4 proportions), no words. A file that cannot be opened is a negative `Alert` with
a retry.
