# Example

One or two lines that say what this topic is, for a reader who has not opened the code. Replace this file with the app's own topics, one
file each, at most about sixty lines.

## Terms

- **example**: the one meaning this word has in the app; *not to confuse with* a sample row of a test.

## Data

- `examples`: `id`, `name`, `created_at`; key `id`; created once, renamed in place, never deleted.

## Naming

- `<noun>-<role>.ts`, for example `example-list.ts`; never `ExampleList.ts`.

## Rules

1. An example has exactly one name. *Why:* two names for one thing make two readers build two things.

## Example

A request to create "first" → one row named `first`; the same request again → the same row, no second one.

## Don't / Instead

- Don't keep a second list of examples beside the table. Instead read the table.

## Where

- `be/src/`: the back end; name the capability folder once the topic has one.

Related: none yet.
