---
slots: [be.domain, be.errors, be.feature.messages]
---
# Messages catalog and locale

Where user-facing back-end text lives and which locale a lookup resolves to. Error text is the `errors.<CODE>` entry
the error filter reads (BE-ERROR-5).

## BE-MESSAGES-1 One keyed bundle per owner, read through MessageCatalog

Text a person reads never sits in source: each owner has `messages/<owner>.messages.ts` exporting
`<OWNER>_MESSAGES: MessageBundle`, one map per supported locale with the same keys, `errors.<CODE>` for each of its
error codes, and `{{name}}` placeholders. The app composes every bundle into `I18nModule.register({ bundles })`; a class
reads text with `@InjectMessageCatalog() private readonly messages: MessageCatalog` and
`this.messages.get(key, params, locale)`, never by importing a bundle. A code-shaped literal is a code, not copy.

Why: a literal cannot be translated or found by the key a test asserts on, and drifts the moment one call site is
edited.

```ts
/** Display text of the orders codes and notices. */
export const ORDERS_MESSAGES: MessageBundle = {
    en: { "errors.ORDERS_NOT_SHIPPABLE": "The order cannot be shipped or has already been shipped." },
    vi: { "errors.ORDERS_NOT_SHIPPABLE": "<the same text in the second locale>" },
}
```

Enforced by: `user-copy-through-catalog` (R78), `no-non-ascii-source` (R89), R311.

## BE-MESSAGES-2 The locale is the receiver's, resolved once

In a request the locale comes from `RequestLocale.of(acceptLanguage)` (an `@AcceptedLocale()` argument or the error
filter), falling back to the default locale. Outside a request (a job, a notification) the recipient's stored locale,
carried in the payload, is passed explicitly; never the acting operator's.

Why: locale is a fact about who reads the text, so one job does not send one language and the next another to the
same recipient.

Enforced by: `user-copy-through-catalog` (R78); the choice of locale is review only.
