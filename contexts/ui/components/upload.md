# Upload: Dropzone (`@starci/grammar/core/ext/dropzone`)

Contract: [Upload](../../grammars/contract.md#upload). Vendor: [small members](../../vendor/heroui.md#small-members) (Skeleton). Library: react-dropzone, pinned in `contexts/stack/pins.yaml`.

## Job
Take files and folders from the reader for the app to upload, and show each upload until it is done. Apps use this extension for
EVERY upload: never `react-dropzone` (or another upload library) imported directly (`DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`, lint
`starci-grammar/no-graph-or-animation-library`). The upload itself (a presigned PUT, the queue, the retry) is the app's; the zone gives it
the files and draws the status the app reports.

## Where it lives
An ext of the core grammar: `import { Dropzone } from "@starci/grammar/core/ext/dropzone"`. It imports core's components and tokens;
core never imports it. `react-dropzone` is an OPTIONAL peer dependency of `@starci/grammar` (`peerDependenciesMeta.optional`): an app
that uploads installs it at the pinned version. The zone loads react-dropzone lazily (a Skeleton of the zone shows until it arrives),
so a page without an upload never fetches it.

## Choose

| Row | When | Choose |
| --- | --- | --- |
| upload | the reader hands the product files or folders to keep (an attachment set, a document, a batch of photos) | `Dropzone` with `onFiles` and the app's `items` |
| one file | a single file (an avatar, one contract) | `Dropzone multiple={false}`: one file, no folder picker |
| a file as one action among others | a paperclip in a composer, an upload command in a toolbar | `FileButton` (`button.choose.role:file`); the files it gives go to the same upload |

## API
- `onFiles(files)`: the accepted files of one drop or pick, each `{ file, path }` with its path relative to what was dropped
  (`photos/2026/a.jpg`); a dragged folder is walked into its files, the folder picker (`webkitdirectory`) gives the same paths.
- `accept` (a MIME type to its extensions, `{ "image/*": [".png", ".jpg"] }`), `maxSize` (bytes), `maxFiles`, `multiple` (default
  true), `folders` (the folder picker beside the file picker, default true; never with `multiple={false}`).
- `target`: where the files go, in the drag-over title. `items`: the app's uploads, `{ id, name, type?, status, progress? }` with
  `status` one of `waiting | uploading | done | error`; `onRetry(id)` puts the retry on a failed row.
- `labels`: EVERY word, English by default; an app passes its own language (any subset). Words with a number or a name are
  functions, so the app owns its plurals.
- `isLoading` (or a loading region) draws the zone and its rows as Skeletons; `isDisabled` blocks drop and pick.

## States
- **Idle**: a surface with a 1px dashed `--border` edge and no shadow; a 24px cloud-upload icon, the title, the accepted-types line
  (the accepted extensions and the size limit, `caption`) and the border-look `Button` "choose files" (`intent="alternative"`), with
  "choose folder" beside it.
- **Drag-over**: the info soft surface (`--info-soft`, `--info-border`), "drop to upload to <target>" and the dragged count.
- **Rejected**: the danger soft surface (`--danger-soft`, `--danger-border`) with each reason in words: too big (with the limit), a
  type it does not accept, too many (more than `maxFiles`, which refuses the whole drop). The accepted files of the same drop still
  reach `onFiles`. The next drag or pick clears it.
- **Rows**: a 24px file-type icon (image, video, audio, pdf, sheet, archive, text, file), the name, a `Progress` in tone `info` and an
  `InlineStatus` of the three glyphs at 20px: circle-check "done", the spinning circle with the percent, the plain circle "waiting",
  circle-x "failed" followed by the retry `TextAction`.

## Keyboard and announcements
The zone is a tab stop named by its title; Enter or Space opens the file picker, and the buttons inside are their own tab stops.
A polite status region says the drag-over title, the refusal or the summary of the rows (`labels.summary`) as they change.

## Look
At 390 the zone is the same drawing, narrower; the buttons wrap under each other. The zone keeps one minimum height in every state
and as its Skeleton, so the rows under it never move.
