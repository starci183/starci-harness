---
title: Front door
route: /
area: home
---

The first page of the starter: the sign-in form, the two ways around it, and sign-out once signed in. Replace it with the product's own front door and keep this explanation current (PROJECT-GALLERY-5).

## Page band

Vì sao: The title heads the page; a signed-out reader meets the product name first, so the band carries the title and nothing else.
Luật: R325, every screen is one Grammar Page.
Grammar: `Page` with `header.title` (`@starci/grammar/common`), drawn by `features/pages/AppHomePage/component.tsx`.

## Sign-in form

Vì sao: A signed-out reader's one task is to sign in, so the form is the first thing in the body; once signed in the same place shows the reader and sign-out.
Luật: R325, the body of the Page holds the interactive blocks; the copy comes from the locale catalog (R58).
Grammar: `SignInForm` and `SignOutButton` blocks, `components/blocks/SignInForm`, `components/blocks/SignOutButton`.

## Sign-up and forgot links

Vì sao: A reader without an account or without a password leaves the form by a link, not a second button, so the primary action stays the sign-in.
Luật: R325, a way out of the screen is a link, an action is a button.
Grammar: `Link` (`@starci/grammar/common`) twice, `href` from the page props.
