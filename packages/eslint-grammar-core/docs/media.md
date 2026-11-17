# Media renders through Image, Video and Illustration

Law module: `media.ts`. Catalogue: R436 FE_RAW_MEDIA_ELEMENT.

A picture, a video or decorative art is drawn by the Grammar's `Image`, `Video` or `Illustration`. A raw `<img>`,
`<video>` or `<picture>` reserves no ratio before its bytes arrive (the page jumps), loads at once whatever the viewport,
draws no loading or failure state, picks no rendition for the screen and carries none of the Grammar's contract: a required
`alt`, a caption, a zoom, WebVTT tracks, a stream player, the theme's one corner radius. The three components own that once.

The rule is an error in `coreGrammarConfig`; it cannot be switched off or suppressed inline. It applies to the files
`no-raw-structural-element` judges: app source that composes the Grammar and any workspace package except the
`<family>-ui` package, whose components are the renderers (the Grammar's own implementation is the one place a raw media
element belongs). The raw elements of a `Freestyle` region are exempt. `audio` is not refused: the Grammar has no component
for it.

## `starci-grammar/no-raw-media`

Every JSX `img`, `picture` and `video` element is a finding, and each finding names the component that draws what the tag
stands for:

| Raw element | Use |
|---|---|
| `img` | `Image` (a picture with content), or `Illustration` (decorative art, `alt` empty) |
| `picture` | `Illustration` with `compact` (art direction), or `Image` with `renditions` and `sizes` (resolution switching) |
| `video` | `Video` with `sources`, `poster` and `tracks` |

**Invalid** (`src/components/blocks/Feed/component.tsx`)

```tsx
<img src="/team.webp" alt="The team" />
<video src="/intro.mp4" controls />
```

**Valid**

```tsx
<Image staticsKey="photos/team.webp" alt="The team" ratio="4:3" renditions={[{ staticsKey: "photos/team-640.webp", width: 640 }]} sizes="100vw" />
<Video title="Introduction" sources={[{ src: "/intro.webm", type: "video/webm" }, { src: "/intro.mp4", type: "video/mp4" }]} poster={{ src: "/intro.jpg" }} />
<Illustration staticsKey="illustrations/hero/landing.webp" ratio="1:1" compact={{ staticsKey: "illustrations/hero/landing-narrow.webp", ratio: "4:3" }} />
```

**Finding code:** `FE_RAW_MEDIA_ELEMENT`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
