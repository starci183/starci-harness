# Brand sheet

The brand an app's pictures and designs are made from: one folder, `.starcistacks/brand/`, that every design or image brief reads first.
It restates no token value and no grammar rule: the colours are the app's own token names, the components are the app's Grammar.
The Work record of the brand direction (`.starciwork/brand/index.yaml`, [work.md](work.md) PROJECT-WORK) is the owner's decision; this
folder is the sheet an agent prompts from, and it points at that record instead of copying it.

## PROJECT-BRAND-1 An app carries its brand sheet in `.starcistacks/brand/`, written once by scaffold and edited by the app

`.starcistacks/brand/` at the app root (slot `app.starcistacks.brand`; a reserved folder, never an environment) is tracked and holds:

| file | holds |
|---|---|
| `brand.md` | the product's name, the brand colour tokens by NAME (the token names of the app's theme file, such as its `brand.css`; never a hex or an `oklch` value, so a retheme never leaves the sheet stale) and the voice and tone |
| `illustration.md` | the concept of the AI images: the look, the colour limits, what is never drawn, where an image may stand and at what size |
| `illustration.yaml` | the machine-readable half of `illustration.md`: `basePrompt: { version, text }`, the one block every image prompt starts with, and its version (PROJECT-BRAND-2). The one place the base text is written; `illustration.md` links to it and never copies it |
| `media.md` | the concept of the other generated media (social images, video b-roll, the presenter): the framing of each base and what no base asks for. Optional, written by the scaffold |
| `media.yaml` | the named bases of that media: `bases: { <name>: { version, text } }`, the starter holding `social-image`, `video-broll` and `presenter` (PROJECT-BRAND-2). The one place those base texts are written; `media.md` links to it and never copies it |
| `references/` | one to three approved reference images (PNG or WebP, tracked) that show the concept; a prompt names the reference it follows |

The default concept a new app starts with, which the app edits to its own brand (owner 2026-11-24, replacing 3D clay): a calm, flat editorial
illustration with soft shading and thin clean outlines on a plain off-white ground; off-white and light grey with the brand colour as the single
accent; one helper character of the brand (NIVO: a crimson star; StarCi Next: a violet chip) appears in every scene and is the only face, people
are faceless flat figures; no text, letters, logos or UI screenshots; the whole subject inside the frame with a margin; square, 1024 px. An illustration stands on a page-level state only (a first visit, a whole-page empty state, a
paywall, the 404 and the 500 page), rendered at 160 px at 1440 and 120 px at 390; it never stands on a working screen.

**Why `illustration.yaml` and not a fenced block of `illustration.md`.** A check reads the version on every run, and a prompt file records it; a YAML
file parses with the one YAML reader of the harness and diffs as one line, where a block inside Markdown needs a second parser and breaks when
the prose around it is reflowed. The prose stays Markdown, the machine fact stays YAML, each in one place.

**Scaffold once, never managed.** `starci app scaffold` writes the starter from `templates/app/skeleton*/.starcistacks/brand/` with the project
name filled and placeholders (`TODO(brand)`) where the app decides; it has an empty `references/`. `starci app sync` never renders, compares
or overwrites it, because an app must be able to edit its own brand: it is an app-owned starter, like the rest of the skeleton, not a managed file. The managed
`.gitignore` block re-includes it (`!.starcistacks/brand/**`), so the references are tracked beside the sheet. An app that predates the folder
copies the starter from the template once.

## PROJECT-BRAND-2 An AI image is its basePrompt plus a subject, and its prompt file says which basePrompt

Every image prompt is the `basePrompt.text` of `illustration.yaml`, word for word, followed by the image's own `subject` (the one object and its one
accent, in plain words, with no style words of its own). A change to the base text raises `basePrompt.version`, and every image made from an older
version is made again.

**Named bases.** Other media than the clay illustration start from a named base of `media.yaml`: `bases: { <name>: { version, text } }`, a lowercase kebab-case name, with the same `{ version, text }` shape as `basePrompt`. `illustration` stays in `illustration.yaml` and is read as the base named `illustration` (so `media.yaml` may not define that name). The starter holds `social-image` (a 4:5 or 1:1 photographic still, the brand colour as an accent), `video-broll` (9:16, calm daylight, real service-business settings) and `presenter` (the framing and background of an AI presenter), each with no text, letters or numbers in the pixels: words are laid over the media afterwards. A prompt is the text of its base, a blank line, then the subject, and a console or code edit of a base raises its `version`.

The generated image goes under the app's statics folder, `statics/` at the app root ([statics.md](statics.md) owns it and the media
rule owns the keys it shares with the provenance of every generated image), beside a sibling `<name>.prompt.yaml`:

