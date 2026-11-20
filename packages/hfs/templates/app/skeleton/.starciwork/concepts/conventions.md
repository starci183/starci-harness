# Conventions

How this app names and shapes what it builds, for a reader who has not opened the code. Edit it to the app's own conventions; the
harness checks enforce the generic part (R431, R432), and this page holds what the app adds and the words it uses.

## Terms

- **convention**: a pattern every folder of the app follows; *not to confuse with* a business rule, which lives in its own concept.

## Data

- A table's primary key is `id uuid primary key default gen_random_uuid()`; a natural key is a unique constraint beside it.
- A foreign key column is `<referenced table singular>_id` or `<role>_<referenced table singular>_id`, and has an index.
- An irregular plural of a table name is listed in hfs.json `db.singulars`.

## Naming

- Tables are plural snake case (`order_items`); their foreign keys singular (`order_item_id`, `owner_user_id`).
- A migration is `<ts14>_<kebab>.sql`; one that drops, renames, retypes or replaces a constraint is `<ts14>_contract_<name>.sql`.

## Rules

1. A failure's class is set on the error it throws (`failureClass`), never read from its code or message. *Why:* one judge,
   `classifyFailure`, decides what is retried.
2. Proof follows the gates `.starcistacks/application-stacks.yaml` declares. *Why:* a gate declared off is proved another way.

## Example

A table `invoices` owned by a user: `id uuid`, `owner_user_id uuid references auth.users (id)`, and
`create index invoices_owner_user_id_idx on public.invoices (owner_user_id)`.

## Don't / Instead

- Don't name a foreign key by its role alone (`owner_id`). Instead `owner_user_id`.

## Where

- `db/`, `be/src/`: the migrations and the back end.

Related: none yet.
