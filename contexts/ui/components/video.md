# Video

Contract: [Video](../../grammars/contract.md#video). Vendor: none (a native `video`; hls.js and dash.js for streams).

## Job
Play one video in a box that holds its ratio, loading nothing until it is near the reader.

## Choose

Choice `video.choose.sources`: which files the author lists, in the order of preference. The first source the browser can play is the one it loads.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| clip | a short recording (a demo, a lesson clip, a product loop) | `video/webm` then `video/mp4`: both containers, the lighter first | judgement |
| long | a long recording, or one that must adapt to the connection | an HLS playlist (`application/vnd.apple.mpegurl`): native in Safari, hls.js elsewhere; then an MP4 as the last resort | judgement |
| dash | the media only exists as an MPEG-DASH manifest (`application/dash+xml`) | that source, dash.js plays it; list a file after it when one exists | judgement |

Choice `video.choose.behaviour`: how the video starts.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| watch | the reader came to watch | `controls` (the default), a `poster`, no `autoPlay` | judgement |
| ambient | a muted loop that carries no information (a background) | `autoPlay` `loop` and `controls={false}`; the browser may refuse it and the poster stays | judgement |
| first screen | the video is in the first screen | `loading="eager"`; every other video keeps `lazy` | judgement |

Choice `video.choose.captions`: what the speech has.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| spoken | the video has speech or relevant sounds | a `tracks` entry of kind `captions` (WebVTT), `isDefault` on the app's language | judgement |
| translated | the speech is translated for other readers | one `subtitles` track per language, each with `srcLang` | judgement |
| silent | nothing is said or heard | no track; never a placeholder track | judgement |

Choice `video.choose.ratio`: `16:9` (the default) for a landscape recording, `9:16` for a phone recording, `1:1` for a square one; the ratio
of the file, never a crop.

## Variants
`ratio`, `controls`, `autoPlay`, `loop` and `loading` are facts about the video. A source and a track name their file by `src` or by a
`staticsKey` (see [image](image.md) `image.choose.source`); the poster does too.

## Size
No size scale: the box takes its host's width and holds the ratio; the app bounds the width with its layout. The corner is the Grammar's one
radius.

## States
Before attaching: the poster in the ratio box (`preload="none"`, no network). Loading: a shimmer over the poster until the first frame.
Ready: the browser's own player. Error: the stream or file failed, and unsupported: no listed source can play here; each draws a neutral
notice with a glyph and one line, in the box, with the app's words through `labels` (English by default). `autoPlay` is muted and inline by
construction and does nothing when the reader prefers reduced motion. Region loading draws the ready box under a shimmer.

## Owner split
- **Grammar owns:** the source pick, lazy attach, the dynamic load of hls.js and dash.js, the destroy on unmount, the states, the ratio box.
- **Knowledge decides:** the source order, the behaviour, the track kinds (the tables above).
- **App author decides:** the files, the captions, the labels in its locale, the poster.

## Rules
A11Y-2, MOTION-2; lint `starci-grammar/no-raw-media` (R442).
