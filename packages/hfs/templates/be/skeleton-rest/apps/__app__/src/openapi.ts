import { DocumentBuilder, type OpenAPIObject } from "@nestjs/swagger"

/**
 * The head of the {{app}} app's OpenAPI document: its title, version and bearer security scheme. main.ts serves the document over it,
 * and `starci app emit` adds the paths and schemas of the app's controllers and writes contracts/{{app}}/openapi.json (BE-TRANSPORT-4).
 * Every scheme travels in the `Authorization` header alone: a signed-in user's door reads its bearer access token there, and a
 * `@Credential({ kind })` door's CredentialGuard reads the credential from it and nothing else; one credential acts for exactly one
 * workspace, so a client of two workspaces holds two credentials.
 */
export const OPENAPI: Omit<OpenAPIObject, "paths"> = new DocumentBuilder()
    .setTitle("{{project}}")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build()
