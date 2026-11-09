# Open questions

1. **`pattern` verbs:** their own group, or inside `app`?
2. **Placing a feature across running workflows.** Should the Supervisor place it by a path-ownership map kept as data,
   amending only the workflows that own the touched paths, with the model deciding only what the map cannot place?
3. **Who pushes in a lite app.** Under Orca, Debug alone merges and pushes ([authority/README.md](../authority/README.md)), and no worker,
   Kernel or Supervisor does. How does a lite chat agent (role `agent`), which has no Debug beside it, push?
4. **Secret scan reach.** The scan carries the provider shapes, forbidden paths and the quoted keyword assignment, not
   the unquoted dotenv form, SQL role passwords or badge-token exemptions. Add them, or accept the gap?
5. **Replan owner gate.** When a replan drops or redoes more than a threshold, should the Kernel hold it for the
   owner's yes before resuming, and at what threshold?
6. **A lingering red CI.** Fix forward only, as today, or revert the red commit automatically after N minutes?
7. **Worker guard.** A worker has full Bash: should a PreToolUse guard refuse dangerous commands, beside the
   `allowPaths` diff, the foreign-commit check and the secret and loosening scans at settle, and the secret scan at push?
8. **Scroll region height.** Does a contained scroll region fill its parent's block size, so the parent owns the
   height cap and one owner scrolls each axis, or does the region keep a cap of its own?
9. **Rating.** HeroUI ships no rating: is a rating one radio group of stars (the platform pattern for one value from a
   closed set), or another pattern?
10. **Final colours.** Are the grammar's colours final, so no package change, lane or law moves a colour on its own, and a
   law that only a colour change can satisfy (`DNA-COMMON-TREATMENT-TEXT-CONTRAST`) is exempt from the run until it is
   retired or the colour to move is named? Or may a law move a colour?
11. **Soft-treatment text contrast.** `DNA-COMMON-TREATMENT-TEXT-CONTRAST` fails on colour alone (a text on a soft card
   in core at 4.43:1 against 4.5:1, a text in offset-pop at 1:1) and runs as a known gap. Retire the law, or name the
   colours of the soft treatment to move?
12. **Saga and projection in lite.** The pattern topics ([saga.md](../code/be/saga.md),
   [projections.md](../code/be/projections.md)) describe each running in lite, while `app add saga|projection` serves
   full apps only. Do lite apps get both patterns (and their templates), or are they full-only?
13. **Branch protection on the app check.** Should an app's `main` branch protection require the CI check run, or do
   the pre-push gate and the release's warm-cache check remain the only holds?
14. **The e2e world in lite.** R32 (an app is proven by the e2e test world) and R47 (the e2e project of the one jest config)
   require a world lite forbids (R212). Scope both to the full edition, or state lite's proof (the wiring check and
   services) in their laws?
15. **Which logic roles owe a unit spec.** R281 asks a unit spec of every declared logic role, R47 full per-file coverage of
   logic-role files, and R102 places a unit spec only beside a unit-tested subject. One rule: every logic role owes a spec,
   or it owes coverage and a spec is optional?
16. **Where a capability reads its config.** R43 lets only `platform/config`'s `EnvSource`, `main.ts` and `<app>.env.ts`
   read the environment, while [code/be/config.md](../code/be/config.md) has a capability read typed options from its
   `*.config.ts`. Name `*.config.ts` in R43, or move the helpers to `main.ts` and `<app>.env.ts`?
17. **Own images: digest or version.** R164 pins a stack component image by digest or exact version. Pin the app's own
   images by digest only, as its release records already deploy them, or keep the version tag allowed?
18. **Rules that restate one law.** R06, R220 (lite only) and R277 each say a secret exists only sealed under
   `.starcistacks/<env>/secrets/`; R18 and R303 both forbid inline suppression; R22 and R72 both forbid a type assertion.
   Merge each set into one rule (R06, R303, R72), or keep them as separate enforcers?
19. **A message transport inside an api feature.** The back-end patterns let an api feature keep `transport/message`, while
   a reactor owns every consumer of another context's events. Keep the api allowance, or move every consumer into a
   reactor?
20. **Front-end tests in CI.** R97 says the front end has no tests, while the `fe` profile of
   [policy/quality.yaml](../../policy/quality.yaml) runs `unit` in CI. Drop `unit` from the `fe` profile, or admit front-end
   tests in R97?
