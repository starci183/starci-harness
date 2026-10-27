import { hookErrorMessage } from './hook-io.mjs';

/** One IPC request from the owning hook; the process ends after its result reaches that parent. */
export function receiveVerdict(decide) {
  process.once('disconnect', () => process.exit(2));
  process.once('message', async ({ input, root, bindings }) => {
    let result;
    try { result = { ok: true, decision: await decide(input, { root, bindings }) }; }
    catch (error) { result = { ok: false, error: hookErrorMessage(error) }; }
    process.send(result, (error) => process.exit(error ? 2 : 0));
  });
}
