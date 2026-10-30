// scripts/api/fs/lib.mjs — what the fs call files beside it share: the error codes Windows returns while another
// process holds a path open, and the verified unlink of one link. The call files (safe-remove.mjs, remove-links-under.mjs,
// rename-over.mjs, zip-write.mjs, ...) each name one filesystem use.
import fs from 'node:fs';

/** The `code` of a caught value (a Node system error carries one), or undefined. */
export const errorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
};

/** The rename and unlink errors Windows returns while another process holds the target open: retried, never final. */
export const FS_BUSY: readonly string[] = Object.freeze(['EPERM', 'EBUSY', 'EACCES']);

/** Remove a link itself, never its target. True when nothing is left at `p`. */
export function unlinkOnly(p: string): boolean {
  try { fs.lstatSync(p); } catch (error) { return errorCode(error) === 'ENOENT'; }
  try { fs.unlinkSync(p); } catch { try { fs.rmdirSync(p); } catch { /* verified below */ } }
  try { fs.lstatSync(p); return false; } catch (error) { return errorCode(error) === 'ENOENT'; }
}

/** Construct an archive-reader refusal with its existing error code. */
export const zipRefuse = (message: string, code = 'zip-corrupt'): Error & { code: string } => Object.assign(new Error(message), { code });

/** Relative ZIP entry names exclude traversal, drive roots and control characters. */
export const validZipName=(name: string): boolean=>Boolean(name)&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!/[\0\r\n\\]/.test(name)&&!name.split('/').includes('..');
