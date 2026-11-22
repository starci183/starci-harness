# `@starci/grammar/core/ext/pdf`

The PDF extension of the core grammar: `PdfViewer`, for showing PDF documents. Use it ONLY to show a PDF document (a contract, an
invoice, a scanned form, a report the app stores); it is not a general file preview, an image viewer or an editor.

```tsx
import { PdfViewer } from "@starci/grammar/core/ext/pdf"

<PdfViewer
    source={url /* or the file's ArrayBuffer / Uint8Array */}
    ariaLabel="Hợp đồng 2026-11"
    fileName="hop-dong.pdf"
    labels={{ fitWidth: "Vừa khung", previousPage: "Trang trước", nextPage: "Trang sau", zoomIn: "Phóng to", zoomOut: "Thu nhỏ", download: "Tải xuống",
        pageOf: (page, total) => `${page} / ${total}`, errorTitle: "Không mở được tài liệu", retry: "Thử lại" }}
    highlights={[{ id: "price", page: 2, start: 120, end: 168, tone: "warning", note: "Giá đã đổi" }]}
/>
```

- Pages are drawn to a `<canvas>` by pdfjs, never an iframe, so the viewer works on phones and in headless shots. One finger pans, two
  fingers pinch to zoom; the commands keep their desktop size (IconButton 40, Button 40) on a phone.
- Built only from Grammar core: a surface with a 1px separator border and no shadow, `IconButton`, `Button`, `Text`, `Skeleton`, `Alert`.
- Loading (`isLoading`, or while the file opens) is all Skeleton: the commands' boxes and the page box, no words. A file that cannot be
  opened is a negative `Alert` with a retry.
- `highlights` mirror Markdown's: `{ id, page, tone?, note? }` with either `rect` (PDF points from the page's top-left corner) or
  `start` / `end` (offsets into the page's text as `pageTextOf(items)` joins pdfjs's `getTextContent().items`). Each is a tone-soft overlay;
  `onHighlightPress` makes them buttons named by `note`.
- Every word is a prop with an English default (`labels`); an app passes its own language.

## pdfjs-dist

`pdfjs-dist` is an OPTIONAL peer dependency of `@starci/grammar` at an exact version (see `peerDependencies`): install it only in an
app that shows PDF documents. It is imported lazily, in the browser, the first time a viewer opens a file; neither the core entry nor a
server render loads it. Only this ext imports it (lint `starci-grammar/no-graph-or-animation-library`, law
`DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`): an app never imports `pdfjs-dist`.

The worker: by default the viewer points pdfjs at its own `pdfjs-dist/build/pdf.worker.min.mjs`, resolved by the app's bundler through
`new URL(..., import.meta.url)` (webpack, Next.js Turbopack, Rspack). A bundler that does not resolve a package path there (Vite) passes
`workerSrc`, e.g. `import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"`. An app may also serve the file itself and pass its URL.
