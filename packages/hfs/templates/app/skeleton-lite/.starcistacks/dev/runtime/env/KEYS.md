# Environment key roster (dev)

Names only. Dev values are generated once by the owner-armed `starci app secret init --env dev --execute`, sealed in
`.starcistacks/dev/secrets/<member>.enc.yaml` and opened by `starci app stack up --env dev --execute` into private files outside the repository
(`<KEY>_FILE`, which the back end reads first). The public front-end configuration is supplied by the manifest's `local.processes` environment.

| Key | Consumer |
| --- | --- |
| `PORT`, `HTTP_SECURITY_ALLOWED_ORIGINS`, `PRIMARY_DB_SCHEMA` | API listener, origin allowlist, primary schema (manifest `local.processes.api.env`) |
| `PRIMARY_DB_URL` | API least-privilege connection as `app_be` with this environment's own password; composed by the stack verb, read through `PRIMARY_DB_URL_FILE` |
| `POSTGRES_PASSWORD` | The db service's superuser password (member `db`) |
| `DEV_DB_OWNER_PASSWORD` | The environment's own owner role, which runs the migrations (member `db`) |
| `DEV_DB_APP_PASSWORD` | The password of the `app_be` role in this environment's database (member `db`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CALLBACK_URL` | API Google OAuth client and callback (local placeholders in the manifest) |
| `GOOGLE_CLIENT_SECRET` | API Google OAuth client secret (member `google`) |
| `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_JWT_KEY_ID` | API access-token claims and key id (the key id is published in the JWKS) |
| `AUTH_WEB_ORIGIN` | API origin of the web app: where the Google callback lands and the only origin a return address may name |
| `AUTH_JWT_PRIVATE_KEY` | API Ed25519 (EdDSA) signing key (member `auth`) |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET` | API storage address: the dev `storage` service (MinIO) on its S3 port, and the bucket the api creates there |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | API storage credentials and the `storage` service's root credentials (member `storage`, granted to the service through `STACK_GRANT_STORAGE`) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURITY`, `MAIL_FROM`, `MAIL_FROM_NAME` | API outgoing mail server (the dev `mail` service, Mailpit, on its SMTP port: a plain channel on loopback only) and the sender of the confirmation and reset mails |
| `MAIL_DEFAULT_LANGUAGE`, `MAIL_CONFIRM_TTL_SECONDS`, `MAIL_RESET_TTL_SECONDS` | API mail language (`vi` or `en`) and link lifetimes; optional |
| `MAIL_USER`, `MAIL_PASSWORD` | API mail server login; optional, the password reads `MAIL_PASSWORD_FILE` |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GRAPHQL_URL` | Front-end site, auth doors and GraphQL transport |
| `DATABASE_URL` | `starci app db` verbs; the stack verb composes it in memory for the migration |
