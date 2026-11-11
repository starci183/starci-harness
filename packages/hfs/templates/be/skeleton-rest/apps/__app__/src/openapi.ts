import { DocumentBuilder, type OpenAPIObject } from "@nestjs/swagger"

/**
 * The head of the {{app}} app's OpenAPI document: its title, version and bearer security scheme. main.ts serves the document over it,
 * and `starci app emit` adds the paths and schemas of the app's controllers and writes contracts/{{app}}/openapi.json (BE-TRANSPORT-4).
 */
export const OPENAPI: Omit<OpenAPIObject, "paths"> = new DocumentBuilder()
    .setTitle("{{project}}")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build()
