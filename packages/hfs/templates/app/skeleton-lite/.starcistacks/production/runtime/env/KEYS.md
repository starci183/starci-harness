# Production environment key roster

This inventory declares names, consumers and mounted file paths. Scaffolding generates the six declared encrypted members with placeholder values encrypted to this app's own age recipient. Replace their values through `starci app secret set production` after owner provisioning and before creating external secrets. The runtime template tracks no ciphertext; its specs generate members with ephemeral identities in disposable copies. Scaffolding supplies no deployment credential or successful deployment.

| Key | Consumer |
| --- | --- |
| `PORT` | API listener |
| `HTTP_SECURITY_ALLOWED_ORIGINS` | API origin allowlist |
| `PRIMARY_DB_URL` | API least-privilege database connection; reads `PRIMARY_DB_URL_FILE` at `/run/secrets/primary-db-url` |
| `PRIMARY_DB_SCHEMA` | API primary database schema |
| `POSTGRES_PASSWORD` | The db service's superuser password; reads `POSTGRES_PASSWORD_FILE` at `/run/secrets/db-password` |
| `GOOGLE_CLIENT_ID` | API Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | API Google OAuth client; reads `GOOGLE_CLIENT_SECRET_FILE` at `/run/secrets/google-client-secret` |
| `GOOGLE_CALLBACK_URL` | API Google OAuth callback door |
| `AUTH_JWT_ISSUER` | API access-token issuer |
| `AUTH_JWT_AUDIENCE` | API access-token audience |
| `AUTH_JWT_KEY_ID` | API signing key id, published in the JWKS |
| `AUTH_JWT_PRIVATE_KEY` | API ES256 signing key; reads `AUTH_JWT_PRIVATE_KEY_FILE` at `/run/secrets/auth-jwt-private-key` |
| `STORAGE_ENDPOINT` | API S3-compatible storage endpoint |
| `STORAGE_REGION` | API storage signing region |
| `STORAGE_BUCKET` | API storage bucket |
| `STORAGE_ACCESS_KEY_ID` | API storage credential; reads `STORAGE_ACCESS_KEY_ID_FILE` at `/run/secrets/storage-access-key-id` |
| `STORAGE_SECRET_ACCESS_KEY` | API storage credential; reads `STORAGE_SECRET_ACCESS_KEY_FILE` at `/run/secrets/storage-secret-access-key` |
| `DATABASE_URL` | `starci app db` verbs (migrate, dump, plan) and `contract:emit`, from the operator's environment |
| `NEXT_PUBLIC_SITE_URL` | Front-end site URL |
| `NEXT_PUBLIC_API_URL` | Front-end auth doors of the API |
| `NEXT_PUBLIC_GRAPHQL_URL` | Front-end GraphQL transport |

Public front-end configuration is supplied at build time and stays outside sealed custody. Set real values in the six `.starcistacks/production/secrets/*.enc` members at the declared paths; their versioned external secrets are `{{project}}-production-<member>-v1`. The database deploy workflow reads `DATABASE_URL` from the sealed `database-url` member of its environment; it never enters an API container.
