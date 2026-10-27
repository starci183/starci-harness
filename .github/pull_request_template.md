## What changes

<!-- The concept this change touches, in one or two sentences. -->

## Where the concept lives (CONTRIB-6)

<!-- Every place found for the concept's terms and how each changed, or why it stays. -->

## Proof

<!-- What you ran: the CLI's typecheck, lint and build, `node cli/dist/main.js check loosening`, the scratch-repository
     proof of a CLI change (CONTRIB-1), or `npm test` in a changed package (CONTRIB-2). -->

- [ ] `cd cli && npm run typecheck && npm run lint && npm run build`
- [ ] `node cli/dist/main.js check loosening` and `node cli/dist/main.js check secrets`
- [ ] A changed package's version and CHANGELOG are raised, and its specs pass
- [ ] Rule ids applied (CONTRIBUTING.md):