```yaml
basePrompt:
  name: illustration   # the base: `illustration` (the default, may be left out) or a name of media.yaml
  version: 1        # the version of that base the prompt was built from
subject: a contact card with one violet accent chip
prompt: <basePrompt.text> <subject>   # the whole text sent to the model
model: <the image model>
seed: 42
ratio: "1:1"
aiGenerated: true
approvedBy: <the person who approved the image>
```

The gate (R437, enforcer `brand`, owner `@starci/hfs` `runtime/scripts/hfs/rules/brand.mts`) judges the prompt files it finds under `statics/`:

- `HFS_BRAND_INVALID` (an error): `.starcistacks/brand/illustration.yaml` is not YAML, or its `basePrompt` is not `{ version: <integer from 1>, text: <non-empty> }`; or `.starcistacks/brand/media.yaml` is not YAML, or its `bases` is not a non-empty map of lowercase kebab-case names (other than `illustration`) to `{ version: <integer from 1>, text: <non-empty> }`.
- `HFS_BRAND_PROMPT_INVALID`: a `statics/**/*.prompt.yaml` exists and the app has neither `.starcistacks/brand/illustration.yaml` nor `media.yaml` to prompt from; or a prompt file records no `basePrompt.version`, or one other than the current version of the base it names; or it is not YAML, has no `subject`, or its `prompt` does not start with the current text of the base it names; or it names a `basePrompt.name` (the default is `illustration`) that neither `illustration.yaml` nor `media.yaml` defines. The message says which.

A prompt file is judged against the base it names, by that base's version and text. `HFS_BRAND_PROMPT_INVALID` is a warning in `--env local` (the brand prompt moves while images are redrawn) and an error in `--env prod`, the same
pattern as the gallery rules ([gallery.md](gallery.md) PROJECT-GALLERY-1). An app with no prompt file has no finding.

## PROJECT-BRAND-3 A design or image brief reads the brand folder first

Before it draws a screen, writes an image brief or runs an image tool, an agent reads `.starcistacks/brand/` whole: `brand.md` for the name, the
token names and the voice, `illustration.md` for the concept and the placements, `illustration.yaml` and `media.yaml` for the base prompts, and the reference
images. `/claude-design` ([skills/claude-design/SKILL.md](../../skills/claude-design/SKILL.md)) and the UI flow of the harness skill
([skills/starci/references/ui-on-grammar.md](../../skills/starci/references/ui-on-grammar.md)) start there, and a brief for an image states
the prompt as `basePrompt.text` plus the `subject`, never a prompt written from memory. A colour is named by its token, never by a value;
an illustration is placed only where `illustration.md` allows. The gallery and canvas rules ([gallery.md](gallery.md) PROJECT-GALLERY-6,
PROJECT-GALLERY-7) decide how a page is approved; this page decides what its pictures are made from.

## PROJECT-BRAND-4 The brand is one source: the site, the app and the canvas read the same colours

An app has ONE brand token file, `modules/brand/brand.css` of its front end (code rule [FE-CSS-3](../code/fe/ui.md#fe-css-3-colour-lives-in-one-brand-file)); the
marketing site, the console and every other web app import it through their one global stylesheet ([FE-CSS-4](../code/fe/ui.md#fe-css-4-one-global-stylesheet-per-web-app)),
and their 404, 500 and offline pages are the same shared components ([FE-STATE-PAGES](../code/fe/ui.md#fe-state-pages-one-page-per-system-state)). The canvas
([gallery.md](gallery.md) PROJECT-GALLERY-6) follows the same source:

- `.starcistacks/canvas/tokens.css` is generated from the brand file by `node node_modules/@starci/hfs/runtime/scripts/hfs/canvas-tokens.mjs` (`--check` writes nothing and exits 1 when it is stale): a stamp line (the brand file's path and the sha256 of its text), then the brand layer byte for byte. Run it after every brand change and commit the result.
- A canvas generator under `.starcistacks/canvas/gen/` holds no colour literal (a hex, a colour function, a named colour in a colour property, a Tailwind arbitrary or palette colour class); it writes `var(--token)` over `tokens.css`. The claude-design copy `gen/kit/` (the board's own chrome) is outside the rule.

Enforced by (R445, `packages/hfs/runtime/scripts/hfs/rules/brand-one.mts`):

- `FE_BRAND_NOT_ONE`: the web apps of a front end have no `modules/brand/brand.css`, or more than one.
- `FE_BRAND_CANVAS_LITERAL`: a canvas generator writes a colour literal.
- `FE_BRAND_CANVAS_TOKENS_STALE`: `.starcistacks/canvas/tokens.css` is absent or is not what the brand file generates.

The colour literals in TypeScript, in CSS and in inline styles are the lint of R61 ([FE-CSS-3](../code/fe/ui.md#fe-css-3-colour-lives-in-one-brand-file): eslint `no-raw-brand-value`, which now also refuses a Tailwind arbitrary named colour and a default-palette class, and stylelint `raw-brand-value`, which now also refuses a named colour in a colour property).
