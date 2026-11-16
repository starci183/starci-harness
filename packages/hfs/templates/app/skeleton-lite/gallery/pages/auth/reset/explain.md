---
title: Reset password
route: /auth/reset
area: auth
---

The reset-password door of the starter. One Grammar Page; replace the copy and the form with the product's own and keep this explanation current (PROJECT-GALLERY-5).

## Page band

Vì sao: The title heads the page and tells the reader which door of the sign-in this is, so the band carries the title and nothing else.
Luật: R325, every screen is one Grammar Page; the title is the only band content of a door.
Grammar: `Page` with `header.title` (`@starci/grammar/common`), drawn by `features/pages/AppResetPage/`.

## Form

Vì sao: The door asks for the new password alone: the email is known from the token of the mail link.
Luật: R325, the body of the Page holds the interactive block; the copy comes from the locale catalog (R58).
Grammar: `EmailDoorForm` block, `components/blocks/EmailDoorForm`, `Page` `measure="reading"` keeps the line short.
