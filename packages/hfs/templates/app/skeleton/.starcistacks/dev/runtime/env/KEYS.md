# Environment key roster

This roster declares names only. Store credential values in sealed custody and materialize private KEY files outside the repository.

| Key | Consumer |
| --- | --- |
| `PORT` | API listener |
| `HTTP_SECURITY_ALLOWED_ORIGINS` | API origin allowlist |
| `PRIMARY_DB_URL` | API and CLI primary database connection |
| `NEXT_PUBLIC_SITE_URL` | Product front-end site URL |
| `NEXT_PUBLIC_GRAPHQL_URL` | Product front-end GraphQL transport |
| `NEXT_PUBLIC_APP_URL` | Landing front-end product link |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | The dev `storage` service's root credentials (member `storage`, created by `starci app secret init --env dev --execute`, granted through `STACK_GRANT_STORAGE`) |

Public front-end configuration is supplied at build time and stays outside sealed custody.
