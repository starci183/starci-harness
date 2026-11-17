# {{project}} media

The concept of the app's other generated media: social images, video b-roll and the AI presenter (contexts/project/brand.md PROJECT-BRAND-2).
The base prompt of each is a named entry of `media.yaml` (`bases`, versioned); it is not copied here. The illustration keeps its own base in
`illustration.yaml` and is read as the base named `illustration`. Edit both files to the app's brand; a change of a base text raises its version.

## Bases

| base | for | framing |
|---|---|---|
| `social-image` | a still for a social post | 4:5 or 1:1, photographic, daylight |
| `video-broll` | a short clip laid under a voice or a caption | 9:16, calm, real service-business settings |
| `presenter` | the frame and background of an AI presenter | 9:16, chest up, plain studio |

A base added here is a lowercase kebab-case name, with `{ version, text }`; `illustration` is reserved.

## What a base never asks for

- No text, letters or numbers in the pixels. A caption, a price or a name is laid over the media afterwards; a model draws words badly, and Vietnamese worst.
- No logos, signage or watermarks, and no close-up faces.
- The brand colour is an accent only, named by the token of `brand.md`, never by a value.

## Prompt files

A generated file goes under `statics/` with a sibling `<name>.prompt.yaml`: `basePrompt: { name, version }` (the name is one of the bases above; omitted it is
`illustration`), `subject`, `prompt` (the base text, then the subject), `model`, `seed`, `aiGenerated: true` and `approvedBy`. The harness check refuses a
prompt file that names an unknown base or records an old version of it.
