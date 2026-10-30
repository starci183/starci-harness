// progress.mts - the run's progress on stderr (never stdout, which keeps the diagnosis). A step prints a line when it starts and when it
// ends, and a running step one every 10 seconds of work or 10 percent of its files:
//   [12:04:31 +3m07s 41%] lint fe 312/1840 (17%) reused 1528 checked 312
// The clock, the time since the run began, the percentage across the run (each step weighted by its file count), the step, its files
// done of its total and the cache hits against the files it judged. On a terminal a running line updates in place; anywhere else
// (CI, a redirected run) only whole lines are written, never a carriage return or a spinner. `--quiet` is the silent sink.
import type { FamilyId, ProgressSink, StepProgress } from './types.mjs';

export interface ProgressOptions {
  /** Where lines go (stderr). */
  write: (text: string) => unknown;
  /** True when `write` reaches a terminal: running lines then rewrite in place. */
  tty?: boolean;
  /** Milliseconds since the epoch; a seam for specs. */
  now?: () => number;
  /** Files the whole run is expected to touch, for the overall percentage; else the steps seen so far. */
  planned?: number;
  /** Seconds of work between running lines. */
  everySeconds?: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `3m07s`, `42s`, `1h02m` for a duration in milliseconds. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${pad(minutes)}m`;
  return minutes > 0 ? `${minutes}m${pad(seconds)}s` : `${seconds}s`;
}

const clock = (at: number): string => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const percent = (done: number, total: number): number => (total <= 0 ? 100 : Math.min(100, Math.floor((done / total) * 100)));

/** The sink that prints nothing (`--quiet`, and the library default). */
export const silentProgress: ProgressSink = {
  step: () => ({ tick: () => {}, end: () => {} }),
};

/** The stderr progress sink. */
export function createProgress(options: ProgressOptions): ProgressSink {
  const now = options.now ?? Date.now;
  const started = now();
  const every = (options.everySeconds ?? 10) * 1000;
  let registered = 0;
  let finished = 0;
  let open = false;
  const prefix = (done: number): string => {
    const total = Math.max(options.planned ?? 0, registered);
    return `[${clock(now())} +${elapsedText(now() - started)} ${percent(finished + done, total)}%]`;
  };
  const emit = (text: string, running: boolean): void => {
    if (options.tty === true && running) {
      options.write(`\r${text}`);
      open = true;
      return;
    }
    options.write(`${open ? '\r' : ''}${text}\n`);
    open = false;
  };
  return {
    step(family: FamilyId, name: string, total: number): StepProgress {
      registered += total;
      let done = 0;
      const stepStart = now();
      let lastAt = stepStart;
      let lastTenth = 0;
      const body = (reused: number, checked: number): string => `${family} ${name} ${done}/${total} (${percent(done, total)}%) reused ${reused} checked ${checked}`;
      emit(`${prefix(0)} ${family} ${name} start, ${total} files`, false);
      return {
        tick(newDone: number, reused: number, checked: number): void {
          done = newDone;
          const tenth = Math.floor(percent(done, total) / 10);
          if (now() - lastAt < every && tenth <= lastTenth) return;
          lastAt = now();
          lastTenth = tenth;
          emit(`${prefix(done)} ${body(reused, checked)}`, true);
        },
        end(): void {
          finished += total;
          emit(`${prefix(0)} ${family} ${name} done, ${total} files in ${elapsedText(now() - stepStart)}`, false);
        },
      };
    },
  };
}
