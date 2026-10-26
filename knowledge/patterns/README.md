# Patterns

How app code is written, per side: [fe](fe/README.md) (Next.js) and [be](be/README.md) (NestJS). Each topic is a
Markdown file of rules with stable ids (`FE-FUNCTION-2`, `BE-PERSISTENCE-5`), each stating the decision and its
reason, citing the HFS rules that check it ([hfs/rules.yaml](../hfs/rules.yaml)) instead of restating them.

Read by an authoring agent before it codes a slot (the topics whose front matter lists that slot), and by a generator
that maps slots to topics from the front matter (`slots`; `files` for scaffolded trees in be). One rule lives in one
place; feedback hardens it there.
