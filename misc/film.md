# Film

> Lives in `misc/` (see [README.md](README.md)); listed in AGENTS.md "Misc work".

How a product demo film of an app is shot, cut and voiced: the real app recorded by code, a few mocked "before" scenes, an
automatic camera, then the voice last. Written from the NIVO × Hiền Mai Spa film (owner, 2026-11-27). A product's own
script, characters and copy are its `.starciwork` or its film folder, never this file.

## FILM-1 The tech stack

| part | tool | where |
|---|---|---|
| browser recording | `playwright-core` driving the installed Chrome headless (`chromium.launch({ channel: "chrome" })`), `recordVideo` | `_video/rec/lib2.mjs` (`open`, `glideClick`, the CURSOR overlay, `finalize`) |
| sign-in | the dev stack's seeded owner through the app's own `/auth/login`, password read from the harness secret store (`starci app secret get --to-file`), never printed | `lib2.mjs` `cookies()` |
| scene scripts | one Node ESM script per group of scenes, each scene a function of a page | `_video/rec/da-kenh-*.mjs` |
| "before" scenes (pains) | static HTML/CSS/JS mock pages, recorded the same way from `file://` | `_video/rec/pain/` |
| encode | `ffmpeg`: cut the page-load lead-in, scale to 1920×1080, 25 fps, VP9 webm (`libvpx-vp9 -crf 30`) | `lib2.mjs` `finalize` |
| automatic camera (zoom in/out on clicks, pan, click ring) | **Remotion** (TypeScript/React, `remotion`, `@remotion/cli`), driven by the `<clip>.events.json` the recorder writes | `_video/zoom/` (`render.mjs <clip.webm>` → `<clip>-zoom.mp4`, H.264) |
| app data on screen | the app's dev seeds and its own GraphQL doors as the seeded owner; never SQL into the database | the app's `.starcistacks/dev/seeds/`, `_video/rec/*.mjs` helpers |
| phone side (real customer chats, a real bank transfer) | the owner's phone screen recording | sent to the coordinator, cut in `ffmpeg` |
| voice | an AI voice, added LAST, per clip, after the owner approved every clip | the script names one line per clip file |

Versions are pinned in each folder's `package.json`; `_video/` lives outside every repository (`D:/starci-lanes/_video`).

## FILM-2 How a scene is shot

1. **One small clip per scene**, named `<film>-<scene>.webm` (appendix clips `<film>-pl-<feature>.webm`), each with a `.png`
   still. The owner reviews every clip before any voice-over; a bad clip is re-shot, never patched.
2. **Viewport 1440×810**, scaled to 1080p on encode, so the UI reads large.
3. **Warm the route first** (open it once off-camera): a dev server's first compile shows skeletons.
4. **Read-only by default.** A scene script hovers, scrolls and opens tabs; a click that writes (approve, post, pay) runs
   only for a scene whose write the owner approved in chat (posting to a public page, a real transfer).
5. **Start real flows off camera** (a workflow run through the app's door with its `nonce`), film from the screen the
   viewer should see; never film a terminal unless the scene is about it.
6. **Event log on**: the recorder writes mouse moves, clicks and drags with times; Remotion zooms on them.

## FILM-3 What a film never shows

- A number the app does not store (dashboards show stored facts only); a placeholder says so.
- Synthetic channel identities (Messenger PSIDs, chat ids) for seeded people: outbound workflows would message them.
  Customers by channel are filmed from real test chats.
- A real product's interface made to look broken or wrong (no lookalike of another AI product writing bad copy). A
  real app the customer uses (Facebook, Instagram, Zalo, Messenger, Telegram) may be recreated for a "before" scene
  only when the owner chose it, with no official logo files.
- A secret, a token, a real customer's name or face (blur them in phone footage).

## FILM-4 The order of a filming night

Script → seed and deploy the demo data → record the app scenes and the mocks → owner reviews each clip → re-shoot →
the phone scenes with the owner (chats on each channel, the deposit) → automatic camera on every clip → voice per
clip → cut. UI fixes found while filming go through lanes (one worktree each) and land between scenes; the dev sync
of the filmed app stays locked so the app does not restart mid-scene.
