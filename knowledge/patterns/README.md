# Patterns

How app code is written: [shared](shared/README.md) holds the rules both sides follow, [be](be/README.md) (NestJS) and
[fe](fe/README.md) (Next.js) the rules of one side. Each topic is a Markdown file of rules with stable ids
(`SHARED-TYPING-2`, `FE-FUNCTION-2`, `BE-PERSISTENCE-5`), each stating the decision, its reason and its enforcer,
citing the HFS rules that check it ([hfs/rules.yaml](../hfs/rules.yaml)) instead of restating them.

A side topic's front matter lists the slots it teaches (`slots`; `files` for scaffolded trees in be), which is how an
agent and the anatomy generator map a slot to its topics. Shared topics apply to every slot and carry none. One rule
lives in one place: a fact both sides hold lives in `shared/`, and feedback hardens it there.

## Read for a coding task

An op that writes code or tests reads, in this order, and cites the rule ids it applied:

1. **The project map:** [project/README.md](../project/README.md), [anatomy.md](../project/anatomy.md) (where the
   slot's code lives), [lint.md](../project/lint.md) (what machines judge), and the edition file
   ([lite.md](../project/lite.md) or [full.md](../project/full.md)).
2. **Shared:** [shared/README.md](shared/README.md) and every topic it lists.
3. **The side:** [be/README.md](be/README.md) or [fe/README.md](fe/README.md); a front-end screen also reads the ui and
   grammar files of the [knowledge reading order](../README.md#reading-order-by-task).
4. **The slot topics:** the side topics whose front matter `slots` names a slot the task touches (the anatomy prints
   each slot's topics), and the topics those cite.
5. **The lint of the rules cited:** for each `R<n>` a rule names, its entry in [hfs/rules.yaml](../hfs/rules.yaml) and
   the documentation of its enforcer: the front-end canon's `packages/eslint-canon-fe/docs/<law>.md`, the back-end
   canon's rule source header in `packages/eslint-canon-be/<law>.mjs`, and the grammar lint for a grammar call.

Steps 1 to 3 are each op label's `context.base`; steps 4 and 5 depend on the slots and are the task's
`context.extend`, which the Kernel writes from the anatomy.
