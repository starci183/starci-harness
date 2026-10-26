---
slots: []
---
# Comment

The back-end specifics of comments. The export docblock, line comments that say why, English source and no
suppression are shared: [SHARED-COMMENT-1 … 3](../shared/comment.md), [SHARED-LOOSENING-1](../shared/loosening.md).

## BE-COMMENT-1 On a decorated class the docblock sits after the decorators

A class decorator (`@Injectable()`, `@Module(...)`, `@Resolver()`, `@Controller(...)`, `@QueryHandler(...)`) comes
first, then the docblock, then `export class`. A decorated method keeps its docblock above its decorators.

Why: the editor attaches the block to the declaration it precedes, so it shows at every reference to the class.

```ts
@Injectable()
/** The authenticated read side of workspace orders. */
export class OrdersReadService {
```

Enforced by: `require-export-jsdoc` (R89).

## BE-COMMENT-3 Members are documented, not only exports

Every public method and every declared field of a class, interface or type, and every enum member, carries a non-empty
docblock: what it holds, when it is absent, what it refuses (`/** The carrier's tracking code, or null before
shipment. */`). A `persistence/*.sql.ts` constant names its numbered parameters (`($1 workspace, $2 order)`).

Why: a field's meaning (its unit, its nullability, its owner) is not in its name, and a parameter list is unreadable
without its numbering.

Enforced by: `require-public-member-jsdoc` (R109), `require-enum-member-jsdoc`, `no-restated-name-jsdoc` (R89).

## BE-COMMENT-7 Back-end source holds no second language outside the catalogs

Back-end source, specs and fixtures included, holds no second language: Vietnamese text lives only in
`messages/<owner>.messages.ts` catalogs and the `src/tests/fixtures/i18n/` slot.

Why: the catalog is the one place translations are reviewed and resolved by locale.

Enforced by: `no-non-ascii-source` (R89).