21. **Finding codes with no rule.** The back-end and stack patterns name codes no rule of
   [hfs/rules.yaml](../hfs/rules.yaml) lists among its failure codes (`BE_APP_MODULE_LIST_INLINE`, `BE_REST_ROUTE_UNDECLARED`,
   `BE_WEBHOOK_INBOX_KEY`, `STACKS_REALTIME_SCALED` and several `DB_*`). Give each a rule, or drop it from the patterns?
22. **Correlation ids in lite.** BE-LOGGING-4 (a correlation id on every producer, HTTP call and job) applies only to an app
   that declares the `logging` pattern, and the lite reference declares none. Does a lite app declare `logging`, or stay
   without correlation ids?
23. **Lite and the message patterns.** The event-bus, reactors and services topics are written for the full edition and were
   not verified against a lite app. Rewrite them for lite, or mark them full-only (as question 12 asks for saga and
   projections)?
24. **The client catalog `pick`.** R60 gives client components only the keys they `pick`, but no check implements it (the
   `i18n-catalog` check judges key parity) and the reference passes the whole catalog. Implement `pick` in the check, or
   drop it from R60's law?
25. **`ruleParams` home.** The rule parameters (`infraOwners`, `specDoubles`, `suffixes`, ...) live in
   [hfs/slots.yaml](../hfs/slots.yaml). Keep them there, or move each into the lint package that reads it?
26. **The resource type's name.** Prose calls a region's value a "resource" while the code type is `Slot<T>` and its view
   `SlotView`, beside the HFS slot. Rename the code to `Resource<T>`, or keep the identifiers?
27. **Status tones on the page canvas.** Core's light `--success`, `--warning` and `--info` reach 3:1 as a bare mark on the
   surface but 2.77:1 on the page canvas. Raise their lightness step for 3:1 on the canvas as well, or keep 3:1 on the
   surface only?
28. **Two kept wrapper repaints.** The vertical scroll region (filling its parent) and Rating (as a radio group) keep a
   repaint of the vendor component. Keep both as rules of the grammar, or revert them to the vendor?
29. **What the Grammar contract cannot express.** Should the contract gain tokens that vary by a named viewport condition
   (offset-pop's narrow offset and radius), `motion-duration` and `motion-easing` names Common reads, an ink-band role (or
   drop `SurfaceCard treatment="ink"`), and a `font-display` role (or accept display type voice as custom paint)?
30. **Choices an app still makes two ways.** `sm` or `md` by context, Drawer placement, `Toaster` placement, `Tabs` `inset`,
   mixed glyph sizes in a region, and a skeleton an app or a frame draws. Close each by an API that removes the choice
   (item placement and dense `Toolbar` set `sm`, a responsive Drawer default, a shell-set Toaster placement, `inset`
   derived from a `Page`'s header tabs, `isSkeleton` on the frames), or by a lint rule?
31. **Proof of the orchestration.** A CLI change is proved by running the built CLI (CONTRIB-1) and the orchestration has no
   bench. Prove it by real test results in Orca (which runs, recorded where), or keep the built-CLI run as the proof?
32. **Deleting the legacy runtime.** The legacy tree at `D:/Repositories/starci-academy-backend/.claude` still exists. Delete
   it now (end and delete its scheduled tasks, repoint the product repositories and the `C:/Users/Hi/.starci/bin` shims
   that still name it, archive it as one git bundle with its untracked ledgers), or keep it read-only, and which of its
   unmerged branches are worth a look first?
33. **The intent map as one Common module.** The intent map, arrangement, collection-item and avatar defaults are copied
   byte for byte into each grammar's DNA, and the resolver switches on the family. Make them one Common data module
   (`src/common/intent.ts` and siblings) that imports no grammar and throws on an unknown one, or keep a copy per DNA?
34. **A lint package per grammar.** `@starci/eslint-grammar-core` holds the Common-API checks every grammar needs. Split
   them into `@starci/eslint-grammar-common`, with each grammar shipping `@starci/eslint-grammar-<id>` (a factory even
   when it only re-exports, and `fe-stack` refusing a grammar whose lint entry is missing), or keep the shared package?
35. **Citations in a gallery explanation.** The `Luật:` line of an `explain.md` (`contexts/project/gallery.md` PROJECT-GALLERY-2) cites a contexts anchor id. The anchor table lives in the CLI (`cli/src/core/contexts/anchors.ts`), while R395 runs in `@starci/hfs` inside an app repository that carries no contexts tree. Should `starci app check` hand the gate the anchor table (a resolver the finder takes, the CLI refusing an unknown id with the near ids), or does the gate stay structural (a `Luật` value is not judged)?
