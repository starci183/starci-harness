# Production environment key roster

This inventory declares names, consumers and mounted file paths. Scaffolding seals generated database connection, application password and administrator password placeholders to this app's own recipient. Replace them with real credentials before use; no successful deployment is claimed by scaffolding.

| Key | Consumer |
| --- | --- |
| `PORT` | Core API listener |
| `HTTP_SECURITY_ALLOWED_ORIGINS` | Core API origin allowlist |
| `PRIMARY_DB_URL` | Core API and CLI primary database connection; managed deployment sets the API's `PRIMARY_DB_URL_FILE` to `/run/secrets/PRIMARY_DB_URL` from sealed `secrets/primary-db-url.enc` |
| `POSTGRES_PASSWORD` | PostgreSQL administrator password; managed deployment sets only PostgreSQL's `POSTGRES_PASSWORD_FILE` to `/run/secrets/POSTGRES_PASSWORD` from sealed `secrets/postgres-password.enc` |
| `PRIMARY_DB_PASSWORD` | First-boot `app_be` role password; managed deployment sets only PostgreSQL's `PRIMARY_DB_PASSWORD_FILE` to `/run/secrets/PRIMARY_DB_PASSWORD` from sealed `secrets/primary-db-password.enc`; it must match the password in the API's sealed connection URI |
| `NEXT_PUBLIC_SITE_URL` | Product front-end site URL |
| `NEXT_PUBLIC_GRAPHQL_URL` | Product front-end GraphQL transport |
| `NEXT_PUBLIC_APP_URL` | Landing front-end product link |

Public front-end configuration is supplied at build time and stays outside sealed custody. Replace the generated private placeholders only in the manifest's declared `.starcistacks/production/secrets/primary-db-url.enc`, `primary-db-password.enc` and `postgres-password.enc` members. Their versioned external secrets are `{{project}}-production-primary-db-url-v1`, `{{project}}-production-primary-db-password-v1` and `{{project}}-production-postgres-password-v1`; the API receives its least-privilege connection separately from PostgreSQL's administrator password.
