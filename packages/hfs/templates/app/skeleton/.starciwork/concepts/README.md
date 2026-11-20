# Concepts

The app's persistent shared context: its terms, data model, naming and business rules, and the folders that hold them. Read
`.starcistacks/application-stacks.yaml` whole and the `.starcistacks/<env>/README.md` of the environment first, then this table, then
the conventions concept and the concept of every folder you are about to touch, before you read code. When that context changes, edit the concept to
the current truth. History, decisions, progress and status do not live here.

| Concept | Read when you touch (folders) | One line |
| --- | --- | --- |
| [conventions](conventions.md) | `db/`, `be/src/` | How the app names and shapes tables, keys, errors and proof: read before any change. |
| [example](example.md) | `be/src/` | An example topic: replace it with the app's own. |
