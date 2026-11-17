# {{project}} illustration

The concept of the app's AI images (contexts/project/brand.md PROJECT-BRAND-2). The base prompt every image starts with is
`illustration.yaml` (`basePrompt`, versioned); it is not copied here. Edit both to the app's brand; a change of the base text raises its version.

## Look

- 3D clay or soft-plastic, a white or transparent background, a soft light from the top left.
- One object plus at most one accent element.
- Only the brand colours (the tokens of `brand.md`) plus neutral grey and cream.
- No text, no medical crosses, no faces.
- Square, 1024 x 1024 px.

## Where an illustration stands

Page-level states only: the first visit, a whole-page empty state, the paywall, the 404 page and the 500 page. Never on a working screen,
never inside a list or a form. Rendered at 160 px at 1440 and 120 px at 390.

## References

One to three approved images in `references/` show the concept; a `subject` names the reference it follows. A reference is approved by the owner and tracked.
TODO(brand): add the reference images once the first one is approved.

## Prompt files

An image is generated into `statics/illustrations/<area>/<name>.<ext>` with a sibling `<name>.prompt.yaml`: `basePrompt: { version }`, `subject`, `prompt`
(the base text, then the subject), `model`, `seed`, `ratio`, `aiGenerated: true` and `approvedBy`. The harness check refuses a prompt file made from an old version.
