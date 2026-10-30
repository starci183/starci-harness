// format-worker.mts - a worker thread of sync/format.mts: loads the repository's own prettier once and checks the batches it is sent.
import { parentPort } from 'node:worker_threads';
import { checkBatch, loadPrettier, type Prettier } from './format.mjs';

let loaded: { repoRoot: string; prettier: Prettier } | undefined;

parentPort?.on('message', (message: { repoRoot: string; files: string[] }) => {
  void (async () => {
    try {
      if (loaded?.repoRoot !== message.repoRoot) loaded = { repoRoot: message.repoRoot, prettier: loadPrettier(message.repoRoot) };
      const findings = await checkBatch({ repoRoot: message.repoRoot, files: message.files, prettier: loaded.prettier });
      parentPort?.postMessage({ findings, count: message.files.length });
    } catch (error) {
      parentPort?.postMessage({ error: String((error as Error).message ?? error), code: (error as { code?: string }).code });
    }
  })();
});
