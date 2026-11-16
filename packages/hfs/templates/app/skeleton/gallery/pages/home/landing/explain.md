---
title: Landing page
route: /
area: home
---

The public front door of the starter: one sentence about the product and the way into the product app. Replace it with the product's own landing and keep this explanation current (PROJECT-GALLERY-5).

## Page band

Vì sao: The welcome and one sentence about the product are all a visitor needs before the way in, so the band carries the title and the lede.
Luật: R325, every screen is one Grammar Page.
Grammar: `Page` with `header.title` and `header.description` (`@starci/grammar/common`), drawn by `features/pages/LandingPage/component.tsx`.

## Open the app

Vì sao: The one action of the page is to enter the product app, so it is the single committing button of the screen.
Luật: R325, one primary action per screen; a button that leaves for another origin carries `href`.
Grammar: `Button` with `href` and `intent="commit"` (`@starci/grammar/common`).
