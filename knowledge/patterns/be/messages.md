---
slots: [be.domain, be.errors, be.feature.messages]
---
# Messages catalog and locale

Decides where user-facing back-end text lives and which locale a lookup resolves to. Error display text is the `errors.<code>`
entry used by BE-ERROR-6.

## BE-MESSAGES-1 One keyed catalog per owner, read through MessageCatalog
Text a user reads never sits in source: the `subject`, `title`, `body`, `text` or `message` of a notify, send or publish call and
the `message`, `description` or `title` of a response come from `messages/<owner>.messages.ts` of the owner: one keyed entry per
message, one map per supported locale with the same keys, and named `{{param}}` interpolation instead of `+` or a template. A
class reads it through `@InjectMessageCatalog() private readonly messages: MessageCatalog`, never by importing a catalog file;
platform composes every owner's catalog at startup. A code-shaped literal (UPPER_SNAKE, one bare word) is a code, not copy. Text in
another language than English exists only in catalogs and the i18n fixtures. An interpolated value never leaks a secret or an
internal id a client should not see.

Why: a literal cannot be translated or found by the key a test asserts on, and drifts the moment one call site is edited and its
sibling is not.

- `this.notifier.send({ subject: this.messages.get("billing.invoice-subject", { number }), body: this.messages.get("billing.invoice-body", { amount }) })`

Enforced by: R78 BE_USER_COPY_LITERAL, R311 HFS_TEXT_CORRUPT, R89 BE_SOURCE_FORM.

## BE-MESSAGES-2 Locale resolution is one port, never guessed at the call site
`platform/i18n` exposes `RequestLocale` (`InjectRequestLocale()`), used only where a request exists: the principal's stored
preference, else the first supported locale `Accept-Language` names, else the default locale; an unsupported header value counts as
absent. Outside a request (a job, a consumer building a notification) the recipient's own stored preference, else the default
locale, is passed explicitly: `this.messages.get(key, params, { locale })`, never the acting operator's locale.

Why: locale is a fact about who receives the text, resolved once from the evidence the context has, so one job does not ship one
language and the next another for the same recipient.

Enforced by: R78 BE_USER_COPY_LITERAL, R85 BE_RAW_INJECT.
