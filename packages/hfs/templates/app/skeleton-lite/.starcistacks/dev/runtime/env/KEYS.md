# Environment key roster

This roster declares names only. Scaffolding generates the six declared encrypted members with placeholder values encrypted to this app's own age recipient. Replace their values through `starci app secret set dev` before creating external secrets. The runtime template tracks no ciphertext; its specs generate members with ephemeral identities in disposable copies. Store product credential values in sealed custody and materialize private KEY files outside the repository.

| Key | Consumer |
| --- | --- |
| `PORT` | API listener |
| `HTTP_SECURITY_ALLOWED_ORIGINS` | API origin allowlist |
| `PRIMARY_DB_URL` | API least-privilege database connection; `.starcistacks/dev/secrets/primary-db-url.enc` maps to external `{{project}}-dev-primary-db-url-v1` and mounted `/run/secrets/primary-db-url` |
| `PRIMARY_DB_SCHEMA` | API primary database schema |
| `POSTGRES_PASSWORD` | The db service's superuser password; `.starcistacks/dev/secrets/db-password.enc` maps to external `{{project}}-dev-db-password-v1` and mounted `/run/secrets/db-password` |
| `GOOGLE_CLIENT_ID` | API Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | API Google OAuth client; `.starcistacks/dev/secrets/google-client-secret.enc` maps to external `{{project}}-dev-google-client-secret-v1` and mounted `/run/secrets/google-client-secret` |
| `GOOGLE_CALLBACK_URL` | API Google OAuth callback door |
| `AUTH_JWT_ISSUER` | API access-token issuer |
| `AUTH_JWT_AUDIENCE` | API access-token audience |
| `AUTH_JWT_KEY_ID` | API signing key id, published in the JWKS |
| `AUTH_JWT_PRIVATE_KEY` | API ES256 signing key; `.starcistacks/dev/secrets/auth-jwt-private-key.enc` maps to external `{{project}}-dev-auth-jwt-private-key-v1` and mounted `/run/secrets/auth-jwt-private-key` |
| `STORAGE_ENDPOINT` | API S3-compatible storage endpoint |
| `STORAGE_REGION` | API storage signing region |
| `STORAGE_BUCKET` | API storage bucket |
| `STORAGE_ACCESS_KEY_ID` | API storage credential; `.starcistacks/dev/secrets/storage-access-key-id.enc` maps to external `{{project}}-dev-storage-access-key-id-v1` and mounted `/run/secrets/storage-access-key-id` |
| `STORAGE_SECRET_ACCESS_KEY` | API storage credential; `.starcistacks/dev/secrets/storage-secret-access-key.enc` maps to external `{{project}}-dev-storage-secret-access-key-v1` and mounted `/run/secrets/storage-secret-access-key` |
| `DATABASE_URL` | `starci app db` verbs (migrate, dump, plan) and `contract:emit`, from the operator's environment |
| `NEXT_PUBLIC_SITE_URL` | Front-end site URL |
| `NEXT_PUBLIC_API_URL` | Front-end auth doors of the API |
| `NEXT_PUBLIC_GRAPHQL_URL` | Front-end GraphQL transport |

Public front-end configuration is supplied at build time and stays outside sealed custody. The database verbs read `DATABASE_URL` from the operator's environment; the GitHub secret store carries only the age identity.
