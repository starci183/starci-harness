# Render proof

Playwright's `toHaveScreenshot` over every story of the built Storybook (`npm run build-storybook`, then `npm run prove-render`):
both families, light and dark, at 1920 and 390, device scale factor 2.

**The baselines in `baselines/` are unreviewed.** They detect change; they are not approved looks, and a diff says "changed", never
"wrong". Only the pictures named in [approved.json](approved.json) are approved by the owner (today: the chat renderer). A lane refreshes
unreviewed baselines freely with `npm run prove-render:accept`; a change to an approved picture needs a person, who runs
`npm run prove-render:approve` after looking at it.

Baselines are taken in the pinned Playwright image CI runs in (Linux), not on a laptop:

```sh
docker run --rm --ipc=host -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
  node node_modules/@playwright/test/cli.js test --update-snapshots
```
