// rest-doors.mts - the OpenAPI shape of the managed sign-in doors of a rest back end (contexts/code/be/transport.md BE-TRANSPORT-4, R396):
// for an app whose api apps declare `contract: "rest"`, the auth controller of the auth-lite group carries @nestjs/swagger decorators: an explicit
// `auth.<action>` operationId, a named answer schema for every 2xx body, the one error schema as `default`, and `security: []` with an
// `x-public-reason` on each door (every sign-in door is public). The template names these as variable-only lines, so a graphql back end, which
// has no @nestjs/swagger, renders the controller byte for byte as before (every variable empty).
import { contractOf } from '../runtime/scripts/hfs/contract-kind.mjs';

/** The doors of the auth controller: the template variable of each, its operationId and the answer it documents (a 2xx DTO, a redirect, or none for 204). */
const DOORS: ReadonlyArray<{ readonly name: string; readonly answer: 'grant' | 'jwks' | 'redirect' | 'none' }> = Object.freeze([
  { name: 'login', answer: 'grant' }, { name: 'refresh', answer: 'grant' }, { name: 'session', answer: 'grant' }, { name: 'logout', answer: 'none' },
  { name: 'google', answer: 'redirect' }, { name: 'googleCallback', answer: 'redirect' }, { name: 'signup', answer: 'none' }, { name: 'resend', answer: 'none' },
  { name: 'confirm', answer: 'none' }, { name: 'forgot', answer: 'none' }, { name: 'reset', answer: 'none' }, { name: 'jwks', answer: 'jwks' },
]);

/** The response DTOs the rest doors document: the one error body, the access grant and its user, and the key set. */
const DTOS = [
  '/** The one error body every operation answers as `default`: its machine code and its message. */',
  'class ErrorResponse {',
  '    /** The machine code of the failure, stable across releases. */',
  '    @ApiProperty() readonly code!: string',
  '    /** The failure in words, from the messages catalog. */',
  '    @ApiProperty() readonly message!: string',
  '}',
  '',
  '/** The signed-in person an access grant names. */',
  'class SessionUserResponse {',
  '    /** The user id. */',
  '    @ApiProperty() readonly id!: string',
  '    /** The account email. */',
  '    @ApiProperty() readonly email!: string',
  "    /** The person's full name, when the account has one. */",
  '    @ApiProperty({ required: false }) readonly name?: string',
  '}',
  '',
  '/** An access token and when it stops being accepted. */',
  'class AccessGrantResponse {',
  '    /** The access JWT, to be sent as a Bearer token. */',
  '    @ApiProperty() readonly accessToken!: string',
  '    /** How many seconds the access token lives. */',
  '    @ApiProperty() readonly expiresIn!: number',
  '    /** When the access token stops being accepted, ISO 8601. */',
  '    @ApiProperty() readonly expiresAt!: string',
  '    /** The signed-in person. */',
  '    @ApiProperty({ type: SessionUserResponse }) readonly user!: SessionUserResponse',
  '}',
  '',
  '/** The public keys access tokens verify against. */',
  'class JwksResponse {',
  '    /** The public keys, each a JSON Web Key. */',
  '    @ApiProperty({ type: "array", items: { type: "object" } }) readonly keys!: Array<Record<string, string>>',
  '}',
  '',
].join('\n');

const camel = (name: string): string => `authRest${name.charAt(0).toUpperCase()}${name.slice(1)}`;
const operationId = (name: string): string => `auth.${name}`;
const answerOf = (answer: string): string => ({
  grant: '@ApiOkResponse({ type: AccessGrantResponse })',
  jwks: '@ApiOkResponse({ type: JwksResponse })',
  redirect: '@ApiFoundResponse()',
  none: '',
} as Record<string, string>)[answer] ?? '';

/** The template variables of the managed auth controller: empty for a graphql back end, the swagger lines for a rest one. */
export function restDoorVariables(apps: readonly { kind: string; contract?: string }[]): Record<string, string> {
  const rest = apps.some((app) => app.kind === 'api' && contractOf(app) === 'rest');
  const doors = Object.fromEntries(DOORS.map(({ name, answer }) => [camel(name), rest
    ? [`@ApiOperation({ operationId: "${operationId(name)}", security: [] })`, '@ApiExtension("x-public-reason", "auth-handshake")', answerOf(answer)].filter(Boolean).join('\n    ')
    : '']));
  return {
    authRestImports: rest ? ['import {', ...['ApiDefaultResponse', 'ApiExtension', 'ApiFoundResponse', 'ApiOkResponse', 'ApiOperation', 'ApiProperty'].map((name) => `    ${name},`), '} from "@nestjs/swagger"'].join('\n') : '',
    authRestDtos: rest ? DTOS : '',
    authRestClass: rest ? '@ApiDefaultResponse({ type: ErrorResponse })' : '',
    ...doors,
  };
}
