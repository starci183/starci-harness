// backup-ops.mts - the named operations of the manager-side database backup (manager-backup.mts), admitted by the CI key's gate (ssh-gate.mts).
// A `database.target: stack` database is dumped where it runs: the dump, its receipt, the second reading of the archive and the test decrypt with
// the manager's own identity stay on the manager, so they are scripts of the manager, not docker calls from the runner. Each is one sh body that
// reads its arguments as $1... and holds no free text:
//   db-dump     <dir> <name> <container> <role> <database> <recipients>   pg_dumpall roles, pg_dump schema and data, row counts, tar, age, rename
//   db-receipt  <dir> <name>                                              the receipt (one base64 line on stdin) beside an archive that exists
//   db-measure  <dir> <name>                                              exists, bytes, sha256 and the age header of the archive
//   db-decrypt  <dir> <name> <container>                                  the manager's identity opens the archive, tar lists it
// The archive is always <dir>/<name>.tar.age and its receipt <dir>/<name>.receipt.json: no operation takes a free path, writes outside <dir> or reads
// anything back but the listing, the measures and the row counts. The owner's key runs the same bodies under `sh -c` (ssh-gate.mts inlineCommand).
import { OWN_PASSWORD_SHELL } from '../db/postgres.mjs';
import { AGE_KEYGEN_DIRS, SERVER_AGE_IDENTITY } from './server-key.mjs';

/** Single-quote quoting of a fixed text embedded in a body (the texts below hold no line break). */
const quoted = (text: string): string => ["'", text.replaceAll("'", String.raw`'\''`), "'"].join('');

/** The parts of the archive, in tar order. */
export const BACKUP_PARTS = Object.freeze(['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']);

/** The first line of an age file. */
export const AGE_HEADER = 'age-encryption.org/v1';

/** Row counts of every ordinary table but the catalogs' (auth included), one JSON array, computed inside the database. */
const ROWCOUNTS_SQL = "select coalesce(json_agg(json_build_object('schema', schemaname, 'table', tablename, 'count', (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text) order by schemaname, tablename), '[]'::json) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema')";

/** The archive and the receipt of the operation's $1 (folder) and $2 (name). */
const ARCHIVE = 'f="$1/$2.tar.age"';

/**
 * db-dump: the password is read inside the container from its own POSTGRES_PASSWORD_FILE (the URL holds the role and database only), the plaintext
 * lives in a 0700 scratch directory under <dir> that a trap removes, and the archive gets its final name only when the whole chain succeeded.
 * Prints the archive's sha256, its byte size, then the row counts JSON.
 */
const DUMP = [
  'umask 077', ARCHIVE, 'p="$f.partial"', 'c="$3"', 'u="postgresql://$4@127.0.0.1:5432/$5"', 'mkdir -p "$1" || exit 1',
  'S=$(mktemp -d "$1/.plain.XXXXXX") || exit 1', "trap 'rm -rf \"$S\"' EXIT", `PW=${quoted(OWN_PASSWORD_SHELL)}`,
  'dx() { docker exec "$c" sh -c "$PW" sh "$@" </dev/null; }',
  // the recipients are age1 keys joined by commas (a closed alphabet, checked by the gate): split with globbing off
  'set -f', 'R=', 'IFS=,', 'for r in $6; do R="$R -r $r"; done', 'unset IFS',
  `{ dx pg_dumpall --roles-only --no-role-passwords --dbname "$u" > "$S/roles.sql" && dx pg_dump --schema-only --dbname "$u" > "$S/schema.sql" && dx pg_dump --data-only --dbname "$u" > "$S/data.sql" && dx psql -X -q -A -t -d "$u" -c ${quoted(ROWCOUNTS_SQL)} > "$S/rowcounts.json" && tar -cf "$S/backup.tar" -C "$S" ${BACKUP_PARTS.join(' ')} && age $R -o "$p" "$S/backup.tar" && mv "$p" "$f"; } || { rm -f "$p"; exit 1; }`,
  'sha256sum "$f" | cut -d" " -f1', 'stat -c %s "$f"', 'cat "$S/rowcounts.json"',
].join('; ');

