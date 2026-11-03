# @starci/mail

Outgoing mail of a StarCi back end over SMTP: one package, two entries.

| entry | holds |
|---|---|
| `@starci/mail` | `MailModule` (`register` / `registerAsync`), the `Mailer` port under `MAILER`, `createMailer` for plain Node, the coded `MailError`, the typed render helpers (`html`, `escapeHtml`, `renderTransactional`, `safeUrl`) |
| `@starci/mail/testing` | `createMemoryMailer` (the real checks over an in-memory outbox), `mailTestingModule`, `testMailOptions` |

The package owns `nodemailer`; an app imports it nowhere (the lint refuses it) and reaches the package only through `integrations/mail`.

```ts
MailModule.registerAsync({
    isGlobal: true,
    useFactory: () => parsedOptions, // parsed in the app (BE-CONFIG-2); the package reads no environment
})

await mailer.send({ to: "ada@example.com", message: renderTransactional({
    lang: "en",
    subject: "Confirm your email",
    brand: { name: "Acme" },
    paragraphs: ["Press the button to confirm your address."],
    action: { label: "Confirm", url: confirmUrl },
}) })
```

## What a send does

- Checks the recipients (plain mailboxes, no display form, no line breaks, none repeated, at most `maxRecipients`), the sender and the message (a one-line subject, a text body, bodies under `maxBodyBytes`) before it connects; a failure is `MAIL_ADDRESS_INVALID` or `MAIL_MESSAGE_INVALID`.
- Connects with `connectionTimeoutMs`, `greetingTimeoutMs`, `socketTimeoutMs` and bounds the whole send with `sendTimeoutMs`; every wait ends in `MAIL_TIMEOUT`.
- Requires STARTTLS by default (`security: "starttls"`): a server that offers none fails the send with `MAIL_TLS` instead of receiving the message in the clear. `"tls"` is implicit TLS (port 465); `"none"` is a local mail sink and is refused together with a login. Certificates are verified (TLS 1.2 or later) unless `allowSelfSigned` is set for a development catcher.
- Rejects with a `MailError` whose `code` is stable and whose `kind` is `invalid`, `rate-limited` or `unavailable`: `MAIL_AUTH`, `MAIL_APP_PASSWORD`, `MAIL_CONNECT`, `MAIL_TIMEOUT`, `MAIL_DNS`, `MAIL_TLS`, `MAIL_SENDER`, `MAIL_RECIPIENT`, `MAIL_LIMIT`, `MAIL_UNKNOWN`, `MAIL_ADDRESS_INVALID`, `MAIL_MESSAGE_INVALID`. The server's words ride in `detail`, the host and port in `context`, the cause in `cause`; the password is in none of them.

## Attachments and user-chosen servers

`message.attachments` takes up to `maxAttachments` files (default 3) of `maxAttachmentBytes` together (default 5 MiB); `attachmentContentTypes` lists the admitted media types. For a server a user typed in (a workspace's own SMTP account) call `assertSmtpTarget(host, port)` when saving it and set `publicTargetOnly` on the options of the mailer you build for it: only public mail ports and only hosts that resolve to public addresses pass.

## Templates are code

A template is a typed function returning `{ subject, text, html }`. Interpolate with the `html` tag, which escapes every value (text, numbers, lists) and places a `SafeHtml` as it is; `raw` marks a fragment the template author wrote. `renderTransactional` draws the common case (heading, paragraphs, one button, a footer) with the brand name and an optional `#rrggbb` accent, and refuses a button link that is not an absolute web URL. The words come from the app's own copy (its i18n), never from the package.

## Tests

`npm test` typechecks, lints and runs the `node:test` specs (a fake SMTP server for the transport, the checks and the render helpers over memory) under 90% line coverage. In an app's spec, register `mailTestingModule(memory)` and assert on `memory.outbox`, `memory.lastTo(address)` and the `link` of a message (the first web link of its text body).