/** db-receipt: one base64 line on stdin, decoded into a temp file and renamed, only beside an archive that exists. */
const RECEIPT = ['set -e', ARCHIVE, 'test -f "$f"', 'umask 077', 'IFS= read -r doc', 't="$1/.$2.receipt.tmp"', `printf '%s' "$doc" | base64 -d > "$t"`, 'mv -f "$t" "$1/$2.receipt.json"'].join('; ');

/** db-measure: `exists`, `bytes`, `sha256` and `header` lines of the archive (exists=0 alone when there is none). */
const MEASURE = [
  ARCHIVE, '[ -f "$f" ] || { echo exists=0; exit 0; }', 'echo exists=1', 'echo "bytes=$(stat -c %s "$f")"', 'echo "sha256=$(sha256sum "$f" | cut -d" " -f1)"',
  `if [ "$(head -c ${AGE_HEADER.length} "$f")" = ${quoted(AGE_HEADER)} ]; then echo header=1; else echo header=0; fi`,
].join('; ');

/** The root script of the test decrypt, the archive as its $1: the manager's identity opens it in a private scratch directory and tar lists it. */
export const DECRYPT_SCRIPT = [
  'set -e', 'umask 077', 'PATH="$PATH:/usr/local/bin:/usr/bin:/bin"', 't=$(mktemp -d)', "trap 'rm -rf \"$t\"' EXIT",
  `age -d -i ${quoted(SERVER_AGE_IDENTITY)} -o "$t/backup.tar" "$1"`, 'tar -tf "$t/backup.tar"',
].join('; ');

const mount = (source: string): string => `--mount "type=bind,src=${source},dst=${source},readonly"`;

/**
 * db-decrypt: DECRYPT_SCRIPT runs as root, directly or over passwordless sudo where the login has them, else (a deploy user with the docker group and
 * no sudo) in a one-off container of the database container's own image that sees only the identity, the archive and the manager's age binary, each
 * bind-mounted read-only at its own path, with no network. A missing source refuses the mount, so nothing is created on the host.
 */
const DECRYPT = [
  ARCHIVE, 'c="$3"', '[ -f "$f" ] || { echo "no such archive" >&2; exit 1; }', `D=${quoted(DECRYPT_SCRIPT)}`,
  `printf '%s\\n' "$D" | if [ "$(id -u)" -eq 0 ]; then sh -s "$f"; elif sudo -n true 2>/dev/null; then sudo -n sh -s "$f"; else `
    + [
      'a="$(command -v age 2>/dev/null)"',
      `for d in ${AGE_KEYGEN_DIRS.join(' ')}; do if [ -z "$a" ] && [ -x "$d/age" ]; then a="$d/age"; fi; done`,
      'if [ -z "$a" ]; then echo "age is not installed" >&2; exit 127; fi',
      `i="$(docker inspect --format '{{.Image}}' "$c" </dev/null)" || exit 1`,
      `docker run --rm -i --network none --user 0:0 --entrypoint sh ${mount(SERVER_AGE_IDENTITY)} ${mount('$f')} --mount "type=bind,src=$(readlink -f "$a"),dst=/usr/local/bin/age,readonly" "$i" -s "$f"`,
    ].join('; ') + '; fi',
].join('; ');

/** The four operations, in the shape of ssh-gate.mts GateOp (the gate owns the argument kinds and their alphabets). */
export const BACKUP_OPS = Object.freeze([
  { name: 'db-dump', args: ['base', 'backup', 'container', 'ident', 'ident', 'recipients'], stdin: false, body: DUMP },
  { name: 'db-receipt', args: ['base', 'backup'], stdin: true, body: RECEIPT },
  { name: 'db-measure', args: ['base', 'backup'], stdin: false, body: MEASURE },
  { name: 'db-decrypt', args: ['base', 'backup', 'container'], stdin: false, body: DECRYPT },
] as const);
